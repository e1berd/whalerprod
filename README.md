# WhalerProd

Whalerprod is a browser IDE where every workspace is backed by its own Docker
container. The editor is realtime, but the runtime is real: files are persisted
in Postgres, mirrored into the container filesystem, and preview commands run
against the same `/workspace` tree that users are editing.

![Hero Block](./docs/readme_hero.png)

## What Makes It Interesting

- Workspace changes are not just UI state. File creates and updates are stored
  in the database and immediately materialized inside the workspace container
  via Docker archive writes.
- Each workspace gets a long-lived sandbox container named from the workspace
  id, with its own Docker volume mounted at `/workspace`.
- Preview runs start from the container filesystem, restart the sandbox, spawn
  the framework command, wait for the selected port, and then expose it through
  a generated `*.stand` host.
- The runner is an internal service with token-gated APIs. Public traffic never
  talks to Docker directly.
- Sandboxes are resource-limited with memory, CPU, PID limits,
  `no-new-privileges`, dropped Linux capabilities, and an isolated preview
  network.
- Collaborative editing uses Yjs/Hocuspocus for document state, cursor,
  selection, and workspace presence while the API keeps the canonical file tree
  in Postgres.
- Self-hosted Supabase provides Auth, Postgres, and Storage, so the app can run
  without depending on a hosted identity or storage vendor.
- Caddy terminates HTTPS, routes the app/API/collab/voice/Supabase subdomains,
  and proxies dynamic preview hosts.

## Runtime Model

Whalerprod treats a workspace as two synchronized layers:

1. The database stores workspace metadata, membership, the file tree, file
   content, and CRDT document snapshots.
2. The Docker sandbox holds the executable filesystem. On workspace creation,
   default template files are copied into `/workspace`. On later file changes,
   the API asks the runner to mirror the changed file or directory into the
   container.

When a user presses Run, the API ensures the sandbox exists, replays the current
file tree into the container, and starts the configured preview command for the
workspace image. For Vite-based templates, Whalerprod disables HMR WebSockets and
serves a tiny compatibility shim so previews work cleanly through the sandbox
proxy.

That means the preview is not a static renderer and not a mocked execution
environment. It is a real process running inside the same container that holds
the workspace files.

## Stack

- Vue + Vuetify 4 + CodeMirror 6
- Hono + `hc` typed client
- Yjs + Hocuspocus for realtime text, cursor, selection, and workspace presence
- Supabase self-hosted Auth/Postgres/Storage
- Drizzle ORM schema/migrations
- Docker runner isolated behind an internal token
- Docker volumes for per-workspace `/workspace` state
- mediasoup + optional TURN for voice rooms
- Caddy with HTTP/3

## Table of Contents

English:

- [Overview](./docs/en/README.md)
- [Local development](./docs/en/DEVELOPMENT.md)
- [Production deployment](./docs/en/DEPLOYMENT.md)
- [Architecture](./docs/en/ARCHITECTURE.md)

Русский:

- [Обзор](./docs/ru/README.md)
- [Локальная разработка](./docs/ru/DEVELOPMENT.md)
- [Production-деплой](./docs/ru/DEPLOYMENT.md)
- [Архитектура](./docs/ru/ARCHITECTURE.md)
