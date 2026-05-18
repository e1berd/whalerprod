<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "@kitbag/router"
import { useDisplay } from "vuetify"
import { HocuspocusProvider } from "@hocuspocus/provider"
import * as Y from "yjs"
import type { AwarenessUser, FileLocation } from "@whaler/shared"
import CodeEditor from "@/components/CodeEditor.vue"
import FileTree from "@/components/FileTree.vue"
import Splitter from "@/components/Splitter.vue"
import { collabUrl } from "@/lib/config"
import { client, handleUnauthorizedResponse, useSession } from "@/lib/session"

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

const micMuted = ref(false)
const deafened = ref(false)
const voiceConnected = ref(false)

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

onBeforeUnmount(disposePresence)
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
          <Splitter direction="vertical" :initial="65" :min="25" :max="85" storage-key="whaler.sidebar-split">
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
          <section class="sidebar-panel sidebar-panel--members">
            <header class="panel-heading">
              <span class="panel-title">Online — {{ presenceList.length }}</span>
            </header>
            <ul class="member-list">
              <li v-for="entry in presenceList" :key="entry.user.id" class="member-row" :title="presenceLabel(entry)">
                <div class="member-avatar-wrap">
                  <span class="member-avatar" :style="{ backgroundColor: entry.user.color }">
                    <img v-if="entry.user.avatarUrl" :src="entry.user.avatarUrl" :alt="entry.user.name" />
                    <template v-else>{{ entry.user.name.charAt(0).toUpperCase() }}</template>
                  </span>
                  <span class="member-status-dot" />
                </div>
                <div class="member-text">
                  <span class="member-name">{{ entry.user.name }}</span>
                  <span class="member-activity">{{ entry.location?.path ?? "Idle" }}</span>
                </div>
              </li>
              <li v-if="!presenceList.length" class="member-empty">No one else is here.</li>
            </ul>
          </section>
        </template>
      </Splitter>

      <footer class="voice-bar">
        <div class="voice-bar-identity">
          <span class="voice-bar-avatar" :style="{ backgroundColor: currentUser.color }">
            <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" :alt="currentUser.name" />
            <template v-else>{{ currentUser.name.charAt(0).toUpperCase() }}</template>
          </span>
          <div class="voice-bar-text">
            <span class="voice-bar-name">{{ currentUser.name }}</span>
            <span class="voice-bar-state">{{ voiceConnected ? "Voice ready" : "Voice idle" }}</span>
          </div>
        </div>
        <div class="voice-bar-actions">
          <v-tooltip location="top" :text="micMuted ? 'Unmute' : 'Mute'">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                class="voice-btn"
                :class="{ 'voice-btn--muted': micMuted }"
                :icon="micMuted ? 'mdi-microphone-off' : 'mdi-microphone'"
                variant="text"
                density="comfortable"
                size="small"
                @click="micMuted = !micMuted"
              />
            </template>
          </v-tooltip>
          <v-tooltip location="top" :text="deafened ? 'Undeafen' : 'Deafen'">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                class="voice-btn"
                :class="{ 'voice-btn--muted': deafened }"
                :icon="deafened ? 'mdi-headphones-off' : 'mdi-headphones'"
                variant="text"
                density="comfortable"
                size="small"
                @click="deafened = !deafened"
              />
            </template>
          </v-tooltip>
          <v-tooltip location="top" text="Audio settings">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                class="voice-btn"
                icon="mdi-cog-outline"
                variant="text"
                density="comfortable"
                size="small"
                @click="router.push('settings')"
              />
            </template>
          </v-tooltip>
        </div>
      </footer>
    </aside>
      </template>

      <template #end>
        <main class="detail-editor">
          <template v-if="activeFile">
            <header class="editor-toolbar">
              <div class="editor-title-row">
                <v-icon class="editor-file-icon" icon="mdi-file-code-outline" size="24" />
                <div class="editor-title-group">
                  <p class="editor-title">{{ activeFile.path }}</p>
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
              </div>
            </header>

            <v-alert v-if="error" type="error" density="comfortable" variant="tonal" class="error-banner">
              {{ error }}
            </v-alert>

            <div class="editor-host-wrapper">
              <CodeEditor :file="activeFile" :access-token="accessToken" :user="currentUser" />
            </div>
          </template>
          <div v-else class="workspace-stub">
            <div class="workspace-stub-card">
              <v-icon
                :icon="filePath ? 'mdi-file-question-outline' : 'mdi-folder-multiple-outline'"
                size="48"
                class="workspace-stub-icon"
              />
              <h1 class="workspace-stub-title">{{ workspace.name }}</h1>
              <p class="workspace-stub-subtitle">{{ workspace.imageRef }}</p>
              <p v-if="filePath" class="workspace-stub-hint workspace-stub-hint--warn">
                <v-icon icon="mdi-alert-circle-outline" size="16" class="me-1" />
                File <code>{{ filePath }}</code> not found in this workspace.
              </p>
              <p v-else class="workspace-stub-hint">Pick a file from the tree to start editing.</p>
            </div>
          </div>
        </main>
      </template>
    </Splitter>

    <main v-else class="detail-editor">
      <template v-if="activeFile">
        <header class="editor-toolbar">
          <div class="editor-title-row">
            <v-icon class="editor-file-icon" icon="mdi-file-code-outline" size="24" />
            <div class="editor-title-group">
              <p class="editor-title">{{ activeFile.path }}</p>
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
          </div>
        </header>

        <v-alert v-if="error" type="error" density="comfortable" variant="tonal" class="error-banner">
          {{ error }}
        </v-alert>

        <div class="editor-host-wrapper">
          <CodeEditor :file="activeFile" :access-token="accessToken" :user="currentUser" />
        </div>
      </template>
      <div v-else class="workspace-stub">
        <div class="workspace-stub-card">
          <v-icon
            :icon="filePath ? 'mdi-file-question-outline' : 'mdi-folder-multiple-outline'"
            size="48"
            class="workspace-stub-icon"
          />
          <h1 class="workspace-stub-title">{{ workspace.name }}</h1>
          <p class="workspace-stub-subtitle">{{ workspace.imageRef }}</p>
          <p v-if="filePath" class="workspace-stub-hint workspace-stub-hint--warn">
            <v-icon icon="mdi-alert-circle-outline" size="16" class="me-1" />
            File <code>{{ filePath }}</code> not found in this workspace.
          </p>
          <p v-else class="workspace-stub-hint">Pick a file from the tree to start editing.</p>
        </div>
      </div>
    </main>

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
  padding: 10px 14px 0;
  background: var(--md-sys-color-surface-container-low);
  border-right: 1px solid var(--md-sys-color-outline-variant);
  min-height: 0;
  overflow: hidden;
}

.workspace-context {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.workspace-context-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;
}

.workspace-context-title {
  font-size: 16px;
  font-weight: 500;
  letter-spacing: 0;
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

.sidebar-panel--members {
  gap: 6px;
  padding-top: 4px;
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

.member-list {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 8px;
  cursor: default;
  min-height: 38px;
  transition: background 120ms cubic-bezier(0.2, 0, 0, 1);
}

.member-row:hover {
  background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
}

.member-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.member-avatar {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font-weight: 600;
  font-size: 12px;
}

.member-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.member-status-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #4ade80;
  border: 2px solid var(--md-sys-color-surface-container-low);
  box-sizing: content-box;
}

.member-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.member-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--md-sys-color-on-surface);
}

.member-activity {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.member-empty {
  list-style: none;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  padding: 8px 8px;
}

.voice-bar {
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
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container-lowest);
}

.editor-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.editor-title-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.editor-title {
  margin: 0;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.muted {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
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
  padding: 32px 36px;
  max-width: 460px;
  text-align: center;
  border-radius: var(--md-sys-shape-large);
  background: var(--md-sys-color-surface-container-low);
  border: 1px solid var(--md-sys-color-outline-variant);
}

.workspace-stub-icon {
  color: var(--md-sys-color-primary);
  margin-bottom: 4px;
}

.workspace-stub-title {
  margin: 0;
  font-size: 24px;
  font-weight: 500;
  letter-spacing: -0.01em;
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

.status-chip[data-status="running"] {
  background: var(--md-sys-color-success-container);
  color: var(--md-sys-color-on-success-container);
}

.status-chip[data-status="error"] {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

.error-banner {
  margin: 12px 18px 0;
}
</style>
