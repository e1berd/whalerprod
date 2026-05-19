import { randomUUID } from "node:crypto"
import { and, asc, desc, eq, ilike, inArray, like, sql } from "drizzle-orm"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { files, profiles, workspaceMembers, workspaces } from "@whaler/db/schema"
import { getSandboxImage, SANDBOX_IMAGES } from "@whaler/shared"
import { requireAuth } from "./auth"
import { db } from "./db"
import { env } from "./env"
import {
  createSandboxContainer,
  mirrorWorkspaceEntry,
  readWorkspacePreviewLog,
  RunnerRequestError,
  startWorkspacePreview
} from "./runner"
import {
  assertFileAccess,
  assertWorkspaceAccess,
  createWorkspaceWithDefaults,
  ensureWorkspaceDefaultFiles,
  languageFromPath,
  parseWorkspacePath,
  verifyWorkspacePassword
} from "./workspaces"

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  imageId: z.string().trim().min(1).max(80),
  password: z.string().trim().min(4).max(120).optional().nullable()
})

const joinWorkspaceSchema = z.object({
  password: z.string().min(1).max(120).optional()
})

const listWorkspacesSchema = z.object({
  q: z.string().trim().max(120).optional(),
  imageId: z.string().trim().max(80).optional()
})

const createFileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  kind: z.enum(["file", "directory"]),
  content: z.string().optional()
})

const updateFileSchema = z.object({
  content: z.string()
})

const renameFileSchema = z.object({
  path: z.string().trim().min(1).max(500)
})

const startPreviewSchema = z.object({
  type: z.enum(["web", "terminal"]),
  activePath: z.string().trim().min(1).max(500).optional().nullable()
})

const updateProfileSchema = z.object({
  avatarUrl: z.string().url().max(500).nullable().optional(),
  displayName: z.string().trim().min(1).max(80).optional()
})

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if ("code" in error && (error as { code?: string }).code === "23505") return true
  const cause = (error as { cause?: unknown }).cause
  return isUniqueViolation(cause)
}

function standUrl(host: string): string {
  const protocol = env.nodeEnv === "development" ? "http" : "https"
  const port = env.nodeEnv === "development" && env.standPublicPort ? `:${env.standPublicPort}` : ""
  return `${protocol}://${host}${port}`
}

type ContainerStatus = "pending" | "starting" | "running" | "stopped" | "error"

type PublicWorkspace = {
  id: string
  name: string
  imageId: string
  imageRef: string
  visibility: "public" | "protected"
  hasPassword: boolean
  containerStatus: ContainerStatus
  memberCount: number
  isMember: boolean
  ownerId: string
  createdAt: Date
}

const app = new Hono()

app.onError((error, c) => {
  if (error instanceof RunnerRequestError) {
    const status = error.status >= 500 ? 502 : error.status
    return c.text(error.message, status as 400)
  }
  if (error instanceof HTTPException) {
    return error.getResponse()
  }
  console.error(error)
  return c.text("Internal Server Error", 500)
})

app.use(
  "*",
  cors({
    origin: env.appOrigin.split(",").map((origin) => origin.trim()),
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true
  })
)

const routes = app
  .get("/health", (c) => c.json({ ok: true }))
  .use("/v1/*", requireAuth)
  .get("/v1/me", async (c) => {
    const user = c.get("user")
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1)
    return c.json({
      user,
      profile: profile
        ? {
            id: profile.id,
            email: profile.email,
            displayName: profile.displayName,
            color: profile.color,
            avatarUrl: profile.avatarUrl
          }
        : null
    })
  })
  .patch("/v1/me/profile", zValidator("json", updateProfileSchema), async (c) => {
    const user = c.get("user")
    const body = c.req.valid("json")
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (body.avatarUrl !== undefined) patch.avatarUrl = body.avatarUrl
    if (body.displayName !== undefined) patch.displayName = body.displayName
    const [updated] = await db
      .update(profiles)
      .set(patch)
      .where(eq(profiles.id, user.id))
      .returning()
    if (!updated) {
      throw new HTTPException(404, { message: "Profile not found" })
    }
    return c.json({
      profile: {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        color: updated.color,
        avatarUrl: updated.avatarUrl
      }
    })
  })
  .get("/v1/images", (c) => c.json({ images: SANDBOX_IMAGES }))
  .get("/v1/workspaces", zValidator("query", listWorkspacesSchema), async (c) => {
    const user = c.get("user")
    const { q, imageId } = c.req.valid("query")

    const filters = []
    if (q) filters.push(ilike(workspaces.name, `%${q}%`))
    if (imageId) filters.push(eq(workspaces.imageId, imageId))

    const rows = await db
      .select()
      .from(workspaces)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(workspaces.createdAt))
      .limit(200)

    if (rows.length === 0) {
      return c.json({ workspaces: [] as PublicWorkspace[] })
    }

    const ids = rows.map((row) => row.id)
    const members = await db
      .select()
      .from(workspaceMembers)
      .where(inArray(workspaceMembers.workspaceId, ids))

    const memberCounts = new Map<string, number>()
    const userMemberships = new Set<string>()
    for (const member of members) {
      memberCounts.set(member.workspaceId, (memberCounts.get(member.workspaceId) ?? 0) + 1)
      if (member.userId === user.id) userMemberships.add(member.workspaceId)
    }

    const result: PublicWorkspace[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      imageId: row.imageId,
      imageRef: row.imageRef,
      visibility: row.visibility,
      hasPassword: row.visibility === "protected" && Boolean(row.passwordHash),
      containerStatus: row.containerStatus,
      memberCount: memberCounts.get(row.id) ?? 0,
      isMember: userMemberships.has(row.id) || row.ownerId === user.id,
      ownerId: row.ownerId,
      createdAt: row.createdAt
    }))

    return c.json({ workspaces: result })
  })
  .get("/v1/workspaces/mine", async (c) => {
    const user = c.get("user")
    const rows = await db
      .select({ workspace: workspaces })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, user.id))
      .orderBy(desc(workspaces.createdAt))
    return c.json({ workspaces: rows.map((row) => row.workspace) })
  })
  .post("/v1/workspaces", zValidator("json", createWorkspaceSchema), async (c) => {
    const user = c.get("user")
    const body = c.req.valid("json")
    const workspace = await createWorkspaceWithDefaults({
      user,
      name: body.name,
      imageId: body.imageId,
      password: body.password ?? null
    })

    try {
      const runnerResult = await createSandboxContainer({
        workspaceId: workspace.id,
        image: workspace.imageRef
      })

      if (runnerResult) {
        const initialFiles = await db.select().from(files).where(eq(files.workspaceId, workspace.id))
        for (const file of initialFiles) {
          await mirrorWorkspaceEntry({
            workspaceId: workspace.id,
            path: file.path,
            kind: file.kind,
            ...(file.kind === "file" ? { content: file.content } : {})
          })
        }

        const [updated] = await db
          .update(workspaces)
          .set({
            containerId: runnerResult.containerId,
            containerStatus: runnerResult.status,
            containerError: null,
            updatedAt: new Date()
          })
          .where(eq(workspaces.id, workspace.id))
          .returning()

        return c.json({ workspace: updated ?? workspace }, 201)
      }
    } catch (error) {
      await db
        .update(workspaces)
        .set({
          containerStatus: "error",
          containerError: error instanceof Error ? error.message : "Runner error",
          updatedAt: new Date()
        })
        .where(eq(workspaces.id, workspace.id))
    }

    return c.json({ workspace }, 201)
  })
  .get("/v1/workspaces/:workspaceId", async (c) => {
    const user = c.get("user")
    const workspaceId = c.req.param("workspaceId")
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)
    if (!workspace) {
      throw new HTTPException(404, { message: "Workspace not found" })
    }

    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)))
      .limit(1)

    return c.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        imageId: workspace.imageId,
        imageRef: workspace.imageRef,
        visibility: workspace.visibility,
        hasPassword: workspace.visibility === "protected" && Boolean(workspace.passwordHash),
        containerStatus: workspace.containerStatus,
        ownerId: workspace.ownerId,
        isMember: Boolean(member) || workspace.ownerId === user.id,
        createdAt: workspace.createdAt
      }
    })
  })
  .post("/v1/workspaces/:workspaceId/join", zValidator("json", joinWorkspaceSchema), async (c) => {
    const user = c.get("user")
    const workspaceId = c.req.param("workspaceId")
    const body = c.req.valid("json")

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)
    if (!workspace) {
      throw new HTTPException(404, { message: "Workspace not found" })
    }

    const [existing] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)))
      .limit(1)

    if (!existing && workspace.ownerId !== user.id) {
      if (workspace.visibility === "protected") {
        if (!body.password || !workspace.passwordHash) {
          throw new HTTPException(403, { message: "Password required" })
        }
        const ok = await verifyWorkspacePassword(body.password, workspace.passwordHash)
        if (!ok) {
          throw new HTTPException(403, { message: "Invalid password" })
        }
      }

      await db
        .insert(workspaceMembers)
        .values({
          workspaceId,
          userId: user.id,
          role: "editor"
        })
        .onConflictDoNothing()
    }

    return c.json({ ok: true })
  })
  .get("/v1/workspaces/:workspaceId/tree", async (c) => {
    const user = c.get("user")
    const workspaceId = c.req.param("workspaceId")
    await assertWorkspaceAccess(workspaceId, user)
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
    if (workspace) {
      await ensureWorkspaceDefaultFiles({
        workspaceId,
        imageId: workspace.imageId,
        name: workspace.name
      })
    }
    const rows = await db.select().from(files).where(eq(files.workspaceId, workspaceId))
    return c.json({ files: rows })
  })
  .get("/v1/workspaces/:workspaceId/members", async (c) => {
    const user = c.get("user")
    const workspaceId = c.req.param("workspaceId")
    await assertWorkspaceAccess(workspaceId, user)
    const rows = await db
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        email: profiles.email,
        displayName: profiles.displayName,
        color: profiles.color,
        avatarUrl: profiles.avatarUrl
      })
      .from(workspaceMembers)
      .leftJoin(profiles, eq(profiles.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(asc(workspaceMembers.role))
    return c.json({ members: rows })
  })
  .post("/v1/workspaces/:workspaceId/previews", zValidator("json", startPreviewSchema), async (c) => {
    const user = c.get("user")
    const workspaceId = c.req.param("workspaceId")
    const body = c.req.valid("json")
    await assertWorkspaceAccess(workspaceId, user)

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)
    if (!workspace) {
      throw new HTTPException(404, { message: "Workspace not found" })
    }

    const image = getSandboxImage(workspace.imageId)
    if (!image) {
      throw new HTTPException(400, { message: "Workspace image is not configured for previews" })
    }

    await ensureWorkspaceDefaultFiles({
      workspaceId,
      imageId: workspace.imageId,
      name: workspace.name
    })

    const container = await createSandboxContainer({
      workspaceId,
      image: workspace.imageRef
    })
    if (container) {
      await db
        .update(workspaces)
        .set({
          containerId: container.containerId,
          containerStatus: container.status,
          containerError: null,
          updatedAt: new Date()
        })
        .where(eq(workspaces.id, workspaceId))
    }

    const rows = await db
      .select()
      .from(files)
      .where(eq(files.workspaceId, workspaceId))
      .orderBy(asc(files.kind), asc(files.path))

    let activePath: string | undefined
    if (body.activePath) {
      const parsedActivePath = parseWorkspacePath(body.activePath)
      if (rows.some((row) => row.kind === "file" && row.path === parsedActivePath)) {
        activePath = parsedActivePath
      }
    }

    for (const row of rows) {
      await mirrorWorkspaceEntry({
        workspaceId,
        path: row.path,
        kind: row.kind,
        ...(row.kind === "file" ? { content: row.content } : {})
      })
    }

    const previewId = randomUUID()
    const standHost = `${previewId}.${env.standBaseDomain}`
    const command = body.type === "web" ? image.preview.webCommand : image.preview.terminalCommand
    const runnerResult = await startWorkspacePreview({
      workspaceId,
      previewId,
      standHost,
      type: body.type,
      command,
      port: image.preview.port,
      activePath
    })

    if (!runnerResult) {
      throw new HTTPException(503, { message: "Runner is not configured" })
    }

    return c.json({
      preview: {
        id: previewId,
        type: body.type,
        host: standHost,
        url: standUrl(standHost),
        port: image.preview.port,
        command,
        ...runnerResult
      }
    })
  })
  .get("/v1/workspaces/:workspaceId/previews/:previewId/log", async (c) => {
    const user = c.get("user")
    const workspaceId = c.req.param("workspaceId")
    const previewId = c.req.param("previewId")
    await assertWorkspaceAccess(workspaceId, user)
    const output = await readWorkspacePreviewLog({ workspaceId, previewId })
    return c.json({ output: output ?? "" })
  })
  .post("/v1/workspaces/:workspaceId/files", zValidator("json", createFileSchema), async (c) => {
    const user = c.get("user")
    const workspaceId = c.req.param("workspaceId")
    const body = c.req.valid("json")
    await assertWorkspaceAccess(workspaceId, user)

    const path = parseWorkspacePath(body.path)
    let file
    try {
      ;[file] = await db
        .insert(files)
        .values({
          workspaceId,
          path,
          kind: body.kind,
          language: body.kind === "file" ? languageFromPath(path) : null,
          content: body.kind === "file" ? body.content ?? "" : ""
        })
        .returning()
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HTTPException(409, { message: `File already exists at ${path}` })
      }
      throw error
    }

    if (!file) {
      throw new HTTPException(500, { message: "File was not created" })
    }

    await mirrorWorkspaceEntry({
      workspaceId,
      path,
      kind: body.kind,
      ...(body.content === undefined ? {} : { content: body.content })
    })

    return c.json({ file }, 201)
  })
  .get("/v1/files/:fileId", async (c) => {
    const user = c.get("user")
    const fileId = c.req.param("fileId")
    const file = await assertFileAccess(fileId, user)
    return c.json({ file })
  })
  .patch("/v1/files/:fileId", zValidator("json", renameFileSchema), async (c) => {
    const user = c.get("user")
    const fileId = c.req.param("fileId")
    const body = c.req.valid("json")
    const file = await assertFileAccess(fileId, user)

    if (file.readonly) {
      throw new HTTPException(409, { message: "File is read-only" })
    }

    const nextPath = parseWorkspacePath(body.path)
    if (nextPath === file.path) {
      return c.json({ file })
    }

    try {
      const [conflict] = await db
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.workspaceId, file.workspaceId), eq(files.path, nextPath)))
        .limit(1)
      if (conflict) {
        throw new HTTPException(409, { message: `Path already exists at ${nextPath}` })
      }

      if (file.kind === "directory") {
        const updated = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(files)
            .set({
              path: nextPath,
              language: null,
              updatedAt: new Date()
            })
            .where(eq(files.id, fileId))
            .returning()
          await tx.execute(
            sql`update files set path = ${nextPath} || substring(path from ${file.path.length + 1}), updated_at = now() where workspace_id = ${file.workspaceId} and path like ${file.path + "/%"}`
          )
          return row
        })
        if (!updated) {
          throw new HTTPException(404, { message: "File not found" })
        }
        return c.json({ file: updated })
      }

      const [updated] = await db
        .update(files)
        .set({
          path: nextPath,
          language: languageFromPath(nextPath),
          updatedAt: new Date()
        })
        .where(eq(files.id, fileId))
        .returning()

      if (!updated) {
        throw new HTTPException(404, { message: "File not found" })
      }

      return c.json({ file: updated })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HTTPException(409, { message: `Path already exists at ${nextPath}` })
      }
      throw error
    }
  })
  .delete("/v1/files/:fileId", async (c) => {
    const user = c.get("user")
    const fileId = c.req.param("fileId")
    const file = await assertFileAccess(fileId, user)

    if (file.readonly) {
      throw new HTTPException(409, { message: "File is read-only" })
    }

    if (file.kind === "directory") {
      await db.transaction(async (tx) => {
        await tx
          .delete(files)
          .where(and(eq(files.workspaceId, file.workspaceId), like(files.path, `${file.path}/%`)))
        await tx.delete(files).where(eq(files.id, fileId))
      })
    } else {
      await db.delete(files).where(eq(files.id, fileId))
    }

    return c.json({ ok: true })
  })
  .put("/v1/files/:fileId", zValidator("json", updateFileSchema), async (c) => {
    const user = c.get("user")
    const fileId = c.req.param("fileId")
    const body = c.req.valid("json")
    const file = await assertFileAccess(fileId, user)

    if (file.kind !== "file" || file.readonly) {
      throw new HTTPException(409, { message: "File cannot be modified" })
    }

    const [updated] = await db
      .update(files)
      .set({
        content: body.content,
        updatedAt: new Date()
      })
      .where(and(eq(files.id, fileId), eq(files.kind, "file")))
      .returning()

    if (!updated) {
      throw new HTTPException(404, { message: "File not found" })
    }

    await mirrorWorkspaceEntry({
      workspaceId: updated.workspaceId,
      path: updated.path,
      kind: "file",
      content: body.content
    })

    return c.json({ file: updated })
  })

export type AppType = typeof routes

export default app
