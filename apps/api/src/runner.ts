import { env } from "./env"

export class RunnerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string
  ) {
    super(message)
    this.name = "RunnerRequestError"
  }
}

type RunnerContainerResponse = {
  containerId: string
  status: "running" | "starting"
}

export type PreviewResponse =
  | {
      status: "running"
      logPath: string
    }
  | {
      exitCode: number | null
      output: string
    }

async function runnerFetch(path: string, init: RequestInit): Promise<Response | null> {
  if (!env.runnerInternalUrl || !env.runnerInternalToken) {
    return null
  }

  try {
    return await fetch(`${env.runnerInternalUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-runner-token": env.runnerInternalToken,
        ...(init.headers ?? {})
      }
    })
  } catch (error) {
    throw new RunnerRequestError(
      `Runner is not reachable at ${env.runnerInternalUrl}: ${error instanceof Error ? error.message : "request failed"}`,
      503
    )
  }
}

export async function createSandboxContainer(input: {
  workspaceId: string
  image: string
}): Promise<RunnerContainerResponse | null> {
  const response = await runnerFetch("/internal/containers", {
    method: "POST",
    body: JSON.stringify(input)
  })

  if (!response) return null
  if (!response.ok) {
    const body = await response.text()
    throw new RunnerRequestError(`Runner failed to create container: ${body}`, response.status, body)
  }

  return (await response.json()) as RunnerContainerResponse
}

export async function mirrorWorkspaceEntry(input: {
  workspaceId: string
  path: string
  kind: "file" | "directory"
  content?: string | undefined
}): Promise<void> {
  const response = await runnerFetch(`/internal/workspaces/${input.workspaceId}/files`, {
    method: "PUT",
    body: JSON.stringify(input)
  })

  if (!response) return
  if (!response.ok) {
    const body = await response.text()
    throw new RunnerRequestError(`Runner failed to mirror workspace entry: ${body}`, response.status, body)
  }
}

export async function startWorkspacePreview(input: {
  workspaceId: string
  previewId: string
  standHost: string
  type: "web" | "terminal"
  command: string
  port: number
  activePath?: string | undefined
}): Promise<PreviewResponse | null> {
  const response = await runnerFetch("/internal/previews", {
    method: "POST",
    body: JSON.stringify(input)
  })

  if (!response) return null
  if (!response.ok) {
    const body = await response.text()
    throw new RunnerRequestError(`Runner failed to start preview: ${body}`, response.status, body)
  }

  return (await response.json()) as PreviewResponse
}
