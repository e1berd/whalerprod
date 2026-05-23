# Production-деплой

Эта инструкция описывает production-запуск на Linux VDS или выделенном сервере.
Whaler запускается через Docker Compose, Caddy принимает публичный HTTPS-трафик,
а Supabase работает как отдельный self-hosted production stack или отдельный
сервис.

## Требования к серверу

Минимально нужно:

- Linux-сервер с Docker и Docker Compose plugin.
- Публичный IPv4.
- Открытые входящие `80/tcp`, `443/tcp` и `443/udp`.
- Открытые `3478/tcp` и `3478/udp`, если используется встроенный TURN profile.
- Открытый mediasoup RTC range, по умолчанию `40000-40100/tcp` и
  `40000-40100/udp`, если включен voice.
- Достаточно места под Docker images, workspace volumes, preview containers,
  Caddy certificates и Supabase/Postgres volumes.

Не открывайте наружу Postgres, Docker socket и внутренние сервисы приложения.

Базовые пакеты:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
```

Docker лучше устанавливать по официальной инструкции Docker для вашего
дистрибутива. После установки проверьте:

```bash
docker --version
docker compose version
```

## DNS

Создайте `A` records на публичный IPv4 сервера:

```text
app.example.com       -> VDS IPv4
api.example.com       -> VDS IPv4
collab.example.com    -> VDS IPv4
voice.example.com     -> VDS IPv4
supabase.example.com  -> VDS IPv4
*.stand.example.com   -> VDS IPv4
```

Если IPv6 на сервере настроен, добавьте соответствующие `AAAA`. Если IPv6 не
настроен, `AAAA` не добавляйте.

## Supabase

Используйте self-hosted Supabase как отдельный Docker Compose stack или
production-сервис. Не используйте `supabase start` как production runtime.

В Supabase Auth должны быть выставлены:

```dotenv
API_EXTERNAL_URL=https://supabase.example.com
GOTRUE_SITE_URL=https://app.example.com
GOTRUE_URI_ALLOW_LIST=https://app.example.com
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_MAILER_AUTOCONFIRM=false
```

Если Supabase Kong/API gateway слушает на том же сервере на `127.0.0.1:54321`,
Whaler должен ходить к нему через Docker host gateway:

```dotenv
SUPABASE_UPSTREAM=host.docker.internal:54321
SUPABASE_URL_DOCKER=http://host.docker.internal:54321
VITE_SUPABASE_URL=https://supabase.example.com
```

Whaler ожидает, что доступны Supabase Auth, Postgres и Storage. Загрузка
аватарок работает через Supabase Storage.

## Окружение Whaler

Создайте `.env` из `.env.example` и замените production-значения.

Важные переменные:

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

`VITE_*` значения встраиваются в `web` image на этапе build. Если изменились
домены или Supabase anon key, пересоберите `web`.

`CADDY_ACME_EMAIL` должен быть реальным email. ACME providers отклоняют
placeholder-домены вроде `example.com`.

## SMTP для Auth-писем

Email confirmation и password recovery отправляет Supabase Auth, а не Whaler
API.

Исходные SMTP-значения можно держать в `.env`:

```dotenv
MAIL_HOST=smtp.example.com
MAIL_PORT=465
MAIL_USERNAME=no-reply@example.com
MAIL_PASSWORD=replace-with-smtp-password
MAIL_FROM_ADDRESS=no-reply@example.com
MAIL_FROM_NAME=Whaler
```

Прокиньте их в Supabase Auth container:

```dotenv
GOTRUE_SMTP_HOST=${MAIL_HOST}
GOTRUE_SMTP_PORT=${MAIL_PORT}
GOTRUE_SMTP_USER=${MAIL_USERNAME}
GOTRUE_SMTP_PASS=${MAIL_PASSWORD}
GOTRUE_SMTP_ADMIN_EMAIL=${MAIL_FROM_ADDRESS}
GOTRUE_SMTP_SENDER_NAME=${MAIL_FROM_NAME}
```

После изменения SMTP-переменных перезапустите Supabase Auth и проверьте signup
и password recovery.

## Wildcard TLS для preview

Preview sandboxes открываются на динамических хостах:

```text
<preview-id>.stand.example.com
```

Для HTTPS на этих хостах нужен wildcard certificate для `*.stand.example.com`.

Стандартный образ `caddy:2.10-alpine` не может выпускать wildcard certificates
через HTTP challenge. Используйте один из вариантов:

- собрать Caddy с DNS plugin для вашего DNS provider и использовать DNS-01;
- выпустить wildcard certificate отдельно и смонтировать его в Caddy;
- использовать включенный flow через `acme.sh`.

Generic `acme.sh` flow:

```dotenv
ACME_DNS_PROVIDER=dns_provider_name
ACME_IMAGE=neilpang/acme.sh:3.1.4
STAND_TLS_DIRECTIVE="tls /acme-data/*.stand.example.com_ecc/fullchain.cer /acme-data/*.stand.example.com_ecc/*.stand.example.com.key"
```

Добавьте credentials, которые требует ваш DNS provider для `acme.sh`, затем
запустите:

```bash
just stand-cert
```

Продление:

```bash
just stand-cert-renew
```

## Сборка и запуск

Создайте preview network и соберите sandbox images:

```bash
just sandbox-network
just sandbox-images
```

Проверьте Compose:

```bash
docker compose config
```

Запустите Whaler:

```bash
docker compose up -d --build
```

Если используется встроенный TURN:

```bash
docker compose --profile turn up -d coturn
```

## Database migrations

Запустите Whaler Drizzle migrations против production Postgres:

```bash
pnpm install
DATABASE_URL=postgres://postgres:strong-password@host:5432/postgres pnpm --filter @whaler/db db:migrate
```

Никогда не запускайте `supabase db reset` или `just supabase-reset` на
production.

## Обновление production

Заберите свежий код и пересоберите:

```bash
git pull
docker compose up -d --build
```

Если изменились только `VITE_*`, пересоберите `web` image. Если изменились
sandbox templates, пересоберите sandbox images:

```bash
just sandbox-images
```

## Чеклист проверки

На сервере:

```bash
docker compose ps
docker compose logs --tail=120 api
docker compose logs --tail=120 runner
docker compose logs --tail=120 caddy
```

Снаружи сервера:

- `https://app.example.com` открывает frontend.
- `https://api.example.com/health` отвечает.
- `https://supabase.example.com/auth/v1/settings` отвечает.
- Signup отправляет confirmation email.
- Подтвержденный пользователь может войти.
- Avatar upload проходит через Supabase Storage.
- Collaborative editing подключается к `wss://collab.example.com`.
- Preview стартует на generated URL
  `https://<preview-id>.stand.example.com`.
- Voice rooms подключаются, если voice включен.
