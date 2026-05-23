# Architecture

WhalerProd is designed around a simple rule: the browser editor and the executable
sandbox must describe the same workspace.

## Main Services

- `web`: Vue/Vuetify application with CodeMirror.
- `api`: authenticated Hono API for workspace lifecycle, files, profiles,
  membership, preview creation, and runner orchestration.
- `collab`: Hocuspocus/Yjs server for realtime text, cursor, selection, and
  workspace presence.
- `runner`: internal service that owns Docker operations.
- `voice`: mediasoup service for voice rooms.
- `caddy`: public HTTPS router.
- `supabase`: self-hosted Auth, Postgres, and Storage.

## Workspace State

Workspace state has two layers:

- Postgres stores durable metadata: workspaces, members, files, profiles, and
  Yjs document snapshots.
- Docker stores executable state: each workspace has a container and a volume
  mounted at `/workspace`.

On create/update, the API writes the canonical row to Postgres, then calls the
runner to mirror that file or directory into the workspace container. The runner
uses Docker archive writes instead of shelling out to write files.

## Container Lifecycle

Workspace containers are named `whaler-<workspace-id>`. Volumes are named
`whaler-workspace-<workspace-id>`.

The runner:

- ensures the requested sandbox image exists;
- creates or reuses the workspace container;
- attaches the container to the preview network;
- mounts the workspace volume at `/workspace`;
- applies memory, CPU, PID, capability, and privilege limits;
- keeps the container alive with `sleep infinity`;
- restarts the container before web preview runs.

## Preview Flow

1. The user presses Run.
2. The API checks access and loads the workspace image configuration.
3. The API ensures default files exist and replays the current file tree into
   the container.
4. The API creates a preview id and host under the configured stand domain.
5. The runner restarts the container, starts the preview command, writes logs to
   `/tmp`, and waits for the selected port.
6. Caddy routes the preview hostname to the runner.
7. The runner proxies HTTP requests to the container IP and preview port.

For Vite templates, WhalerProd strips the Vite HMR client and serves a no-op HMR
compatibility module. This avoids browser websocket noise while preserving CSS
injection for Vite-served modules.

## Collaboration Flow

The collaboration server authenticates the Supabase JWT and verifies access to
the requested file or workspace presence document.

For file documents:

- If a Yjs snapshot exists, it is loaded from `collab_documents`.
- Otherwise the initial Yjs document is created from the `files.content` row.
- On store, the encoded Yjs state is persisted and `files.content` is updated
  with the current text.

This lets WhalerProd support realtime editing while keeping a plain text file tree
available to the API and runner.

## Security Boundaries

- Browser clients never access the Docker socket.
- Runner endpoints are under `/internal/*` and require `x-runner-token`.
- Docker containers run with dropped capabilities and `no-new-privileges`.
- Sandbox memory, CPU, and PID limits are configurable.
- Preview containers live on a dedicated Docker network.
- Public domains are terminated and routed by Caddy.
- Supabase JWTs are verified by app services before workspace access.

The runner is intentionally powerful because it controls Docker. Keep it private
inside the compose network and rotate `RUNNER_INTERNAL_TOKEN` if it leaks.
