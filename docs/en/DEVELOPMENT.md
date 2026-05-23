# Local Development

This guide starts the full Whaler development stack on one machine.

## Requirements

- Node.js `>=22.13.0` and pnpm `11.2.2`.
- Docker with the Docker Compose plugin.
- Supabase CLI.
- `just`.
- A local Docker socket at `/var/run/docker.sock`.

## First Run

Install dependencies:

```bash
just install
```

Copy the example environment:

```bash
cp .env.example .env
```

Start local Supabase:

```bash
just supabase-start
```

Read the generated local keys:

```bash
just supabase-status
```

Copy the local Supabase anon key into `VITE_SUPABASE_ANON_KEY` in `.env`. The
development defaults in `.env.example` already point the app at the local
Supabase ports.

Create the preview Docker network and build missing sandbox images:

```bash
just sandbox-up
```

Reset/apply the local database:

```bash
just supabase-reset
```

Start the full stack:

```bash
just dev
```

The web app runs at `http://localhost:5173`.

## What `just dev` Starts

`just dev` starts local Supabase, ensures sandbox images exist, starts TURN, and
then runs:

- API on `http://localhost:3000`.
- Collaboration websocket server on `ws://localhost:3001`.
- Runner on `http://localhost:3002`.
- Voice websocket server on `ws://localhost:3003`.
- Web app on `http://localhost:5173`.

## Running Services Separately

Use these commands when working on one service:

```bash
just dev-api
just dev-collab
just dev-runner
just dev-voice
just dev-web
```

## Database Work

Generate Drizzle migrations after schema changes:

```bash
pnpm db:generate
```

Apply migrations using the configured `DATABASE_URL`:

```bash
pnpm db:migrate
```

For local Supabase only, reset the database and reapply migrations:

```bash
just supabase-reset
```

Do not run `just supabase-reset` against production data.

## Preview Sandboxes

The runner controls Docker containers through the local Docker socket. Each
workspace gets a container and a Docker volume mounted at `/workspace`. Preview
images are built by:

```bash
just sandbox-images
```

The local preview network is created by:

```bash
just sandbox-network
```

## Verification

Before opening a pull request or deploying, run:

```bash
just typecheck
just build
docker compose config
```

If a preview fails to start, inspect the preview log from the UI or the runner
logs:

```bash
docker compose logs --tail=120 runner
```
