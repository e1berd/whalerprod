import { cpus, networkInterfaces } from "node:os"

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function detectLanIp(): string | null {
  const interfaces = networkInterfaces()
  for (const list of Object.values(interfaces)) {
    if (!list) continue
    for (const iface of list) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address
    }
  }
  return null
}

function resolveAnnouncedIp(): string {
  const raw = process.env.MEDIASOUP_ANNOUNCED_IP
  if (raw && raw !== "auto") return raw
  return detectLanIp() ?? "127.0.0.1"
}

const announcedIp = resolveAnnouncedIp()

if (!process.env.MEDIASOUP_ANNOUNCED_IP || process.env.MEDIASOUP_ANNOUNCED_IP === "auto") {
  console.log(`voice: announcing WebRTC candidates on ${announcedIp} (auto-detected)`)
}

export const env = {
  port: parsePort(process.env.VOICE_PORT ?? process.env.PORT, 3003),
  databaseUrl: required("DATABASE_URL"),
  supabaseJwtSecret: required("SUPABASE_JWT_SECRET"),
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321",
  mediasoup: {
    listenIp: process.env.MEDIASOUP_LISTEN_IP ?? "0.0.0.0",
    announcedIp,
    rtcMinPort: parsePort(process.env.MEDIASOUP_RTC_MIN_PORT, 40000),
    rtcMaxPort: parsePort(process.env.MEDIASOUP_RTC_MAX_PORT, 40100),
    workerCount: parsePort(process.env.MEDIASOUP_WORKERS, Math.max(1, cpus().length))
  }
}
