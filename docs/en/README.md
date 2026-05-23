# Whaler Documentation

Whaler is split into a few focused services: a Vue web app, an authenticated API,
a collaboration server, a voice server, and an internal Docker runner. Supabase
provides Auth, Postgres, and Storage. Caddy routes the public domains and dynamic
preview hosts.

## Start Here

- [Local development](./DEVELOPMENT.md): install dependencies, start Supabase,
  run the app, reset the local database, and work with individual services.
- [Production deployment](./DEPLOYMENT.md): prepare a server, configure DNS,
  run self-hosted Supabase, issue preview wildcard TLS, and launch Whaler.
- [Architecture](./ARCHITECTURE.md): understand the workspace/container model,
  realtime collaboration, preview routing, and security boundaries.

## Runtime Summary

Whaler stores workspace metadata and files in Postgres, then mirrors executable
workspace state into a Docker container mounted at `/workspace`. The browser
editor talks to the API and collaboration server, while preview and terminal
commands run inside the sandbox container through the internal runner.

This makes the system different from a static code editor: the preview is a real
process running in the same filesystem that the user edits.

## Service Map

- `web`: Vue/Vuetify frontend served by nginx in production.
- `api`: Hono API for workspaces, files, profiles, preview sessions, and access
  checks.
- `collab`: Hocuspocus/Yjs websocket server for document state and presence.
- `runner`: internal Docker control plane for workspace containers and preview
  proxying.
- `voice`: mediasoup signaling and room orchestration.
- `caddy`: public HTTPS/HTTP3 entrypoint.
- `supabase`: external/self-hosted stack for Auth, Postgres, and Storage.
