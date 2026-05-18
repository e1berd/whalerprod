# Whaler

Realtime browser code editor with self-hosted IAM, collaborative editing, and Docker-backed sandboxes.

## Stack

- Vue + Vuetify 4 + CodeMirror 6
- Hono + `hc` typed client
- Yjs + Hocuspocus for realtime text, cursor, selection, and workspace presence
- Supabase self-hosted Auth/Postgres
- Drizzle ORM schema/migrations
- Docker runner isolated behind an internal token
- Caddy with HTTP/3

## Local Development

1. Install dependencies:

   ```bash
   just install
   ```

2. Start the full local dev stack:

   ```bash
   just dev
   ```

   `just dev` starts local Supabase, builds missing sandbox preview images,
   starts TURN, and then runs the app services.

3. If this is the first local run, copy the values from `just supabase-status`
   into `.env`. The app expects:

   - `DATABASE_URL`
   - `SUPABASE_JWT_SECRET`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `RUNNER_INTERNAL_TOKEN`

4. Apply/reset local database:

   ```bash
   just supabase-reset
   ```

5. Individual services can still be run separately:

   ```bash
   just dev-api
   just dev-collab
   just dev-runner
   just dev-web
   ```

The web app defaults to `http://localhost:5173`.

## Production Domains

Caddy is configured for separate subdomains:

- `APP_DOMAIN=app.example.com`
- `API_DOMAIN=api.example.com`
- `COLLAB_DOMAIN=collab.example.com`
- `SUPABASE_DOMAIN=supabase.example.com`

For Beget VDS, create DNS `A` records for each subdomain pointing to the VDS public IPv4 address. If IPv6 is enabled, also add matching `AAAA` records.

Open these ports on the VDS firewall:

- `80/tcp` for ACME HTTP challenge and redirects
- `443/tcp` for HTTPS
- `443/udp` for HTTP/3

Do not expose Postgres or the Docker socket publicly.

## Supabase Production Note

`supabase init` is useful for local development. For production, run self-hosted Supabase as its own Docker Compose stack or service, then point Caddy's `SUPABASE_UPSTREAM` to its Kong/API gateway. Set Supabase Auth URLs to:

- public API URL: `https://supabase.example.com`
- site URL: `https://app.example.com`
- allowed redirect URLs: `https://app.example.com`

## Verification

```bash
just typecheck
just build
docker compose config
```
