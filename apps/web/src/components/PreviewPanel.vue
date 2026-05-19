<script setup lang="ts">
import { computed } from "vue"

export type PreviewMode = "web" | "terminal"

export type WorkspacePreview = {
  id: string
  type: PreviewMode
  host: string
  url: string
  command: string
  status?: "running"
  exitCode?: number | null
  output?: string
}

const props = defineProps<{
  preview: WorkspacePreview | null
  mode: PreviewMode
  loading: boolean
  error: string | null
  variant?: "desktop" | "mobile"
}>()

const emit = defineEmits<{
  "update:mode": [value: PreviewMode]
  run: []
  refresh: []
}>()

const addressLabel = computed(() => {
  if (props.preview?.url) return props.preview.url
  if (props.mode === "terminal") return "Terminal — ready to run"
  return "Awaiting first run…"
})

const exitLabel = computed(() => {
  if (props.preview?.type !== "terminal") return null
  if (typeof props.preview.exitCode === "number") return `exit ${props.preview.exitCode}`
  return props.preview.status === "running" ? "running…" : null
})
</script>

<template>
  <aside class="preview-panel" :class="{ 'preview-panel--mobile': variant === 'mobile' }">
    <header class="preview-chrome">
      <div class="preview-lights" aria-hidden="true">
        <span class="preview-light preview-light--red" />
        <span class="preview-light preview-light--amber" />
        <span class="preview-light preview-light--green" />
      </div>

      <div class="preview-mode-toggle">
        <button
          type="button"
          class="preview-mode-btn"
          :class="{ 'preview-mode-btn--active': mode === 'web' }"
          @click="emit('update:mode', 'web')"
        >
          <v-icon icon="mdi-web" size="14" />
          Web
        </button>
        <button
          type="button"
          class="preview-mode-btn"
          :class="{ 'preview-mode-btn--active': mode === 'terminal' }"
          @click="emit('update:mode', 'terminal')"
        >
          <v-icon icon="mdi-console" size="14" />
          Terminal
        </button>
      </div>

      <div class="preview-address" :class="{ 'preview-address--idle': !preview }">
        <v-icon
          :icon="preview ? (mode === 'terminal' ? 'mdi-console' : 'mdi-lock-outline') : 'mdi-circle-medium'"
          size="14"
        />
        <span class="preview-address-text">{{ addressLabel }}</span>
        <span v-if="exitLabel" class="preview-address-meta">{{ exitLabel }}</span>
      </div>

      <div class="preview-actions">
        <v-tooltip location="top" text="Re-run">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              class="preview-icon-btn"
              icon="mdi-refresh"
              size="x-small"
              variant="text"
              :loading="loading"
              :disabled="loading"
              @click="emit('refresh')"
            />
          </template>
        </v-tooltip>
        <v-tooltip v-if="preview?.type === 'web'" location="top" text="Open in new tab">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              class="preview-icon-btn"
              icon="mdi-open-in-new"
              size="x-small"
              variant="text"
              :href="preview.url"
              target="_blank"
              rel="noreferrer"
            />
          </template>
        </v-tooltip>
      </div>
    </header>

    <v-alert v-if="error" type="error" density="compact" variant="tonal" class="preview-error">
      <pre class="preview-error-text">{{ error }}</pre>
    </v-alert>

    <div class="preview-stage">
      <div v-if="!preview" class="preview-empty">
        <div class="preview-empty-card">
          <div class="preview-empty-icon">
            <v-icon :icon="mode === 'terminal' ? 'mdi-console' : 'mdi-rocket-launch-outline'" size="32" />
          </div>
          <h3>{{ mode === "terminal" ? "Run a terminal preview" : "Launch your web preview" }}</h3>
          <p>
            {{
              mode === "terminal"
                ? "Execute the entry command and stream the output here."
                : "Start the dev server and we'll embed it in this panel."
            }}
          </p>
          <v-btn
            class="preview-empty-cta"
            color="primary"
            variant="elevated"
            size="large"
            prepend-icon="mdi-play"
            :loading="loading"
            @click="emit('run')"
          >
            Run preview
          </v-btn>
        </div>
      </div>
      <iframe
        v-else-if="preview.type === 'web'"
        class="preview-frame"
        :src="preview.url"
        title="Workspace web preview"
      />
      <div v-else class="preview-terminal-wrap">
        <pre class="preview-terminal"><span class="preview-terminal-prompt">$ {{ preview.command || "run" }}</span><br />{{ preview.output || "Command finished without output." }}</pre>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.preview-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--md-sys-color-surface-container-low);
  border-left: 1px solid var(--md-sys-color-outline-variant);
}

.preview-panel--mobile {
  min-height: 360px;
  border-left: 0;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.preview-chrome {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container);
}

.preview-lights {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-right: 2px;
}

.preview-light {
  width: 11px;
  height: 11px;
  border-radius: 999px;
  background: var(--md-sys-color-surface-container-highest);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}

.preview-light--red {
  background: #ff5f57;
}

.preview-light--amber {
  background: #ffbd2e;
}

.preview-light--green {
  background: #28c840;
}

.preview-mode-toggle {
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
}

.preview-mode-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
  padding: 4px 10px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: background var(--md-sys-motion-fast), color var(--md-sys-motion-fast);
}

.preview-mode-btn:hover {
  color: var(--md-sys-color-on-surface);
}

.preview-mode-btn--active {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.preview-address {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--md-sys-color-surface-container-lowest);
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface);
  font-size: 12.5px;
  font-weight: 500;
  font-family: "Monaspace Neon", "JetBrains Mono", monospace;
}

.preview-address--idle {
  color: var(--md-sys-color-on-surface-variant);
  font-style: italic;
  font-family: inherit;
}

.preview-address-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-address-meta {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.preview-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.preview-icon-btn {
  color: var(--md-sys-color-on-surface-variant) !important;
}

.preview-error {
  margin: 10px 12px 0;
  border-radius: var(--md-sys-shape-medium);
}

.preview-error-text {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font: 11.5px/1.5 "Monaspace Neon", "JetBrains Mono", monospace;
}

.preview-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.preview-empty {
  position: relative;
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--md-sys-color-surface-container-low);
  overflow: hidden;
}

.preview-empty-card {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 10px;
  max-width: 340px;
  padding: 28px 28px 24px;
  border-radius: var(--md-sys-shape-large);
  background: var(--md-sys-color-surface-container-lowest);
  border: 1px solid var(--md-sys-color-outline-variant);
  text-align: center;
  box-shadow: var(--md-sys-elevation-1);
}

.preview-empty-icon {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  margin-bottom: 4px;
}

.preview-empty-card h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--md-sys-color-on-surface);
}

.preview-empty-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--md-sys-color-on-surface-variant);
}

.preview-empty-cta {
  margin-top: 10px;
}

.preview-frame {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: 0;
  background: #fff;
}

.preview-terminal-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #0e1014;
}

.preview-terminal {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 16px 18px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: #c4c8d0;
  font: 12.5px/1.6 "Monaspace Neon", "JetBrains Mono", monospace;
}

.preview-terminal-prompt {
  color: #9aa4b4;
  font-weight: 700;
}
</style>
