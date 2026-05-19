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

/**
 * Run a shell script inside a workspace container and capture combined output.
 * Uses plain `sh -c` (no login flag) — `sh -lc` can fail on minimal Alpine bases.
 */
async function execCapture(input: {
  workspaceId: string
  script: string
  workingDir?: string
  env?: string[]
}): Promise<{ output: string; exitCode: number | null }> {
  const container = docker.getContainer(containerName(input.workspaceId))
  const exec = await container.exec({
    Cmd: ["sh", "-c", input.script],
    WorkingDir: input.workingDir ?? "/workspace",
    Env: input.env,
    AttachStdout: true,
    AttachStderr: true
  })
  const stream = await exec.start({})
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(Buffer.from(chunk))
        cb()
      }
    })
    docker.modem.demuxStream(stream, sink, sink)
    stream.on("end", () => resolve())
    stream.on("error", reject)
  })
  const inspect = await exec.inspect().catch(() => null)
  return {
    output: Buffer.concat(chunks).toString("utf8"),
    exitCode: inspect?.ExitCode ?? null
  }
}

async function waitForPreview(input: {
  ip: string
  port: number
  timeoutMs: number
  workspaceId: string
  previewId: string
  pidPath: string
  logPath: string
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs
  let lastError: unknown
  let iterations = 0
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

    // Cheap liveness probe every couple of cycles — if the spawned process
    // exited (bad command, missing binary, port collision, etc.) there's no
    // point waiting the full timeout. Fast-fail with the diagnostic.
    iterations += 1
    if (iterations >= 3 && iterations % 3 === 0) {
      const liveness = await execCapture({
        workspaceId: input.workspaceId,
        script: `if [ -f ${shellQuote(input.pidPath)} ] && kill -0 $(cat ${shellQuote(input.pidPath)}) 2>/dev/null; then echo alive; else echo dead; fi`
      }).catch(() => null)
      if (liveness?.output.trim() === "dead") {
        break
      }
    }

    await sleep(500)
  }

  // Dump every piece of state that's useful for diagnosing why the spawn never
  // produced a listening server: process list, PID file, log tail, listening
  // sockets, and workspace contents. Returned as a single string so the error
  // travels back to the UI intact.
  const diagScript = [
    `echo "=== pid file (${input.pidPath}) ==="`,
    `[ -f ${shellQuote(input.pidPath)} ] && cat ${shellQuote(input.pidPath)} || echo "(missing)"`,
    `echo`,
    `echo "=== log file (${input.logPath}, last 2k) ==="`,
    `[ -f ${shellQuote(input.logPath)} ] && tail -c 2048 ${shellQuote(input.logPath)} || echo "(missing)"`,
    `echo`,
    `echo "=== running processes ==="`,
    `(ps -ef 2>/dev/null || ps aux 2>/dev/null || ps 2>/dev/null) | head -40 || echo "(no ps)"`,
    `echo`,
    `echo "=== listening sockets ==="`,
    `(ss -tln 2>/dev/null || netstat -tln 2>/dev/null) | head -20 || echo "(no ss/netstat)"`,
    `echo`,
    `echo "=== workspace contents ==="`,
    `ls -la /workspace 2>&1 | head -40 || true`
  ].join("\n")

  let diag = "(no diagnostics)"
  try {
    const result = await execCapture({ workspaceId: input.workspaceId, script: diagScript })
    diag = result.output.trim() || diag
  } catch (error) {
    diag = `(diagnostics failed: ${error instanceof Error ? error.message : "unknown"})`
  }
  const reason = lastError instanceof Error ? lastError.message : "timeout"
  throw new Error(`Preview did not start on ${input.ip}:${input.port}: ${reason}\n${diag}`)
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
  // The container was just restarted, so /tmp is fresh and nothing is running
  // besides PID 1's `sleep infinity` — no need to hunt for leftover processes
  // (and a `ps | awk '/php -S/'` pattern would match our own `sh -c` argv,
  // SIGTERM the running script, and exit with code 143 before the spawn).
  //
  // `nohup ... &` detaches the child so it survives the exec returning. We
  // also write a small header to the log so an empty log is distinguishable
  // from "the script never ran at all", and probe liveness 1s later so a
  // fail-fast (`command not found`, port collision, etc.) is captured.
  const script = [
    `set +e`,
    `printf '[whaler] starting: %s\\n[whaler] pwd=%s\\n' ${shellQuote(command)} "$(pwd)" > ${shellQuote(logPath)}`,
    `PORT=${input.port} WHALER_PREVIEW_ID=${shellQuote(input.previewId)} nohup sh -c ${shellQuote(command)} >> ${shellQuote(logPath)} 2>&1 < /dev/null &`,
    `printf '%s' "$!" > ${pidPath}`,
    `sleep 1`,
    `printf '[whaler] spawn-pid=%s alive=%s\\n' "$(cat ${pidPath} 2>/dev/null)" "$(kill -0 $(cat ${pidPath} 2>/dev/null) 2>/dev/null && echo yes || echo no)" >> ${shellQuote(logPath)}`
  ].join("\n")

  const result = await execCapture({
    workspaceId: input.workspaceId,
    script
  })
  if (result.exitCode && result.exitCode !== 0) {
    throw new Error(
      `Preview spawn exited with code ${result.exitCode}: ${result.output.trim() || "(no output)"}`
    )
  }

  previewTargets.set(input.standHost, { ip, port: input.port })
  await waitForPreview({
    ip,
    port: input.port,
    timeoutMs: 30_000,
    workspaceId: input.workspaceId,
    previewId: input.previewId,
    pidPath,
    logPath
  })

  return {
    status: "running" as const,
    logPath
  }
}

// We don't proxy WebSockets to the sandbox, so we replace Vite's HMR client
// with a minimal shim that:
//   1. silences the "failed to connect to websocket" warnings (no WS),
//   2. implements updateStyle/removeStyle so CSS imports still inject <style>
//      tags into the document (otherwise stylesheets silently disappear),
//   3. returns no-op hot contexts so `import.meta.hot.*` calls don't throw.
const VITE_HMR_NOOP_SCRIPT = `
const sheetsMap = new Map();
let lastInsertedStyle;

export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    document.head.appendChild(style);
    if (lastInsertedStyle && style.previousSibling !== lastInsertedStyle) {
      document.head.insertBefore(style, lastInsertedStyle.nextSibling);
    }
    lastInsertedStyle = style;
  }
  style.textContent = content;
  sheetsMap.set(id, style);
}

export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}

const noopHotContext = {
  accept() {}, acceptExports() {}, dispose() {}, prune() {},
  decline() {}, invalidate() {},
  on() {}, off() {}, send() {}, data: {}
};
export const createHotContext = () => noopHotContext;
export const injectQuery = (url) => url;
export const ErrorOverlay = class {};
`

const VITE_CLIENT_PATHS = new Set(["/@vite/client", "/@vite/env"])

export async function proxyPreviewRequest(request: Request): Promise<Response> {
  const host = request.headers.get("host")?.split(":")[0] ?? ""
  const target = previewTargets.get(host)
  if (!target) {
    return new Response("Preview is not running", { status: 404 })
  }

  const url = new URL(request.url)

  if (VITE_CLIENT_PATHS.has(url.pathname)) {
    return new Response(VITE_HMR_NOOP_SCRIPT, {
      status: 200,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store"
      }
    })
  }

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
      // Strip the Vite HMR client tag regardless of attribute order/extras.
      html = html.replaceAll(
        /<script\b[^>]*\bsrc=["']\/@vite\/client["'][^>]*><\/script>\s*/gi,
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

export async function readPreviewLog(input: {
  workspaceId: string
  previewId: string
  maxBytes?: number | undefined
}): Promise<string> {
  const maxBytes = input.maxBytes ?? 64_000
  const logPath = `/tmp/whaler-preview-${input.previewId}.log`
  const result = await execCapture({
    workspaceId: input.workspaceId,
    script: `[ -f ${shellQuote(logPath)} ] && tail -c ${maxBytes} ${shellQuote(logPath)} || true`
  })
  return result.output
}

export async function runTerminalPreview(input: {
  workspaceId: string
  command: string
  port: number
  activePath?: string | undefined
}) {
  const command = commandWithPort(input.command, input.port)
  const result = await execCapture({
    workspaceId: input.workspaceId,
    script: command,
    env: [`PORT=${input.port}`, `FILE=${input.activePath ?? ""}`]
  })
  return {
    exitCode: result.exitCode,
    output: result.output.slice(-40_000)
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
