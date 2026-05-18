function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  supabaseJwtSecret: required("SUPABASE_JWT_SECRET"),
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321",
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  runnerInternalUrl: process.env.RUNNER_INTERNAL_URL ?? "http://localhost:3002",
  runnerInternalToken: process.env.RUNNER_INTERNAL_TOKEN ?? "",
  standBaseDomain: process.env.STAND_BASE_DOMAIN ?? "localhost",
  standPublicPort: Number(process.env.STAND_PUBLIC_PORT ?? 3002)
}
