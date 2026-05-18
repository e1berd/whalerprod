<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue"
import { useRouter } from "@kitbag/router"
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
const theme = useTheme()
const { mdAndUp } = useDisplay()
const { session, authReady, authNotice, currentUser } = useSession()

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
</script>

<template>
  <main v-if="!authReady" class="boot-screen">
    <div class="boot-indicator">
      <div class="brand-mark">W</div>
      <span>Loading Whaler</span>
    </div>
  </main>
  <AuthView v-else-if="!session" :notice="authNotice" />
  <v-app v-else class="app-shell">
    <v-app-bar :height="mdAndUp ? 64 : 56" flat class="app-bar">
      <div id="app-bar-context" class="app-bar-context" />
      <v-spacer />
      <div class="app-bar-actions">
        <v-chip class="user-chip" size="small" variant="tonal">
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

    <v-navigation-drawer :width="mdAndUp ? 64 : 56" permanent class="navigation-rail">
      <div class="nav-rail-content">
        <div class="nav-rail-items nav-rail-items--top">
          <v-tooltip location="right" text="Workspaces">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                class="nav-rail-button"
                icon="mdi-view-dashboard-outline"
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
                icon="mdi-cog-outline"
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
.app-bar-context {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  margin-inline-start: 8px;
}

.nav-rail-content {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  padding: 8px 0;
}

.nav-rail-items {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.nav-rail-button {
  width: 44px !important;
  height: 44px !important;
}

.nav-rail-button--danger :deep(.v-icon) {
  color: rgb(var(--v-theme-error));
}

.user-chip-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font-weight: 600;
  font-size: 11px;
  margin-right: 6px;
}

.user-chip-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
