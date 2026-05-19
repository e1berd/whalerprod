<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "@kitbag/router"
import { useDisplay } from "vuetify"
import { HocuspocusProvider } from "@hocuspocus/provider"
import * as Y from "yjs"
import type { AwarenessUser, FileLocation } from "@whaler/shared"
import CodeEditor from "@/components/CodeEditor.vue"
import FileTree from "@/components/FileTree.vue"
import MediaPrepare from "@/components/MediaPrepare.vue"
import MembersPanel from "@/components/MembersPanel.vue"
import PreviewPanel from "@/components/PreviewPanel.vue"
import Splitter from "@/components/Splitter.vue"
import { collabUrl } from "@/lib/config"
import { client, handleUnauthorizedResponse, useSession } from "@/lib/session"
import { useVoice } from "@/lib/voice/composable"

type WorkspaceDetail = {
  id: string
  name: string
  imageId: string
  imageRef: string
  visibility: "public" | "protected"
  hasPassword: boolean
  containerStatus: "pending" | "starting" | "running" | "stopped" | "error"
  ownerId: string
  isMember: boolean
}

type WorkspaceFile = {
  id: string
  workspaceId: string
  path: string
  kind: "file" | "directory"
  language: string | null
}

type PresenceEntry = {
  user: AwarenessUser
  location?: FileLocation
}

type PreviewMode = "web" | "terminal"

type WorkspacePreview = {
  id: string
  type: PreviewMode
  host: string
  url: string
  command: string
  status?: "running"
  exitCode?: number | null
  output?: string
}

const route = useRoute()
const router = useRouter()
const { accessToken, currentUser } = useSession()
const { mdAndUp } = useDisplay()

const workspace = ref<WorkspaceDetail | null>(null)
const workspaceLoading = ref(false)
const accessDenied = ref(false)
const files = ref<WorkspaceFile[]>([])
const activeFile = ref<WorkspaceFile | null>(null)
const presence = ref<PresenceEntry[]>([])
const error = ref<string | null>(null)
const createDialog = ref<{ parent: string; kind: "file" | "directory"; name: string } | null>(null)
const submittingCreate = ref(false)
const previewMode = ref<PreviewMode>("web")
const previewLoading = ref(false)
const webPreview = ref<WorkspacePreview | null>(null)
const terminalPreview = ref<WorkspacePreview | null>(null)
const previewError = ref<string | null>(null)
const logStreaming = ref(false)
let logTimer: number | null = null

const preview = computed<WorkspacePreview | null>(() =>
  previewMode.value === "web" ? webPreview.value : terminalPreview.value
)
const codeEditorRef = ref<InstanceType<typeof CodeEditor> | null>(null)
let lastTreeRevision = 0

let presenceProvider: HocuspocusProvider | null = null
let presenceDoc: Y.Doc | null = null

const workspaceId = computed(() => {
  const raw = (route.params as { workspaceId?: string }).workspaceId
  return raw ?? ""
})
const filePath = computed(() => {
  const raw = (route.params as { filePath?: string | string[] }).filePath
  if (Array.isArray(raw)) return raw.join("/")
  return raw ?? ""
})

function navigateToFile(file: WorkspaceFile | null) {
  if (file?.kind === "file") {
    void router.push("workspace-file", {
      workspaceId: workspaceId.value,
      filePath: file.path
    })
  } else {
    void router.push("workspace-detail", { workspaceId: workspaceId.value })
  }
}

const statusIcon = computed(() => {
  switch (workspace.value?.containerStatus) {
    case "running":
      return "mdi-check-circle-outline"
    case "starting":
    case "pending":
      return "mdi-progress-clock"
    case "stopped":
      return "mdi-stop-circle-outline"
    case "error":
      return "mdi-alert-circle-outline"
    default:
      return "mdi-circle-outline"
  }
})

const presenceList = computed(() => {
  const seen = new Set<string>()
  return presence.value.filter((entry) => {
    if (!entry.user || seen.has(entry.user.id)) return false
    seen.add(entry.user.id)
    return true
  })
})

function presenceLabel(entry: PresenceEntry): string {
  return entry.location?.path ? `${entry.user.name} • ${entry.location.path}` : entry.user.name
}

const voice = useVoice({ workspaceId, accessToken })
const micMuted = computed(() => voice.micMuted.value)
const deafened = computed(() => voice.deafened.value)
const voiceStateLabel = computed(() => {
  if (voice.micPublishing.value && !voice.micMuted.value) return "Speaking"
  if (voice.connected.value && !voice.deafened.value) return "Listening"
  if (voice.connected.value) return "Voice ready"
  return "Voice idle"
})

const voiceStateByUserId = computed<Record<string, {
  micMuted: boolean
  deafened: boolean
  volume: number
  connected: boolean
}>>(() => {
  const map: Record<string, { micMuted: boolean; deafened: boolean; volume: number; connected: boolean }> = {}
  for (const peer of voice.peers.value) {
    map[peer.userId] = {
      micMuted: peer.micMuted,
      deafened: peer.deafened,
      volume: peer.volume,
      connected: true
    }
  }
  if (currentUser.value.id) {
    map[currentUser.value.id] = {
      micMuted: voice.micMuted.value,
      deafened: voice.deafened.value,
      volume: 0,
      connected: voice.connected.value
    }
  }
  return map
})
const mediaPrepareOpen = ref(false)
const mediaPreparePendingMic = ref(false)

function permissionAlreadyGranted(): boolean {
  return localStorage.getItem("whaler.voice.input") !== null
}

async function handleMicToggle(): Promise<void> {
  if (!voice.micPublishing.value && !permissionAlreadyGranted()) {
    mediaPreparePendingMic.value = true
    mediaPrepareOpen.value = true
    return
  }
  try {
    await voice.toggleMicMute()
  } catch {
    mediaPreparePendingMic.value = true
    mediaPrepareOpen.value = true
  }
}

async function handleDeafenToggle(): Promise<void> {
  await voice.toggleDeafen()
}

function openAudioSettings(): void {
  mediaPreparePendingMic.value = false
  mediaPrepareOpen.value = true
}

async function startPreview(): Promise<void> {
  if (!workspaceId.value) return
  previewLoading.value = true
  previewError.value = null
  const mode = previewMode.value
  try {
    if (activeFile.value && codeEditorRef.value) {
      const saveResponse = await client().v1.files[":fileId"].$put({
        param: { fileId: activeFile.value.id },
        json: { content: codeEditorRef.value.getContent() }
      })
      if (!saveResponse.ok) {
        if (await handleUnauthorizedResponse(saveResponse)) return
        previewError.value = await saveResponse.text()
        return
      }
    }

    const response = await client().v1.workspaces[":workspaceId"].previews.$post({
      param: { workspaceId: workspaceId.value },
      json: {
        type: mode,
        activePath: activeFile.value?.path ?? null
      }
    })
    if (!response.ok) {
      if (await handleUnauthorizedResponse(response)) return
      previewError.value = await response.text()
      return
    }
    const payload = (await response.json()) as { preview: WorkspacePreview }
    if (mode === "web") {
      webPreview.value = payload.preview
      if (previewMode.value === "terminal") void fetchWebPreviewLog()
    } else {
      terminalPreview.value = payload.preview
    }
  } finally {
    previewLoading.value = false
  }
}

async function fetchWebPreviewLog(): Promise<void> {
  const current = webPreview.value
  if (!current || !workspaceId.value) return
  try {
    const response = await client().v1.workspaces[":workspaceId"].previews[":previewId"].log.$get({
      param: { workspaceId: workspaceId.value, previewId: current.id }
    })
    if (!response.ok) return
    const payload = (await response.json()) as { output: string }
    // Surface logs as a synthetic terminal preview keyed to the web preview's id
    // so user sees live dev server output under the Terminal tab.
    terminalPreview.value = {
      id: `web-log:${current.id}`,
      type: "terminal",
      host: current.host,
      url: current.url,
      command: `tail ${current.command}`,
      status: "running",
      output: payload.output || "Dev server started. Waiting for output…"
    }
  } catch {
    // ignore transient errors during polling
  }
}

function stopLogPolling(): void {
  if (logTimer !== null) {
    window.clearInterval(logTimer)
    logTimer = null
  }
  logStreaming.value = false
}

function startLogPolling(): void {
  stopLogPolling()
  if (!webPreview.value) return
  logStreaming.value = true
  void fetchWebPreviewLog()
  logTimer = window.setInterval(() => void fetchWebPreviewLog(), 1500)
}

watch([previewMode, webPreview], ([mode, web]) => {
  if (mode === "terminal" && web) {
    startLogPolling()
  } else {
    stopLogPolling()
  }
})

async function onMediaPrepareConfirm(payload: { inputDeviceId: string | null; outputDeviceId: string | null }): Promise<void> {
  voice.setInputDevice(payload.inputDeviceId)
  await voice.setOutputDevice(payload.outputDeviceId)
  if (mediaPreparePendingMic.value) {
    mediaPreparePendingMic.value = false
    try {
      await voice.enableMic()
    } catch {
      // error already surfaced via voice.error
    }
  }
}

const sidebarSplitPercent = ref(65)
const membersCollapsed = computed(() => sidebarSplitPercent.value >= 92)

function onSidebarSplitChange(value: number) {
  sidebarSplitPercent.value = value
}

const appBarReady = ref(false)
onMounted(() => {
  appBarReady.value = !!document.getElementById("app-bar-context")
})

async function loadWorkspace() {
  workspaceLoading.value = true
  error.value = null
  accessDenied.value = false
  try {
    const response = await client().v1.workspaces[":workspaceId"].$get({
      param: { workspaceId: workspaceId.value }
    })
    if (!response.ok) {
      if (await handleUnauthorizedResponse(response)) return
      if (response.status === 404) {
        error.value = "Workspace not found"
      } else {
        error.value = await response.text()
      }
      workspace.value = null
      return
    }
    const payload = (await response.json()) as { workspace: WorkspaceDetail }
    workspace.value = payload.workspace
    if (!payload.workspace.isMember) {
      accessDenied.value = true
      return
    }
    await loadFiles()
    connectPresence()
  } finally {
    workspaceLoading.value = false
  }
}

async function loadFiles() {
  const response = await client().v1.workspaces[":workspaceId"].tree.$get({
    param: { workspaceId: workspaceId.value }
  })
  if (!response.ok) {
    if (await handleUnauthorizedResponse(response)) return
    error.value = "Failed to load files"
    return
  }
  files.value = ((await response.json()).files as WorkspaceFile[]).sort((a, b) => a.path.localeCompare(b.path))
  syncActiveFileFromRoute()
}

function syncActiveFileFromRoute() {
  if (!filePath.value) {
    activeFile.value = null
    return
  }
  const match = files.value.find((file) => file.path === filePath.value && file.kind === "file")
  activeFile.value = match ?? null
}

function broadcastTreeChange() {
  if (!presenceProvider) return
  lastTreeRevision = Date.now()
  presenceProvider.setAwarenessField("treeRevision", lastTreeRevision)
}

function openCreateDialog(parent: string, kind: "file" | "directory") {
  createDialog.value = {
    parent,
    kind,
    name: kind === "file" ? "new-file.ts" : "new-folder"
  }
}

async function submitCreateDialog() {
  const draft = createDialog.value
  if (!draft || !workspaceId.value) return
  const trimmed = draft.name.trim()
  if (!trimmed) return
  const fullPath = draft.parent ? `${draft.parent}/${trimmed}` : trimmed
  submittingCreate.value = true
  error.value = null
  try {
    const response = await client().v1.workspaces[":workspaceId"].files.$post({
      param: { workspaceId: workspaceId.value },
      json: {
        path: fullPath,
        kind: draft.kind,
        content: ""
      }
    })
    if (!response.ok) {
      if (await handleUnauthorizedResponse(response)) return
      error.value = await response.text()
      return
    }
    const payload = (await response.json()) as { file: WorkspaceFile }
    files.value.push(payload.file)
    createDialog.value = null
    broadcastTreeChange()
    if (payload.file.kind === "file") navigateToFile(payload.file)
  } finally {
    submittingCreate.value = false
  }
}

async function renameFile(file: WorkspaceFile, nextPath: string) {
  error.value = null
  const response = await client().v1.files[":fileId"].$patch({
    param: { fileId: file.id },
    json: { path: nextPath }
  })
  if (!response.ok) {
    if (await handleUnauthorizedResponse(response)) return
    error.value = await response.text()
    return
  }
  const activeId = activeFile.value?.id
  await loadFiles()
  broadcastTreeChange()
  if (activeId) {
    const moved = files.value.find((row) => row.id === activeId)
    if (moved && moved.kind === "file" && moved.path !== filePath.value) {
      navigateToFile(moved)
    }
  }
}

async function deleteFile(file: WorkspaceFile) {
  error.value = null
  const confirmed = window.confirm(
    file.kind === "directory"
      ? `Delete folder "${file.path}" and everything inside?`
      : `Delete "${file.path}"?`
  )
  if (!confirmed) return
  const response = await client().v1.files[":fileId"].$delete({
    param: { fileId: file.id }
  })
  if (!response.ok) {
    if (await handleUnauthorizedResponse(response)) return
    error.value = await response.text()
    return
  }
  const wasActive = activeFile.value?.id === file.id
  await loadFiles()
  broadcastTreeChange()
  if (wasActive) navigateToFile(null)
}

function disposePresence() {
  presenceProvider?.destroy()
  presenceDoc?.destroy()
  presenceProvider = null
  presenceDoc = null
  presence.value = []
}

function connectPresence() {
  disposePresence()
  if (!workspaceId.value || !accessToken.value) return

  presenceDoc = new Y.Doc()
  presenceProvider = new HocuspocusProvider({
    url: collabUrl(),
    name: `workspace:${workspaceId.value}:presence`,
    document: presenceDoc,
    token: accessToken.value
  })

  presenceProvider.setAwarenessField("user", currentUser.value)
  updatePresenceLocation()
  lastTreeRevision = 0

  presenceProvider.on(
    "awarenessUpdate",
    ({ states }: { states: Array<PresenceEntry & { clientId: number; treeRevision?: number }> }) => {
      presence.value = states.filter((entry) => entry.user)
      const localId = presenceProvider?.awareness?.clientID
      let maxRevision = 0
      for (const state of states) {
        if (state.clientId === localId) continue
        const value = state.treeRevision
        if (typeof value === "number" && value > maxRevision) maxRevision = value
      }
      if (maxRevision > lastTreeRevision) {
        lastTreeRevision = maxRevision
        void loadFiles()
      }
    }
  )
}

function updatePresenceLocation() {
  if (!presenceProvider || !workspaceId.value) return
  presenceProvider.setAwarenessField("location", {
    workspaceId: workspaceId.value,
    fileId: activeFile.value?.id ?? null,
    path: activeFile.value?.path ?? null
  } satisfies FileLocation)
}

watch(workspaceId, (value) => {
  if (value) void loadWorkspace()
  else disposePresence()
})

watch(filePath, syncActiveFileFromRoute)
watch(activeFile, updatePresenceLocation)
watch(currentUser, () => presenceProvider?.setAwarenessField("user", currentUser.value), { deep: true })

if (workspaceId.value) void loadWorkspace()

onBeforeUnmount(() => {
  disposePresence()
  stopLogPolling()
})
</script>

<template>
  <div v-if="workspaceLoading && !workspace" class="detail-loading">
    <v-progress-circular indeterminate color="primary" />
  </div>

  <section v-else-if="accessDenied" class="detail-empty">
    <v-icon icon="mdi-lock-outline" size="48" />
    <p>You don't have access to this workspace.</p>
    <v-btn color="primary" variant="tonal" prepend-icon="mdi-arrow-left" @click="router.push('home')">
      Back to workspaces
    </v-btn>
  </section>

  <section v-else-if="workspace" class="detail-page">
    <Teleport to="#app-bar-context" :disabled="!appBarReady">
      <div class="workspace-context">
        <v-btn
          icon="mdi-arrow-left"
          variant="text"
          density="comfortable"
          title="Back"
          @click="router.push('home')"
        />
        <div class="workspace-context-text">
          <span class="workspace-context-title">{{ workspace.name }}</span>
          <span class="workspace-context-subtitle">{{ workspace.imageRef }}</span>
        </div>
        <v-chip
          class="status-chip"
          size="x-small"
          variant="flat"
          :prepend-icon="statusIcon"
          :data-status="workspace.containerStatus"
        >
          {{ workspace.containerStatus }}
        </v-chip>
      </div>
    </Teleport>

    <Splitter
      v-if="mdAndUp"
      direction="horizontal"
      :initial="22"
      :min="14"
      :max="50"
      storage-key="whaler.workspace-split"
      class="detail-split"
    >
      <template #start>
        <aside class="detail-sidebar">
          <Splitter
        direction="vertical"
        :initial="65"
        :min="0"
        :max="100"
        storage-key="whaler.sidebar-split"
        @update:percent="onSidebarSplitChange"
      >
        <template #start>
          <section class="sidebar-panel sidebar-panel--files">
            <header class="panel-heading">
              <span class="panel-title">Files</span>
              <div class="panel-heading-actions">
                <v-chip size="x-small" variant="tonal">{{ files.length }}</v-chip>
                <v-btn
                  icon="mdi-file-plus-outline"
                  variant="text"
                  size="x-small"
                  density="comfortable"
                  title="New file"
                  @click="openCreateDialog('', 'file')"
                />
                <v-btn
                  icon="mdi-folder-plus-outline"
                  variant="text"
                  size="x-small"
                  density="comfortable"
                  title="New folder"
                  @click="openCreateDialog('', 'directory')"
                />
              </div>
            </header>
            <FileTree
              :files="files"
              :active-file-id="activeFile?.id ?? null"
              :locations="presence"
              @open="navigateToFile($event)"
              @rename="renameFile"
              @remove="deleteFile"
              @create-in="openCreateDialog"
            />
          </section>
        </template>

        <template #end>
          <MembersPanel
            v-if="!membersCollapsed"
            :presence-list="presenceList"
            :presence-label="presenceLabel"
            :voice-state-by-user-id="voiceStateByUserId"
          />
        </template>
      </Splitter>

      <div v-if="membersCollapsed" class="members-floating">
        <div class="members-floating-handle">
          <v-icon icon="mdi-chevron-up" size="14" />
          Online — {{ presenceList.length }}
        </div>
        <MembersPanel
          class="members-floating-panel"
          :presence-list="presenceList"
          :presence-label="presenceLabel"
          :voice-state-by-user-id="voiceStateByUserId"
        />
      </div>

      <footer class="voice-bar">
        <div class="voice-bar-identity">
          <span class="voice-bar-avatar" :style="{ backgroundColor: currentUser.color }">
            <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" :alt="currentUser.name" />
            <template v-else>{{ currentUser.name.charAt(0).toUpperCase() }}</template>
          </span>
          <div class="voice-bar-text">
            <span class="voice-bar-name">{{ currentUser.name }}</span>
            <span class="voice-bar-state">{{ voiceStateLabel }}</span>
          </div>
        </div>
        <div class="voice-bar-actions">
          <v-tooltip location="top" :text="micMuted ? 'Enable microphone' : 'Mute microphone'">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                class="voice-btn"
                :class="{ 'voice-btn--muted': micMuted }"
                :icon="micMuted ? 'mdi-microphone-off' : 'mdi-microphone'"
                variant="text"
                density="comfortable"
                size="small"
                @click="handleMicToggle"
              />
            </template>
          </v-tooltip>
          <v-tooltip location="top" :text="deafened ? 'Enable speakers' : 'Mute speakers'">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                class="voice-btn"
                :class="{ 'voice-btn--muted': deafened }"
                :icon="deafened ? 'mdi-headphones-off' : 'mdi-headphones'"
                variant="text"
                density="comfortable"
                size="small"
                @click="handleDeafenToggle"
              />
            </template>
          </v-tooltip>
          <v-tooltip location="top" text="Audio devices">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                class="voice-btn"
                icon="mdi-tune-vertical"
                variant="text"
                density="comfortable"
                size="small"
                @click="openAudioSettings"
              />
            </template>
          </v-tooltip>
        </div>
      </footer>
    </aside>
      </template>

      <template #end>
        <main class="detail-editor">
          <header class="editor-toolbar">
            <div class="editor-title-row">
              <div class="editor-file-pill">
                <v-icon class="editor-file-icon" icon="mdi-file-code-outline" size="18" />
              </div>
              <div class="editor-title-group">
                <p class="editor-title">{{ activeFile?.path ?? workspace.name }}</p>
                <span class="muted">{{ workspace.imageRef }}</span>
              </div>
            </div>
            <div class="editor-toolbar-meta">
              <v-chip
                v-if="presenceList.length"
                size="small"
                variant="tonal"
                prepend-icon="mdi-account-multiple-outline"
              >
                {{ presenceList.length }} online
              </v-chip>
              <v-btn
                class="run-btn"
                color="primary"
                variant="elevated"
                prepend-icon="mdi-play"
                :loading="previewLoading"
                @click="startPreview"
              >
                Run
              </v-btn>
            </div>
          </header>

          <v-alert v-if="error" type="error" density="comfortable" variant="tonal" class="error-banner">
            {{ error }}
          </v-alert>

          <div class="editor-preview-body">
            <section class="editor-column">
              <div v-if="activeFile" class="editor-host-wrapper">
                <CodeEditor ref="codeEditorRef" :file="activeFile" :access-token="accessToken" :user="currentUser" />
              </div>
              <div v-else class="workspace-stub">
                <div class="workspace-stub-card">
                  <div class="workspace-stub-mark">
                    <v-icon
                      :icon="filePath ? 'mdi-file-question-outline' : 'mdi-folder-multiple-outline'"
                      size="32"
                    />
                  </div>
                  <h1 class="workspace-stub-title">{{ workspace.name }}</h1>
                  <p class="workspace-stub-subtitle">{{ workspace.imageRef }}</p>
                  <p v-if="filePath" class="workspace-stub-hint workspace-stub-hint--warn">
                    <v-icon icon="mdi-alert-circle-outline" size="16" class="me-1" />
                    File <code>{{ filePath }}</code> not found in this workspace.
                  </p>
                  <p v-else class="workspace-stub-hint">Pick a file from the tree to start editing.</p>
                </div>
              </div>
            </section>

            <PreviewPanel
              v-model:mode="previewMode"
              :preview="preview"
              :loading="previewLoading"
              :error="previewError"
              @run="startPreview"
              @refresh="startPreview"
            />
          </div>
        </main>
      </template>
    </Splitter>

    <main v-else class="detail-editor">
      <template v-if="activeFile">
        <header class="editor-toolbar">
          <div class="editor-title-row">
            <div class="editor-file-pill">
              <v-icon class="editor-file-icon" icon="mdi-file-code-outline" size="18" />
            </div>
            <div class="editor-title-group">
              <p class="editor-title">{{ activeFile.path }}</p>
              <span class="muted">{{ workspace.imageRef }}</span>
            </div>
          </div>
          <div class="editor-toolbar-meta">
            <v-btn
              class="run-btn"
              color="primary"
              variant="elevated"
              prepend-icon="mdi-play"
              :loading="previewLoading"
              @click="startPreview"
            >
              Run
            </v-btn>
          </div>
        </header>

        <v-alert v-if="error" type="error" density="comfortable" variant="tonal" class="error-banner">
          {{ error }}
        </v-alert>

        <div class="editor-host-wrapper">
          <CodeEditor ref="codeEditorRef" :file="activeFile" :access-token="accessToken" :user="currentUser" />
        </div>
      </template>
      <div v-else class="workspace-stub">
        <div class="workspace-stub-card">
          <div class="workspace-stub-mark">
            <v-icon
              :icon="filePath ? 'mdi-file-question-outline' : 'mdi-folder-multiple-outline'"
              size="32"
            />
          </div>
          <h1 class="workspace-stub-title">{{ workspace.name }}</h1>
          <p class="workspace-stub-subtitle">{{ workspace.imageRef }}</p>
          <p v-if="filePath" class="workspace-stub-hint workspace-stub-hint--warn">
            <v-icon icon="mdi-alert-circle-outline" size="16" class="me-1" />
            File <code>{{ filePath }}</code> not found in this workspace.
          </p>
          <p v-else class="workspace-stub-hint">Pick a file from the tree to start editing.</p>
        </div>
      </div>

      <PreviewPanel
        v-model:mode="previewMode"
        :preview="preview"
        :loading="previewLoading"
        :error="previewError"
        variant="mobile"
        @run="startPreview"
        @refresh="startPreview"
      />
    </main>

    <MediaPrepare
      v-model="mediaPrepareOpen"
      :initial-input-device-id="voice.inputDeviceId.value"
      :initial-output-device-id="voice.outputDeviceId.value"
      @confirm="onMediaPrepareConfirm"
    />

    <v-snackbar
      :model-value="!!voice.error.value"
      color="error"
      location="bottom right"
      timeout="4000"
      @update:model-value="(value: boolean) => { if (!value) voice.error.value = null }"
    >
      {{ voice.error.value }}
    </v-snackbar>

    <v-dialog :model-value="!!createDialog" max-width="420" @update:model-value="(value) => !value && (createDialog = null)">
      <v-card v-if="createDialog" rounded="xl">
        <v-card-title>
          <v-icon
            :icon="createDialog.kind === 'directory' ? 'mdi-folder-plus-outline' : 'mdi-file-plus-outline'"
            class="me-2"
          />
          {{ createDialog.kind === "directory" ? "New folder" : "New file" }}
        </v-card-title>
        <v-card-text>
          <p v-if="createDialog.parent" class="muted mb-2">In: {{ createDialog.parent }}/</p>
          <v-text-field
            v-model="createDialog.name"
            :label="createDialog.kind === 'directory' ? 'Folder name' : 'File name'"
            density="comfortable"
            variant="solo-filled"
            hide-details
            autofocus
            @keydown.enter="submitCreateDialog"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="createDialog = null">Cancel</v-btn>
          <v-btn color="primary" variant="elevated" :loading="submittingCreate" @click="submitCreateDialog">
            Create
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>

  <section v-else class="detail-empty">
    <v-icon icon="mdi-alert-circle-outline" size="48" />
    <p>{{ error ?? "Failed to load workspace" }}</p>
    <v-btn color="primary" variant="tonal" prepend-icon="mdi-arrow-left" @click="router.push('home')">
      Back to workspaces
    </v-btn>
  </section>
</template>

<style scoped>
.detail-page {
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.detail-split {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.detail-sidebar {
  display: flex;
  height: 100%;
  flex-direction: column;
  gap: 0;
  padding: 10px 12px 0;
  background: var(--md-sys-color-surface-container-low);
  border-right: 1px solid var(--md-sys-color-outline-variant);
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.workspace-context {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
  padding-left: 4px;
}

.workspace-context-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;
}

.workspace-context-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.005em;
  color: var(--md-sys-color-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace-context-subtitle {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--md-sys-color-on-surface-variant);
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.detail-files-section {
  flex: 1;
  min-height: 0;
}

.section-heading-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sidebar-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.sidebar-panel--files {
  gap: 6px;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 6px;
}

.panel-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--md-sys-color-on-surface-variant);
}

.panel-heading-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.members-floating {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 4;
  height: 86px;
  padding: 6px 14px 0;
  background: var(--md-sys-color-surface-container-low);
  border-top: 1px solid var(--md-sys-color-outline-variant);
  display: flex;
  flex-direction: column;
  opacity: 0.55;
  overflow: hidden;
  cursor: default;
  transition: height 280ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease;
}

.members-floating:hover {
  height: 320px;
  opacity: 1;
}

.members-floating-handle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--md-sys-color-on-surface-variant);
  pointer-events: none;
}

.members-floating-handle :deep(.v-icon) {
  opacity: 0.6;
  transition: transform 260ms cubic-bezier(0.2, 0, 0, 1);
}

.members-floating:hover .members-floating-handle :deep(.v-icon) {
  transform: rotate(180deg);
}

.members-floating-panel {
  flex: 1;
  min-height: 0;
}

.voice-bar {
  position: relative;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 -14px;
  padding: 8px 12px;
  background: var(--md-sys-color-surface-container);
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.voice-bar-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.voice-bar-avatar {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font-weight: 600;
  font-size: 13px;
  flex-shrink: 0;
}

.voice-bar-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.voice-bar-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;
}

.voice-bar-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.voice-bar-state {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
}

.voice-bar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.voice-btn {
  color: var(--md-sys-color-on-surface-variant);
}

.voice-btn--muted {
  color: rgb(var(--v-theme-error));
}

.detail-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container-lowest);
}

.editor-toolbar-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.editor-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.editor-file-pill {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  flex-shrink: 0;
}

.editor-file-icon {
  color: inherit;
}

.editor-title-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.editor-title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 700;
  letter-spacing: -0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--md-sys-color-on-surface);
}

.muted {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}

.run-btn {
  height: 40px !important;
  padding: 0 18px !important;
  font-weight: 700 !important;
}

.workspace-stub {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 32px;
  background: var(--md-sys-color-surface-container-lowest);
}

.workspace-stub-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 40px;
  max-width: 460px;
  text-align: center;
  border-radius: var(--md-sys-shape-large);
  background: var(--md-sys-color-surface-container-lowest);
  border: 1px solid var(--md-sys-color-outline-variant);
}

.workspace-stub-mark {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  margin-bottom: 6px;
}

.workspace-stub-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--md-sys-color-on-surface);
}

.workspace-stub-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
}

.workspace-stub-hint {
  margin: 12px 0 0;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  color: var(--md-sys-color-on-surface-variant);
}

.workspace-stub-hint code {
  font-family: 'Monaspace Neon', 'JetBrains Mono', monospace;
  font-weight: 500;
  padding: 1px 6px;
  margin: 0 4px;
  border-radius: 6px;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
}

.workspace-stub-hint--warn {
  color: var(--md-sys-color-error);
}

.editor-host-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
}

.editor-preview-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 40%);
}

.editor-column {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.detail-loading,
.detail-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--md-sys-color-on-surface-variant);
}

.error-banner {
  margin: 12px 18px 0;
}
</style>
