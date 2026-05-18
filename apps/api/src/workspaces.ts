import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { and, eq } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"
import { collabDocuments, files, workspaceMembers, workspaces } from "@whaler/db/schema"
import { getSandboxImage, normalizeWorkspacePath } from "@whaler/shared"
import { db } from "./db"
import type { AuthUser } from "./auth"

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>

export async function hashWorkspacePassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, 64)
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`
}

export async function verifyWorkspacePassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split("$")
  if (parts.length !== 3 || parts[0] !== "scrypt") return false
  const salt = Buffer.from(parts[1] ?? "", "hex")
  const expected = Buffer.from(parts[2] ?? "", "hex")
  if (!salt.length || !expected.length) return false
  const derived = await scryptAsync(password, salt, expected.length)
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

export async function assertWorkspaceAccess(workspaceId: string, user: AuthUser) {
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)))
    .limit(1)

  if (!member) {
    throw new HTTPException(404, { message: "Workspace not found" })
  }

  return member
}

export async function assertFileAccess(fileId: string, user: AuthUser) {
  const [row] = await db
    .select({
      file: files,
      member: workspaceMembers
    })
    .from(files)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, files.workspaceId), eq(workspaceMembers.userId, user.id))
    )
    .where(eq(files.id, fileId))
    .limit(1)

  if (!row) {
    throw new HTTPException(404, { message: "File not found" })
  }

  return row.file
}

export function languageFromPath(path: string): string | null {
  const extension = path.split(".").at(-1)?.toLowerCase()
  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript"
    case "js":
    case "jsx":
    case "mjs":
      return "javascript"
    case "json":
      return "json"
    case "py":
      return "python"
    case "html":
      return "html"
    case "css":
      return "css"
    case "vue":
      return "html"
    case "php":
      return "php"
    case "md":
      return "markdown"
    case "yml":
    case "yaml":
      return "yaml"
    default:
      return null
  }
}

function defaultWorkspaceFiles(image: NonNullable<ReturnType<typeof getSandboxImage>>, name: string) {
  const defaults = image.defaultFiles?.length
    ? image.defaultFiles
    : [
        {
          path: "README.md",
          content: `# ${name}\n\nWorkspace image: ${image.image}\n`
        }
      ]

  return defaults.map((file) => ({
    path: normalizeWorkspacePath(file.path),
    kind: "file" as const,
    language: languageFromPath(file.path),
    content: file.content
  }))
}

export async function createWorkspaceWithDefaults(input: {
  user: AuthUser
  name: string
  imageId: string
  password?: string | null
}) {
  const image = getSandboxImage(input.imageId)
  if (!image) {
    throw new HTTPException(400, { message: "Image is not allowlisted" })
  }

  const password = input.password?.trim() || null
  const passwordHash = password ? await hashWorkspacePassword(password) : null

  const now = new Date()
  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        ownerId: input.user.id,
        name: input.name,
        imageId: image.id,
        imageRef: image.image,
        visibility: password ? "protected" : "public",
        passwordHash,
        containerStatus: "starting",
        updatedAt: now
      })
      .returning()

    if (!workspace) {
      throw new HTTPException(500, { message: "Workspace was not created" })
    }

    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: input.user.id,
      role: "owner"
    })

    await tx.insert(files).values(
      defaultWorkspaceFiles(image, input.name).map((file) => ({
        workspaceId: workspace.id,
        ...file
      }))
    )

    return workspace
  })
}

export async function ensureWorkspaceDefaultFiles(input: {
  workspaceId: string
  imageId: string
  name: string
}) {
  const image = getSandboxImage(input.imageId)
  if (!image?.defaultFiles?.length) return

  const defaults = defaultWorkspaceFiles(image, input.name)
  for (const file of defaults) {
    await db
      .insert(files)
      .values({
        workspaceId: input.workspaceId,
        ...file
      })
      .onConflictDoNothing()
  }
}

export async function upsertPlainContentDocument(input: {
  fileId: string
  workspaceId: string
  content: string
}) {
  await db
    .insert(collabDocuments)
    .values({
      name: `file:${input.fileId}`,
      fileId: input.fileId,
      workspaceId: input.workspaceId,
      state: Buffer.from(input.content)
    })
    .onConflictDoNothing()
}

export function parseWorkspacePath(path: string): string {
  try {
    return normalizeWorkspacePath(path)
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof Error ? error.message : "Invalid path"
    })
  }
}
