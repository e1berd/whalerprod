<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { python } from "@codemirror/lang-python"
import { Compartment, EditorState } from "@codemirror/state"
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { bracketMatching, indentOnInput } from "@codemirror/language"
import { HocuspocusProvider } from "@hocuspocus/provider"
import { yCollab } from "y-codemirror.next"
import * as Y from "yjs"
import type { AwarenessUser } from "@whaler/shared"
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

const props = defineProps<{
  file: WorkspaceFile | null
  accessToken: string
  user: AwarenessUser
}>()

const host = ref<HTMLElement | null>(null)
const view = shallowRef<EditorView | null>(null)
const remoteCursors = ref<RemoteCursor[]>([])

let provider: HocuspocusProvider | null = null
let ydoc: Y.Doc | null = null
let removeAwarenessListener: (() => void) | null = null
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
  if (language === "html") return html()
  if (language === "css") return css()
  if (path.endsWith(".ts")) return javascript({ typescript: true })
  if (path.endsWith(".js")) return javascript()
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

function dispose() {
  removeAwarenessListener?.()
  removeAwarenessListener = null
  view.value?.destroy()
  provider?.destroy()
  ydoc?.destroy()
  view.value = null
  provider = null
  ydoc = null
  remoteCursors.value = []
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
  provider = new HocuspocusProvider({
    url: collabUrl(),
    name: `file:${props.file.id}`,
    document: ydoc,
    token: props.accessToken
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
}

watch(() => props.file?.id, mountEditor, { immediate: true })
watch(
  () => props.user,
  () => provider?.setAwarenessField("user", props.user),
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
  getContent
})
</script>

<template>
  <div v-if="file" class="editor-host-frame">
    <div ref="host" class="editor-host" />
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
}

.editor-host {
  position: absolute;
  inset: 0;
}
</style>
