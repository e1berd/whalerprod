export const env = {
  port: Number(process.env.RUNNER_PORT ?? process.env.PORT ?? 3002),
  token: process.env.RUNNER_INTERNAL_TOKEN ?? "",
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock",
  memoryBytes: Number(process.env.SANDBOX_MEMORY_BYTES ?? 536_870_912),
  nanoCpus: Number(process.env.SANDBOX_NANO_CPUS ?? 1_000_000_000),
  pidsLimit: Number(process.env.SANDBOX_PIDS_LIMIT ?? 256),
  previewNetworkName: process.env.PREVIEW_NETWORK_NAME ?? "whaler-preview"
}
