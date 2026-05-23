<script setup lang="ts">
import { computed, ref } from "vue"
import { authRedirectUrl } from "@/lib/config"
import { finishPasswordRecovery } from "@/lib/session"
import { supabase } from "@/lib/supabase"

const props = defineProps<{
  notice?: string | null
  passwordRecovery?: boolean
}>()

const email = ref("")
const password = ref("")
const newPassword = ref("")
const loading = ref(false)
const mode = ref<"sign-in" | "sign-up" | "forgot-password">("sign-in")
const error = ref<string | null>(null)
const success = ref<string | null>(null)

const activeMode = computed(() => (props.passwordRecovery ? "password-recovery" : mode.value))
const heading = computed(() => {
  if (activeMode.value === "password-recovery") return "Set a new password"
  if (activeMode.value === "forgot-password") return "Recover your account"
  return activeMode.value === "sign-in" ? "Welcome back" : "Create your account"
})
const supporting = computed(() => {
  if (activeMode.value === "password-recovery") return "Choose a new password for your WhalerProd account."
  if (activeMode.value === "forgot-password") return "Enter your email and we will send a recovery link."
  return activeMode.value === "sign-in"
    ? "Sign in to jump into a workspace and pick up where you left off."
    : "Start a sandbox in seconds and invite teammates in realtime."
})

function switchMode(nextMode: "sign-in" | "sign-up" | "forgot-password") {
  mode.value = nextMode
  error.value = null
  success.value = null
}

async function submit() {
  loading.value = true
  error.value = null
  success.value = null

  if (activeMode.value === "password-recovery") {
    const result = await supabase.auth.updateUser({ password: newPassword.value })
    if (result.error) {
      error.value = result.error.message
    } else {
      success.value = "Password updated. You can continue using your account."
      newPassword.value = ""
      finishPasswordRecovery()
    }
    loading.value = false
    return
  }

  if (activeMode.value === "forgot-password") {
    const result = await supabase.auth.resetPasswordForEmail(email.value, {
      redirectTo: authRedirectUrl()
    })
    if (result.error) {
      error.value = result.error.message
    } else {
      success.value = "Recovery link sent. Check your email."
    }
    loading.value = false
    return
  }

  if (activeMode.value === "sign-in") {
    const result = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
    if (result.error) error.value = result.error.message
    loading.value = false
    return
  }

  const result = await supabase.auth.signUp({
    email: email.value,
    password: password.value,
    options: {
      emailRedirectTo: authRedirectUrl()
    }
  })
  if (result.error) {
    error.value = result.error.message
  } else {
    success.value = "Confirmation link sent. Check your email before signing in."
    password.value = ""
  }

  loading.value = false
}
</script>

<template>
  <main class="auth-screen">
    <section class="auth-shell">
      <aside class="auth-hero">
        <div class="auth-hero-mark">W</div>
        <div>
          <h1 class="auth-hero-title">Build together,<br />in any sandbox.</h1>
          <p class="auth-hero-sub">Realtime workspaces with voice, shared cursors and one-tap previews.</p>
        </div>
        <ul class="auth-hero-bullets">
          <li><span class="i">⚡</span> Spin up containers in seconds</li>
          <li><span class="i">🎙</span> Lossless voice while you ship</li>
          <li><span class="i">🌀</span> Live cursors and shared state</li>
        </ul>
      </aside>

      <section class="auth-panel">
        <p class="auth-eyebrow">WhalerProd</p>
        <h2 class="auth-heading">{{ heading }}</h2>
        <p class="auth-supporting">{{ supporting }}</p>

        <v-btn-toggle
          v-if="activeMode === 'sign-in' || activeMode === 'sign-up'"
          v-model="mode"
          mandatory
          density="comfortable"
          color="primary"
          class="auth-mode-toggle"
        >
          <v-btn type="button" value="sign-in" prepend-icon="mdi-login" @click="switchMode('sign-in')">Sign in</v-btn>
          <v-btn type="button" value="sign-up" prepend-icon="mdi-account-plus" @click="switchMode('sign-up')">
            Sign up
          </v-btn>
        </v-btn-toggle>

        <v-alert v-if="notice" type="info" density="comfortable" variant="tonal" rounded="lg">
          {{ notice }}
        </v-alert>

        <v-form class="auth-form" @submit.prevent="submit">
          <v-text-field
            v-if="activeMode !== 'password-recovery'"
            v-model="email"
            type="email"
            label="Email"
            autocomplete="email"
            density="comfortable"
            variant="solo-filled"
            prepend-inner-icon="mdi-email-outline"
            hide-details="auto"
          />
          <v-text-field
            v-if="activeMode === 'sign-in' || activeMode === 'sign-up'"
            v-model="password"
            type="password"
            label="Password"
            :autocomplete="activeMode === 'sign-in' ? 'current-password' : 'new-password'"
            density="comfortable"
            variant="solo-filled"
            prepend-inner-icon="mdi-lock-outline"
            hide-details="auto"
          />
          <v-text-field
            v-if="activeMode === 'password-recovery'"
            v-model="newPassword"
            type="password"
            label="New password"
            autocomplete="new-password"
            density="comfortable"
            variant="solo-filled"
            prepend-inner-icon="mdi-lock-outline"
            hide-details="auto"
          />
          <v-alert v-if="success" type="success" density="compact" variant="tonal" rounded="lg">
            {{ success }}
          </v-alert>
          <v-alert v-if="error" type="error" density="compact" variant="tonal" rounded="lg">
            {{ error }}
          </v-alert>
          <v-btn
            type="submit"
            color="primary"
            variant="elevated"
            block
            class="auth-submit"
            :loading="loading"
            append-icon="mdi-arrow-right"
          >
            {{
              activeMode === "password-recovery"
                ? "Update password"
                : activeMode === "forgot-password"
                  ? "Send recovery link"
                  : activeMode === "sign-in"
                    ? "Sign in"
                    : "Create account"
            }}
          </v-btn>
          <v-btn
            v-if="activeMode === 'sign-in'"
            type="button"
            variant="text"
            class="auth-link"
            prepend-icon="mdi-lock-reset"
            @click="switchMode('forgot-password')"
          >
            Forgot password
          </v-btn>
          <v-btn
            v-if="activeMode === 'forgot-password'"
            type="button"
            variant="text"
            class="auth-link"
            prepend-icon="mdi-arrow-left"
            @click="switchMode('sign-in')"
          >
            Back to sign in
          </v-btn>
        </v-form>
      </section>
    </section>
  </main>
</template>

<style scoped>
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
}

.auth-link {
  align-self: center;
}
</style>
