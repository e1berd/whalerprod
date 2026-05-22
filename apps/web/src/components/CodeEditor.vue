<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { php } from "@codemirror/lang-php"
import { python } from "@codemirror/lang-python"
import { Compartment, EditorState } from "@codemirror/state"
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { bracketMatching, indentOnInput } from "@codemirror/language"
import { HocuspocusProvider } from "@hocuspocus/provider"
import { yCollab } from "y-codemirror.next"
import * as Y from "yjs"
import type { AwarenessUser, FileLocation } from "@whaler/shared"
import { collabUrl } from "@/lib/config"
import { editorBaseTheme, editorHighlight } from "@/lib/editor-theme"
import { effectiveThemeName } from "@/lib/theme"
import RemoteCursorLabel from "@/components/RemoteCursorLabel.vue"

type WorkspaceFile = {
  id: string
  path: string
  language: string | null
}

type RemoteCursor = {
  clientId: number
  pos: number
  name: string
  color: string
}

type EditorSyncState = "idle" | "connecting" | "connected" | "synced" | "error"

const props = defineProps<{
  file: WorkspaceFile | null
  accessToken: string
  user: AwarenessUser
  accentColor?: string | null
  followLocation?: FileLocation | null
}>()

const emit = defineEmits<{
  "scroll-change": [location: Pick<FileLocation, "scrollTop" | "scrollHeight" | "clientHeight" | "scrollRatio">]
}>()

const host = ref<HTMLElement | null>(null)
const view = shallowRef<EditorView | null>(null)
const remoteCursors = ref<RemoteCursor[]>([])
const syncState = ref<EditorSyncState>("idle")

const syncStatusText = computed(() => {
  if (syncState.value === "error") return "Realtime unavailable. Retrying..."
  if (syncState.value === "connected") return "Syncing document..."
  return "Connecting to realtime..."
})

const showSyncOverlay = computed(() => Boolean(props.file) && syncState.value !== "idle" && syncState.value !== "synced")

let provider: HocuspocusProvider | null = null
let ydoc: Y.Doc | null = null
let removeAwarenessListener: (() => void) | null = null
let scrollEmitFrame: number | null = null
let followScrollFrame: number | null = null
const themeCompartment = new Compartment()
const highlightCompartment = new Compartment()

function modeFromTheme(themeName: string): "light" | "dark" {
  return themeName === "whalerDark" ? "dark" : "light"
}

function languageExtension(language: string | null, path: string) {
  if (language === "typescript") return javascript({ typescript: true })
  if (language === "javascript") return javascript()
  if (language === "json") return json()
  if (language === "python") return python()
  if (language === "php") return php()
  if (language === "html") return html()
  if (language === "css") return css()
  if (path.endsWith(".ts")) return javascript({ typescript: true })
  if (path.endsWith(".js")) return javascript()
  if (path.endsWith(".py")) return python()
  if (path.endsWith(".php")) return php()
  return []
}

function recomputeRemoteCursors() {
  if (!provider || !ydoc) return
  const ytext = ydoc.getText("content")
  const next: RemoteCursor[] = []
  const states = provider.awareness?.getStates()
  if (!states) {
    remoteCursors.value = []
    return
  }
  for (const [clientId, state] of states) {
    if (clientId === provider.awareness?.clientID) continue
    const cursor = state?.cursor
    const userInfo = state?.user
    if (!cursor || !userInfo || !cursor.head) continue
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(cursor.head),
      ydoc
    )
    if (!absolute || absolute.type !== ytext) continue
    next.push({
      clientId,
      pos: absolute.index,
      name: userInfo.name ?? "Anonymous",
      color: userInfo.color ?? "#2563eb"
    })
  }
  remoteCursors.value = next
}

function readScrollLocation(): Pick<FileLocation, "scrollTop" | "scrollHeight" | "clientHeight" | "scrollRatio"> | null {
  const scroller = view.value?.scrollDOM
  if (!scroller) return null
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  return {
    scrollTop: Math.max(0, Math.round(scroller.scrollTop)),
    scrollHeight: Math.max(0, Math.round(scroller.scrollHeight)),
    clientHeight: Math.max(0, Math.round(scroller.clientHeight)),
    scrollRatio: maxScroll > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / maxScroll)) : 0
  }
}

function scheduleScrollEmit() {
  if (scrollEmitFrame !== null) return
  scrollEmitFrame = window.requestAnimationFrame(() => {
    scrollEmitFrame = null
    const location = readScrollLocation()
    if (location) emit("scroll-change", location)
  })
}

function scrollToLocation(location?: FileLocation | null): void {
  if (!location || !view.value || props.file?.id !== location.fileId) return
  if (followScrollFrame !== null) window.cancelAnimationFrame(followScrollFrame)
  followScrollFrame = window.requestAnimationFrame(() => {
    followScrollFrame = null
    const scroller = view.value?.scrollDOM
    if (!scroller) return
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const nextTop =
      typeof location.scrollRatio === "number"
        ? maxScroll * Math.min(1, Math.max(0, location.scrollRatio))
        : Math.min(maxScroll, Math.max(0, location.scrollTop ?? 0))
    scroller.scrollTo({ top: nextTop, behavior: "auto" })
  })
}

function dispose() {
  removeAwarenessListener?.()
  removeAwarenessListener = null
  if (scrollEmitFrame !== null) window.cancelAnimationFrame(scrollEmitFrame)
  if (followScrollFrame !== null) window.cancelAnimationFrame(followScrollFrame)
  scrollEmitFrame = null
  followScrollFrame = null
  view.value?.destroy()
  provider?.destroy()
  ydoc?.destroy()
  view.value = null
  provider = null
  ydoc = null
  remoteCursors.value = []
  syncState.value = "idle"
}

function getContent(): string {
  return view.value?.state.doc.toString() ?? ""
}

async function mountEditor() {
  dispose()
  await nextTick()

  if (!host.value || !props.file) {
    return
  }

  ydoc = new Y.Doc()
  syncState.value = "connecting"
  provider = new HocuspocusProvider({
    url: collabUrl(),
    name: `file:${props.file.id}`,
    document: ydoc,
    token: props.accessToken,
    onStatus: ({ status }: { status: string }) => {
      if (status === "connected") syncState.value = "connected"
      else if (status === "disconnected") syncState.value = "connecting"
    },
    onSynced: ({ state }: { state: boolean }) => {
      syncState.value = state ? "synced" : "connected"
    },
    onAuthenticationFailed: () => {
      syncState.value = "error"
    }
  })

  provider.setAwarenessField("user", props.user)

  const ytext = ydoc.getText("content")
  const undoManager = new Y.UndoManager(ytext)

  view.value = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: "",
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        bracketMatching(),
        indentOnInput(),
        highlightCompartment.of(editorHighlight(modeFromTheme(effectiveThemeName.value))),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged || update.viewportChanged || update.geometryChanged) {
            recomputeRemoteCursors()
            scheduleScrollEmit()
          }
        }),
        themeCompartment.of(editorBaseTheme(modeFromTheme(effectiveThemeName.value))),
        languageExtension(props.file.language, props.file.path),
        yCollab(ytext, provider.awareness, { undoManager })
      ]
    })
  })

  const awareness = provider.awareness
  if (awareness) {
    const awarenessListener = () => recomputeRemoteCursors()
    awareness.on("change", awarenessListener)
    removeAwarenessListener = () => awareness.off("change", awarenessListener)
  }
  recomputeRemoteCursors()
  scheduleScrollEmit()
  scrollToLocation(props.followLocation)
}

watch(() => props.file?.id, mountEditor, { immediate: true })
watch(
  () => props.user,
  () => provider?.setAwarenessField("user", props.user),
  { deep: true }
)
watch(
  () => props.followLocation,
  (location) => scrollToLocation(location),
  { deep: true }
)
watch(effectiveThemeName, (themeName) => {
  if (!view.value) return
  const mode = modeFromTheme(themeName)
  view.value.dispatch({
    effects: [
      themeCompartment.reconfigure(editorBaseTheme(mode)),
      highlightCompartment.reconfigure(editorHighlight(mode))
    ]
  })
})

onBeforeUnmount(dispose)

defineExpose({
  getContent,
  scrollToLocation
})
</script>

<template>
  <div
    v-if="file"
    class="editor-host-frame"
    :style="{ '--editor-accent-color': accentColor ?? 'transparent' }"
  >
    <div ref="host" class="editor-host" />
    <div v-if="showSyncOverlay" class="editor-sync-overlay">
      <div class="editor-sync-pill">
        <v-progress-circular indeterminate size="20" width="2" />
        <span>{{ syncStatusText }}</span>
      </div>
    </div>
    <template v-if="view">
      <RemoteCursorLabel
        v-for="cursor in remoteCursors"
        :key="cursor.clientId"
        :view="view"
        :pos="cursor.pos"
        :name="cursor.name"
        :color="cursor.color"
      />
    </template>
  </div>
  <div v-else class="editor-empty">
    <v-icon icon="mdi-file-code-outline" size="40" />
    <span>Select a file</span>
  </div>
</template>

<style scoped>
.editor-host-frame {
  position: relative;
  height: 100%;
  width: 100%;
  border: 2px solid var(--editor-accent-color);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--editor-accent-color) 24%, transparent);
  box-sizing: border-box;
  overflow: hidden;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.editor-host {
  position: absolute;
  inset: 0;
}

.editor-sync-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: color-mix(in srgb, rgb(var(--v-theme-surface)) 78%, transparent);
}

.editor-sync-pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  max-width: min(320px, calc(100% - 32px));
  padding: 0 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.14);
  font-size: 13px;
  line-height: 1.2;
  white-space: normal;
}
</style>
