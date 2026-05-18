export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000"
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "dev-anon-key"

function sameOriginProxyUrl(path: string): string {
  if (typeof window === "undefined") return path
  return `${window.location.origin}${path}`
}

function supabaseUrl(): string {
  const configured = import.meta.env.VITE_SUPABASE_URL
  if (!configured) return sameOriginProxyUrl("/supabase")

  try {
    const url = new URL(configured)
    if (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === "54321" &&
      typeof window !== "undefined"
    ) {
      return sameOriginProxyUrl("/supabase")
    }
  } catch {
    return configured
  }

  return configured
}

export const SUPABASE_URL = supabaseUrl()

export function collabUrl(): string {
  const configured = import.meta.env.VITE_COLLAB_URL
  if (configured) return configured

  if (typeof window === "undefined") return "ws://localhost:3001"
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  if (window.location.port === "5173") return "ws://localhost:3001"

  return `${protocol}//${window.location.host}/collab`
}

export function voiceUrl(): string {
  const configured = import.meta.env.VITE_VOICE_URL
  if (configured) return configured

  if (typeof window === "undefined") return "ws://localhost:3003"
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  if (window.location.port === "5173") return "ws://localhost:3003"

  return `${protocol}//${window.location.host}/voice`
}
