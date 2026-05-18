import Docker from "dockerode"
import { Writable } from "node:stream"
import tar from "tar-stream"
import { normalizeWorkspacePath } from "@whaler/shared"
import { env } from "./env"

export const docker = new Docker({
  socketPath: env.dockerSocketPath
})

const previewTargets = new Map<string, { ip: string; port: number }>()

function containerName(workspaceId: string): string {
  return `whaler-${workspaceId}`
}

function volumeName(workspaceId: string): string {
  return `whaler-workspace-${workspaceId}`
}

async function getExistingWorkspaceContainer(workspaceId: string) {
  const name = containerName(workspaceId)
  const rows = await docker.listContainers({
    all: true,
    filters: {
      name: [`^/${name}$`]
    }
  })
  const match = rows.find((row) => row.Names?.includes(`/${name}`))
  return match ? docker.getContainer(match.Id) : null
}

function hasMissingNetworkReference(info: Docker.ContainerInspectInfo): boolean {
  return Object.entries(info.NetworkSettings.Networks ?? {}).some(([networkName, network]) => {
    return networkName !== "none" && !network.NetworkID
  })
}

function needsNetworkMigration(info: Docker.ContainerInspectInfo): boolean {
  return Boolean(info.NetworkSettings.Networks?.none && !info.NetworkSettings.Networks?.[env.previewNetworkName])
}

function isMissingNetworkStartError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "json" in error
        ? String((error as { json?: { message?: string } }).json?.message ?? "")
        : String(error)

  return message.includes("failed to set up container networking") && message.includes("network")
}

async function ensureImage(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect()
    return
  } catch {
    // Pull below when the image is not present locally.
  }

  const stream = await docker.pull(image)
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (error: Error | null) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function commandWithPort(command: string, port: number): string {
  return command.replaceAll("${PORT}", String(port))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPreview(input: { ip: string; port: number; timeoutMs: number }): Promise<void> {
  const deadline = Date.now() + input.timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${input.ip}:${input.port}/`, {
        method: "GET",
        signal: AbortSignal.timeout(1000)
      })
      if (response.status < 500) return
    } catch (error) {
      lastError = error
    }
    await sleep(500)
  }

  throw new Error(
    `Preview did not start on ${input.ip}:${input.port}: ${
      lastError instanceof Error ? lastError.message : "timeout"
    }`
  )
}

async function ensureContainerNetwork(workspaceId: string): Promise<string> {
  const name = containerName(workspaceId)
  const container = docker.getContainer(name)
  let info = await container.inspect()

  if (!info.NetworkSettings.Networks?.[env.previewNetworkName]) {
    await docker
      .createNetwork({
        Name: env.previewNetworkName,
        Driver: "bridge",
        CheckDuplicate: true,
        Labels: {
          "whaler.managed": "true",
          "whaler.purpose": "preview"
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes("already exists")) throw error
      })

    const network = docker.getNetwork(env.previewNetworkName)
    await network
      .connect({
        Container: name
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes("already exists")) throw error
      })
    info = await container.inspect()
  }

  const ip = info.NetworkSettings.Networks?.[env.previewNetworkName]?.IPAddress
  if (!ip) {
    throw new Error(`Container is not reachable on ${env.previewNetworkName}`)
  }

  return ip
}

export async function createContainer(input: { workspaceId: string; image: string }) {
  await ensureImage(input.image)
  const name = containerName(input.workspaceId)
  const volume = volumeName(input.workspaceId)

  const existing = await getExistingWorkspaceContainer(input.workspaceId)
  if (existing) {
    let info: Docker.ContainerInspectInfo | null = await existing.inspect()
    if (hasMissingNetworkReference(info) || needsNetworkMigration(info)) {
      await existing.remove({ force: true, v: false })
    } else {
      if (!info.State.Running) {
        try {
          await existing.start()
        } catch (error) {
          if (!isMissingNetworkStartError(error)) throw error
          await existing.remove({ force: true, v: false })
        }
        const nextInfo = await existing.inspect().catch(() => null)
        info = nextInfo
      }
      if (info?.Id) {
        return {
          id: info.Id,
          status: "running" as const
        }
      }
    }
  }

  await docker.createVolume({ Name: volume }).catch(() => undefined)

  const container = await docker.createContainer({
    Image: input.image,
    name,
    Cmd: ["sleep", "infinity"],
    WorkingDir: "/workspace",
    Labels: {
      "whaler.workspace_id": input.workspaceId,
      "whaler.managed": "true"
    },
    HostConfig: {
      Binds: [`${volume}:/workspace`],
      Memory: env.memoryBytes,
      NanoCpus: env.nanoCpus,
      PidsLimit: env.pidsLimit,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      NetworkMode: env.previewNetworkName,
      AutoRemove: false
    }
  })

  await container.start()
  const info = await container.inspect()
  return {
    id: info.Id,
    status: "running" as const
  }
}

export async function startWebPreview(input: {
  workspaceId: string
  previewId: string
  standHost: string
  command: string
  port: number
  activePath?: string | undefined
}) {
  const ip = await ensureContainerNetwork(input.workspaceId)

  const container = docker.getContainer(containerName(input.workspaceId))
  await container.restart({ t: 2 })
  const pidPath = `/tmp/whaler-preview-web.pid`
  const logPath = `/tmp/whaler-preview-${input.previewId}.log`
  const command = commandWithPort(input.command, input.port)
  const script = [
    `if [ -f ${pidPath} ]; then kill -TERM -- "-$(cat ${pidPath})" 2>/dev/null || kill "$(cat ${pidPath})" 2>/dev/null || true; fi`,
    `if command -v ps >/dev/null 2>&1; then ps -eo pid=,args= | awk '/[v]ite|[n]pm run dev|[n]pm run preview|[p]hp -S|[p]ython -m http.server|[b]un .*dev|[d]eno task dev/ {print $1}' | xargs -r kill 2>/dev/null || true; fi`,
    `rm -f ${pidPath}`,
    `PORT=${input.port} WHALER_PREVIEW_ID=${shellQuote(input.previewId)} setsid sh -lc ${shellQuote(command)} > ${shellQuote(logPath)} 2>&1 &`,
    `echo $! > ${pidPath}`
  ].join("\n")

  const exec = await container.exec({
    Cmd: ["sh", "-lc", script],
    WorkingDir: "/workspace",
    AttachStdout: true,
    AttachStderr: true
  })
  await exec.start({})
  previewTargets.set(input.standHost, { ip, port: input.port })
  await waitForPreview({ ip, port: input.port, timeoutMs: 30_000 })

  return {
    status: "running" as const,
    logPath
  }
}

export async function proxyPreviewRequest(request: Request): Promise<Response> {
  const host = request.headers.get("host")?.split(":")[0] ?? ""
  const target = previewTargets.get(host)
  if (!target) {
    return new Response("Preview is not running", { status: 404 })
  }

  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  for (const header of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
  ]) {
    headers.delete(header)
  }
  headers.set("host", `${target.ip}:${target.port}`)

  try {
    const response = await fetch(`http://${target.ip}:${target.port}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      duplex: "half"
    } as RequestInit & { duplex: "half" })

    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.includes("text/html")) {
      let html = await response.text()
      html = html.replaceAll(
        /<script\s+type=["']module["']\s+src=["']\/@vite\/client["']><\/script>\s*/g,
        ""
      )
      if (!/^\s*<!doctype html>/i.test(html)) {
        html = `<!DOCTYPE html>${html}`
      }
      const nextHeaders = new Headers(response.headers)
      nextHeaders.delete("content-length")
      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers: nextHeaders
      })
    }

    return response
  } catch (error) {
    return new Response(`Preview is starting: ${error instanceof Error ? error.message : "upstream unavailable"}`, {
      status: 503
    })
  }
}

export async function runTerminalPreview(input: {
  workspaceId: string
  command: string
  port: number
  activePath?: string | undefined
}) {
  const container = docker.getContainer(containerName(input.workspaceId))
  const command = commandWithPort(input.command, input.port)
  const exec = await container.exec({
    Cmd: ["sh", "-lc", command],
    WorkingDir: "/workspace",
    Env: [`PORT=${input.port}`, `FILE=${input.activePath ?? ""}`],
    AttachStdout: true,
    AttachStderr: true
  })
  const stream = await exec.start({})
  const chunks: Buffer[] = []

  await new Promise<void>((resolve, reject) => {
    const stdout = new Writable({
      write(chunk: Buffer) {
        chunks.push(Buffer.from(chunk))
        return true
      }
    })
    const stderr = new Writable({
      write(chunk: Buffer) {
        chunks.push(Buffer.from(chunk))
        return true
      }
    })

    docker.modem.demuxStream(stream, stdout, stderr)
    stream.on("end", resolve)
    stream.on("error", reject)
  })

  const inspect = await exec.inspect()
  return {
    exitCode: inspect.ExitCode ?? null,
    output: Buffer.concat(chunks).toString("utf8").slice(-40_000)
  }
}

export async function putWorkspaceEntry(input: {
  workspaceId: string
  path: string
  kind: "file" | "directory"
  content?: string | undefined
}) {
  const safePath = normalizeWorkspacePath(input.path)
  const container = docker.getContainer(containerName(input.workspaceId))
  const pack = tar.pack()

  if (input.kind === "directory") {
    pack.entry({ name: safePath, type: "directory", mode: 0o755 }, (error) => {
      if (error) pack.destroy(error)
      else pack.finalize()
    })
  } else {
    pack.entry({ name: safePath, mode: 0o644 }, input.content ?? "", (error) => {
      if (error) pack.destroy(error)
      else pack.finalize()
    })
  }

  await container.putArchive(pack, {
    path: "/workspace"
  })
}
