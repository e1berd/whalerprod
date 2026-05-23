# Production Deployment

This guide describes a production deployment on a Linux VDS or dedicated server.
WhalerProd runs with Docker Compose, Caddy handles public HTTPS traffic, and
Supabase runs as a separate self-hosted production stack or service.

## Server Requirements

Minimum:

- Linux server with Docker and Docker Compose plugin.
- Public IPv4 address.
- Inbound `80/tcp`, `443/tcp`, and `443/udp`.
- Inbound `3478/tcp` and `3478/udp` if the bundled TURN profile is used.
- Inbound mediasoup RTC range, default `40000-40100/tcp` and
  `40000-40100/udp`, if voice is enabled.
- Enough disk space for Docker images, workspace volumes, preview containers,
  Caddy certificates, and Supabase/Postgres volumes.

Do not expose Postgres, the Docker socket, or internal application services to
the public internet.

Base packages:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
```

Install Docker from the official Docker instructions for your distribution, then
verify:

```bash
docker --version
docker compose version
```

## DNS

Create `A` records pointing to the server public IPv4:

```text
app.example.com       -> VDS IPv4
api.example.com       -> VDS IPv4
collab.example.com    -> VDS IPv4
voice.example.com     -> VDS IPv4
supabase.example.com  -> VDS IPv4
*.stand.example.com   -> VDS IPv4
```

If IPv6 is configured on the server, add matching `AAAA` records. If IPv6 is not
configured, do not add `AAAA` records.

## Supabase

Use self-hosted Supabase as its own Docker Compose stack or managed production
service. Do not use `supabase start` as the production runtime.

Supabase Auth must be configured with:

```dotenv
API_EXTERNAL_URL=https://supabase.example.com
GOTRUE_SITE_URL=https://app.example.com
GOTRUE_URI_ALLOW_LIST=https://app.example.com
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_MAILER_AUTOCONFIRM=false
```

If Supabase Kong/API gateway listens on the same server at `127.0.0.1:54321`,
set WhalerProd to reach it through Docker's host gateway:

```dotenv
SUPABASE_UPSTREAM=host.docker.internal:54321
SUPABASE_URL_DOCKER=http://host.docker.internal:54321
VITE_SUPABASE_URL=https://supabase.example.com
```

WhalerProd expects Supabase Auth, Postgres, and Storage to be available. Avatar
uploads use Supabase Storage.

## WhalerProd Environment

Create `.env` from `.env.example` and replace the production values.

Important values:

```dotenv
DATABASE_URL=postgres://postgres:strong-password@supabase-db:5432/postgres
DATABASE_URL_DOCKER=postgres://postgres:strong-password@host.docker.internal:54322/postgres

SUPABASE_JWT_SECRET=replace-with-production-supabase-jwt-secret
SUPABASE_URL_DOCKER=http://host.docker.internal:54321
VITE_SUPABASE_URL=https://supabase.example.com
VITE_SUPABASE_ANON_KEY=replace-with-production-supabase-anon-key
SUPABASE_UPSTREAM=host.docker.internal:54321

APP_ORIGIN=https://app.example.com
VITE_API_URL=https://api.example.com
VITE_COLLAB_URL=wss://collab.example.com
VITE_VOICE_URL=wss://voice.example.com

APP_DOMAIN=app.example.com
API_DOMAIN=api.example.com
COLLAB_DOMAIN=collab.example.com
VOICE_DOMAIN=voice.example.com
SUPABASE_DOMAIN=supabase.example.com
STAND_BASE_DOMAIN=stand.example.com
STAND_BASE_DOMAIN_DOCKER=stand.example.com
CADDY_ACME_EMAIL=ops@example.com

RUNNER_INTERNAL_URL_DOCKER=http://runner:3002
RUNNER_INTERNAL_TOKEN=replace-with-long-random-token
PREVIEW_NETWORK_NAME=whaler-preview
SANDBOX_MEMORY_BYTES=536870912
SANDBOX_NANO_CPUS=1000000000
SANDBOX_PIDS_LIMIT=256

MEDIASOUP_ANNOUNCED_IP=203.0.113.10
MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=40100
TURN_URL=turn:voice.example.com:3478?transport=udp,turn:voice.example.com:3478?transport=tcp
TURN_STATIC_SECRET=replace-with-long-random-secret
```

`VITE_*` values are baked into the `web` image at build time. Rebuild `web` if
domains or the Supabase anon key change.

`CADDY_ACME_EMAIL` must be a real email address. ACME providers reject
placeholder domains such as `example.com`.

## SMTP for Auth Emails

Email confirmation and password recovery are sent by Supabase Auth, not the
WhalerProd API.

Store the source SMTP values in `.env` if convenient:

```dotenv
MAIL_HOST=smtp.example.com
MAIL_PORT=465
MAIL_USERNAME=no-reply@example.com
MAIL_PASSWORD=replace-with-smtp-password
MAIL_FROM_ADDRESS=no-reply@example.com
MAIL_FROM_NAME=WhalerProd
```

Map them into the Supabase Auth container:

```dotenv
GOTRUE_SMTP_HOST=${MAIL_HOST}
GOTRUE_SMTP_PORT=${MAIL_PORT}
GOTRUE_SMTP_USER=${MAIL_USERNAME}
GOTRUE_SMTP_PASS=${MAIL_PASSWORD}
GOTRUE_SMTP_ADMIN_EMAIL=${MAIL_FROM_ADDRESS}
GOTRUE_SMTP_SENDER_NAME=${MAIL_FROM_NAME}
```

After changing SMTP values, restart Supabase Auth and verify signup and password
recovery emails.

## Preview Wildcard TLS

Preview sandboxes use dynamic hosts such as:

```text
<preview-id>.stand.example.com
```

For HTTPS on these hosts, issue a wildcard certificate for
`*.stand.example.com`.

The stock `caddy:2.10-alpine` image cannot issue wildcard certificates with the
HTTP challenge. Use one of these approaches:

- Build Caddy with a DNS plugin for your DNS provider and use DNS-01.
- Issue a wildcard certificate externally and mount it into Caddy.
- Use the included `acme.sh` flow.

Generic `acme.sh` flow:

```dotenv
ACME_DNS_PROVIDER=dns_provider_name
ACME_IMAGE=neilpang/acme.sh:3.1.4
STAND_TLS_DIRECTIVE="tls /acme-data/*.stand.example.com_ecc/fullchain.cer /acme-data/*.stand.example.com_ecc/*.stand.example.com.key"
```

Add the DNS provider credentials required by `acme.sh`, then run:

```bash
just stand-cert
```

Renew with:

```bash
just stand-cert-renew
```

## Build and Start

Create the preview network and build sandbox images:

```bash
just sandbox-network
just sandbox-images
```

Validate Compose:

```bash
docker compose config
```

Start WhalerProd:

```bash
docker compose up -d --build
```

If using the bundled TURN service:

```bash
docker compose --profile turn up -d coturn
```

## Database Migrations

Run WhalerProd Drizzle migrations against the production Postgres:

```bash
pnpm install
DATABASE_URL=postgres://postgres:strong-password@host:5432/postgres pnpm --filter @whaler/db db:migrate
```

Never run `supabase db reset` or `just supabase-reset` on production.

## Updating Production

Pull the latest code and rebuild:

```bash
git pull
docker compose up -d --build
```

If only `VITE_*` values changed, rebuild the `web` image. If sandbox templates
changed, rebuild sandbox images with:

```bash
just sandbox-images
```

## Verification Checklist

On the server:

```bash
docker compose ps
docker compose logs --tail=120 api
docker compose logs --tail=120 runner
docker compose logs --tail=120 caddy
```

From outside the server:

- `https://app.example.com` opens the frontend.
- `https://api.example.com/health` responds.
- `https://supabase.example.com/auth/v1/settings` responds.
- Signup sends a confirmation email.
- Confirmed users can log in.
- Avatar upload succeeds through Supabase Storage.
- Collaborative editing connects to `wss://collab.example.com`.
- Preview starts on a generated `https://<preview-id>.stand.example.com` URL.
- Voice rooms connect if voice is enabled.
