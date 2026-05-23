<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue"
import { useRoute, useRouter } from "@kitbag/router"
import { useDisplay, useTheme } from "vuetify"
import AuthView from "@/components/AuthView.vue"
import { initSession, signOut, teardownSession, useSession } from "@/lib/session"
import {
  applyDocumentTheme,
  effectiveThemeName,
  initializeThemePreference,
  teardownTheme
} from "@/lib/theme"

const router = useRouter()
const route = useRoute()
const theme = useTheme()
const { mdAndUp } = useDisplay()
const { session, authReady, authNotice, passwordRecovery, currentUser } = useSession()

onMounted(async () => {
  initializeThemePreference()
  await initSession()
})

onBeforeUnmount(() => {
  teardownSession()
  teardownTheme()
})

watch(
  effectiveThemeName,
  (themeName) => {
    theme.change(themeName)
    applyDocumentTheme(themeName)
  },
  { immediate: true }
)

const activeKey = computed<"home" | "settings" | null>(() => {
  const name = route.name as string | undefined
  if (name === "settings") return "settings"
  if (name === "home" || name === "workspace-create" || name === "workspace-detail") return "home"
  return null
})
</script>

<template>
  <main v-if="!authReady" class="boot-screen">
    <div class="boot-indicator">
      <div class="brand-mark">W</div>
      <span>Loading WhalerProd</span>
    </div>
  </main>
  <AuthView v-else-if="!session || passwordRecovery" :notice="authNotice" :password-recovery="passwordRecovery" />
  <v-app v-else class="app-shell">
    <v-app-bar :height="mdAndUp ? 64 : 56" flat class="app-bar">
      <div class="app-bar-brand">
        <div class="brand-mark">W</div>
        <span class="app-bar-brand-name">WhalerProd</span>
      </div>
      <div id="app-bar-context" class="app-bar-context" />
      <v-spacer />
      <div class="app-bar-actions">
        <v-chip class="user-chip" size="small" variant="flat">
          <template #prepend>
            <span class="user-chip-avatar" :style="{ backgroundColor: currentUser.color }">
              <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" :alt="currentUser.name" />
              <template v-else>{{ currentUser.name.charAt(0).toUpperCase() }}</template>
            </span>
          </template>
          {{ currentUser.name }}
        </v-chip>
      </div>
    </v-app-bar>

    <v-navigation-drawer :width="mdAndUp ? 76 : 64" permanent class="navigation-rail">
      <div class="nav-rail-content">
        <div class="nav-rail-items nav-rail-items--top">
          <v-tooltip location="right" text="Workspaces">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                class="nav-rail-button"
                :class="{ 'nav-rail-button--active': activeKey === 'home' }"
                :icon="activeKey === 'home' ? 'mdi-view-dashboard' : 'mdi-view-dashboard-outline'"
                variant="text"
                @click="router.push('home')"
              />
            </template>
          </v-tooltip>
          <v-tooltip location="right" text="Settings">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                class="nav-rail-button"
                :class="{ 'nav-rail-button--active': activeKey === 'settings' }"
                :icon="activeKey === 'settings' ? 'mdi-cog' : 'mdi-cog-outline'"
                variant="text"
                @click="router.push('settings')"
              />
            </template>
          </v-tooltip>
        </div>
        <div class="nav-rail-items nav-rail-items--bottom">
          <v-tooltip location="right" text="Sign out">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                class="nav-rail-button nav-rail-button--danger"
                icon="mdi-logout"
                variant="text"
                color="error"
                @click="signOut"
              />
            </template>
          </v-tooltip>
        </div>
      </div>
    </v-navigation-drawer>

    <v-main class="main-surface">
      <router-view />
    </v-main>
  </v-app>
</template>

<style scoped>
.app-bar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 0 14px;
  margin-right: 14px;
}

.app-bar-brand-name {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--md-sys-color-on-surface);
}

@media (max-width: 720px) {
  .app-bar-brand-name {
    display: none;
  }
}

.app-bar-context {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-rail-content {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  padding: 14px 0 18px;
}

.nav-rail-items {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.user-chip-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font-weight: 700;
  font-size: 12px;
  margin-right: 4px;
}

.user-chip-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
