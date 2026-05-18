<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"

type Direction = "horizontal" | "vertical"

const props = withDefaults(
  defineProps<{
    direction?: Direction
    initial?: number
    min?: number
    max?: number
    storageKey?: string
  }>(),
  {
    direction: "vertical",
    initial: 50,
    min: 10,
    max: 90
  }
)

const containerRef = ref<HTMLElement | null>(null)
const isResizing = ref(false)

function loadPercent(): number {
  if (typeof window !== "undefined" && props.storageKey) {
    const raw = window.localStorage.getItem(props.storageKey)
    if (raw) {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) return clamp(parsed)
    }
  }
  return clamp(props.initial)
}

function clamp(value: number) {
  return Math.min(props.max, Math.max(props.min, value))
}

const percent = ref(loadPercent())

const startStyle = computed(() => {
  return props.direction === "vertical"
    ? { flexBasis: `${percent.value}%`, minHeight: "0" }
    : { flexBasis: `${percent.value}%`, minWidth: "0" }
})

function onPointerMove(event: PointerEvent) {
  if (!isResizing.value || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  if (props.direction === "vertical") {
    const total = rect.height
    if (total <= 0) return
    const next = ((event.clientY - rect.top) / total) * 100
    percent.value = clamp(next)
  } else {
    const total = rect.width
    if (total <= 0) return
    const next = ((event.clientX - rect.left) / total) * 100
    percent.value = clamp(next)
  }
}

function stopResize() {
  if (!isResizing.value) return
  isResizing.value = false
  document.body.style.cursor = ""
  document.body.style.userSelect = ""
}

function startResize(event: PointerEvent) {
  event.preventDefault()
  isResizing.value = true
  document.body.style.cursor = props.direction === "vertical" ? "row-resize" : "col-resize"
  document.body.style.userSelect = "none"
}

watch(percent, (value) => {
  if (typeof window !== "undefined" && props.storageKey) {
    window.localStorage.setItem(props.storageKey, String(value))
  }
})

onMounted(() => {
  window.addEventListener("pointermove", onPointerMove)
  window.addEventListener("pointerup", stopResize)
})

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onPointerMove)
  window.removeEventListener("pointerup", stopResize)
  stopResize()
})
</script>

<template>
  <div ref="containerRef" class="splitter" :class="`splitter--${direction}`">
    <div class="splitter-pane splitter-pane--start" :style="startStyle">
      <slot name="start" />
    </div>
    <div
      class="splitter-handle"
      :class="{ 'splitter-handle--active': isResizing }"
      role="separator"
      :aria-orientation="direction === 'vertical' ? 'horizontal' : 'vertical'"
      @pointerdown="startResize"
    >
      <span class="splitter-handle-grip" />
    </div>
    <div class="splitter-pane splitter-pane--end">
      <slot name="end" />
    </div>
  </div>
</template>

<style scoped>
.splitter {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
}

.splitter--vertical {
  flex-direction: column;
}

.splitter--horizontal {
  flex-direction: row;
}

.splitter-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.splitter-pane--end {
  flex: 1;
}

.splitter-handle {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  flex-shrink: 0;
}

.splitter--vertical > .splitter-handle {
  height: 8px;
  cursor: row-resize;
}

.splitter--horizontal > .splitter-handle {
  width: 8px;
  cursor: col-resize;
}

.splitter-handle-grip {
  display: block;
  background: var(--md-sys-color-outline-variant);
  border-radius: 999px;
  transition: background 160ms cubic-bezier(0.2, 0, 0, 1);
}

.splitter--vertical .splitter-handle-grip {
  width: 32px;
  height: 3px;
}

.splitter--horizontal .splitter-handle-grip {
  width: 3px;
  height: 32px;
}

.splitter-handle:hover .splitter-handle-grip,
.splitter-handle--active .splitter-handle-grip {
  background: var(--md-sys-color-primary);
}
</style>
