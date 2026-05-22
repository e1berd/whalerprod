# Подготовка Whaler к продакшену

Документ описывает запуск приложения на VDS или выделенном сервере. Основная схема такая: Whaler запускается через `docker compose`, Caddy принимает публичный HTTPS-трафик, Supabase работает отдельным production-сервисом или отдельным compose-стеком, а Whaler подключается к Supabase по внутреннему upstream.

## 1. Сервер

Минимально нужно:

- Linux VDS с Docker и Docker Compose plugin.
- Публичный IPv4.
- Открытые входящие порты `80/tcp`, `443/tcp`, `443/udp`.
- Если используется встроенный TURN: `3478/tcp` и `3478/udp`.
- Для WebRTC voice: диапазон mediasoup RTC-портов, по умолчанию `40000-40100/tcp` и `40000-40100/udp`.
- Закрытые наружу Postgres, Docker socket и внутренние сервисы приложения.
- Достаточно места под Docker images, sandbox-контейнеры, Caddy certificates и Supabase/Postgres volumes.

Базовая подготовка:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
```

Docker лучше ставить по официальной инструкции Docker для вашей версии дистрибутива. После установки проверьте:

```bash
docker --version
docker compose version
```

## 2. DNS

Создайте DNS-записи `A` на публичный IPv4 сервера:

```text
app.example.com       -> VDS IPv4
api.example.com       -> VDS IPv4
collab.example.com    -> VDS IPv4
voice.example.com     -> VDS IPv4
supabase.example.com  -> VDS IPv4
*.stand.example.com   -> VDS IPv4
```

Если на сервере включен IPv6, добавьте соответствующие `AAAA`. Если IPv6 не настроен, не добавляйте `AAAA`, иначе часть клиентов может пытаться подключаться к нерабочему адресу.

## 3. Supabase

Для продакшена не используйте `supabase start` как основной runtime. Он удобен для локальной разработки. На проде нужен self-hosted Supabase как отдельный Docker Compose stack или отдельный сервис.

В Supabase Auth должны быть выставлены:

```dotenv
API_EXTERNAL_URL=https://supabase.example.com
GOTRUE_SITE_URL=https://app.example.com
GOTRUE_URI_ALLOW_LIST=https://app.example.com
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_MAILER_AUTOCONFIRM=false
```

`GOTRUE_MAILER_AUTOCONFIRM=false` важен: без него регистрация будет требовать подтверждение email.

Если Supabase gateway доступен на этом же сервере на внутреннем адресе, например `127.0.0.1:54321`, в Whaler укажите:

```dotenv
SUPABASE_UPSTREAM=host.docker.internal:54321
SUPABASE_URL_DOCKER=http://host.docker.internal:54321
VITE_SUPABASE_URL=https://supabase.example.com
```

Если Supabase находится на другой машине или в другом Docker network, используйте адрес его Kong/API gateway.

## 4. Wildcard TLS для preview

Preview sandbox открывается на динамических хостах вида
`<preview-id>.stand.example.com`. Для HTTPS на таких хостах нужен wildcard
сертификат `*.stand.example.com`.

Стандартный образ `caddy:2.10-alpine` не может выпустить wildcard-сертификат
через HTTP challenge. Для production выберите один вариант:

- собрать Caddy с DNS-плагином вашего DNS-провайдера и настроить DNS-01 challenge;
- выпустить wildcard-сертификат отдельно и подключить его в Caddy через `tls /path/fullchain.pem /path/privkey.pem`;
- временно отключить preview wildcard route, если production preview пока не нужен.

В репозитории есть generic production-путь через `acme.sh`. Укажите DNS
provider из списка acme.sh и credentials, которые требует этот provider.

Для Beget это выглядит так:

```dotenv
ACME_DNS_PROVIDER=dns_beget
ACME_IMAGE=neilpang/acme.sh:3.1.4
Beget_Username=your-beget-login
Beget_Password=your-beget-api-password
STAND_TLS_DIRECTIVE="tls /acme-data/*.stand.example.com_ecc/fullchain.cer /acme-data/*.stand.example.com_ecc/*.stand.example.com.key"
```

Затем выпустите wildcard-сертификат:

```bash
just stand-cert
```

Сертификаты сохраняются в `storage/acme`, монтируются в Caddy как `/acme-data`, а
`STAND_TLS_DIRECTIVE` подключает их только для `*.stand.example.com`. Для
продления используйте:

```bash
just stand-cert-renew
```

Старые aliases `just beget-stand-cert` и `just beget-stand-cert-renew`
оставлены для совместимости, но основной путь не привязан к Beget.

## 5. SMTP для Supabase Auth

Email-подтверждение и восстановление пароля отправляет Supabase Auth, не Whaler API. Переменные `MAIL_MAILER` и `MAIL_SCHEME` из Laravel здесь не нужны.

В едином `.env` Whaler можно держать исходные SMTP-значения:

```dotenv
MAIL_HOST=smtp.example.com
MAIL_PORT=465
MAIL_USERNAME=no-reply@example.com
MAIL_PASSWORD=replace-with-real-password
MAIL_FROM_ADDRESS=no-reply@example.com
MAIL_FROM_NAME=Whaler
```

Эти значения нужно прокинуть в контейнер Supabase Auth:

```dotenv
GOTRUE_SMTP_HOST=${MAIL_HOST}
GOTRUE_SMTP_PORT=${MAIL_PORT}
GOTRUE_SMTP_USER=${MAIL_USERNAME}
GOTRUE_SMTP_PASS=${MAIL_PASSWORD}
GOTRUE_SMTP_ADMIN_EMAIL=${MAIL_FROM_ADDRESS}
GOTRUE_SMTP_SENDER_NAME=${MAIL_FROM_NAME}
```

После изменения SMTP-переменных перезапустите именно Supabase Auth. Затем проверьте регистрацию нового пользователя и письмо восстановления пароля.

## 6. `.env` Whaler

На сервере создайте `.env` из `.env.example` и замените значения. Для dev и production используется один и тот же dotenv-файл; отличаются только значения внутри него.

```dotenv
DATABASE_URL=postgres://postgres:strong-password@supabase-db:5432/postgres
DATABASE_URL_DOCKER=postgres://postgres:strong-password@host.docker.internal:54322/postgres

SUPABASE_JWT_SECRET=replace-with-real-supabase-jwt-secret
SUPABASE_URL_DOCKER=http://host.docker.internal:54321
VITE_SUPABASE_URL=https://supabase.example.com
VITE_SUPABASE_ANON_KEY=replace-with-real-anon-key

APP_DOMAIN=app.example.com
API_DOMAIN=api.example.com
COLLAB_DOMAIN=collab.example.com
VOICE_DOMAIN=voice.example.com
SUPABASE_DOMAIN=supabase.example.com
APP_ORIGIN=https://app.example.com

VITE_API_URL=https://api.example.com
VITE_COLLAB_URL=wss://collab.example.com
VITE_VOICE_URL=wss://voice.example.com

CADDY_ACME_EMAIL=ops@example.com
SUPABASE_UPSTREAM=host.docker.internal:54321

RUNNER_INTERNAL_TOKEN=replace-with-long-random-token
PREVIEW_NETWORK_NAME=whaler-preview
STAND_BASE_DOMAIN_DOCKER=stand.example.com
STAND_BASE_DOMAIN=stand.example.com

MEDIASOUP_ANNOUNCED_IP=replace-with-vds-public-ip
MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=40100

TURN_REALM=whaler
TURN_STATIC_SECRET=replace-with-long-random-secret
TURN_URL=turn:voice.example.com:3478?transport=udp,turn:voice.example.com:3478?transport=tcp
STUN_URL=stun:stun.l.google.com:19302
```

Для `SUPABASE_JWT_SECRET` используйте тот же секрет, которым Supabase Auth подписывает JWT. `VITE_SUPABASE_ANON_KEY` берите из production Supabase, а не из локального `supabase status`.

`VITE_*` переменные попадают в frontend на этапе сборки Docker image. Если меняете домены или anon key, пересоберите `web` image.

`CADDY_ACME_EMAIL` должен быть реальным почтовым адресом. Let's Encrypt
отклоняет placeholder-домены вроде `example.com`.

## 7. Сборка и запуск

Перед первым запуском создайте preview network и соберите sandbox images:

```bash
just sandbox-network
just sandbox-images
```

Проверьте compose-конфигурацию:

```bash
docker compose config
```

Запустите приложение:

```bash
docker compose up -d --build
```

Если нужен TURN через встроенный `coturn` profile:

```bash
docker compose --profile turn up -d coturn
```

Для обновления после изменения кода:

```bash
git pull
docker compose up -d --build
```

## 8. База данных

Whaler использует Drizzle-миграции из `packages/db/drizzle`. Перед миграцией убедитесь, что `DATABASE_URL` указывает на production Postgres Supabase.

Запуск миграций:

```bash
pnpm install
DATABASE_URL=postgres://postgres:strong-password@host:5432/postgres pnpm --filter @whaler/db db:migrate
```

Не запускайте `supabase db reset` на production: он пересоздает локальную базу и опасен для данных.

## 9. Проверки перед открытием пользователям

Проверьте локально на сервере:

```bash
pnpm typecheck
pnpm --filter @whaler/web build
docker compose config
docker compose ps
docker compose logs --tail=120 caddy
docker compose logs --tail=120 api
```

Проверьте снаружи:

- `https://app.example.com` открывает frontend.
- `https://api.example.com` отвечает через Caddy.
- `https://supabase.example.com/auth/v1/settings` доступен.
- Регистрация отправляет письмо подтверждения через настроенный SMTP.
- После подтверждения email пользователь может войти.
- `Forgot password` отправляет recovery-письмо.
- Recovery-ссылка открывает экран установки нового пароля.
- Workspace создается и открывается.
- Preview sandbox открывается на поддомене `*.stand.example.com`.
- Voice/collab работают через `wss://voice.example.com` и `wss://collab.example.com`.

## 10. Обслуживание

Полезные команды:

```bash
docker compose ps
docker compose logs -f --tail=120
docker compose logs -f --tail=120 api
docker compose logs -f --tail=120 caddy
docker compose restart api collab voice runner web
docker compose down
docker compose up -d
```

После изменения `.env`:

```bash
docker compose up -d --build
```

После изменения только Caddyfile:

```bash
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Регулярно делайте backup production Postgres/Supabase volumes. Минимальная рабочая политика: ежедневный backup базы, проверка восстановления на отдельной машине и отдельное хранение секретов `.env`.

## 11. Частые ошибки

Если письма не приходят:

- Проверьте, что SMTP-переменные заданы в Supabase Auth, а не только в Whaler.
- Проверьте `GOTRUE_MAILER_AUTOCONFIRM=false`.
- Проверьте `GOTRUE_SITE_URL` и `GOTRUE_URI_ALLOW_LIST`.
- Проверьте лог Supabase Auth.
- Проверьте SPF/DKIM/DMARC домена отправителя у SMTP-провайдера.

Если confirmation/recovery ссылка ведет не туда:

- Проверьте `API_EXTERNAL_URL=https://supabase.example.com`.
- Проверьте `GOTRUE_SITE_URL=https://app.example.com`.
- Проверьте, что frontend вызывает production Supabase URL: `VITE_SUPABASE_URL=https://supabase.example.com`.
- Пересоберите `web` image после изменения `VITE_*`.

Если frontend открывается, но API не работает:

- Проверьте `APP_ORIGIN=https://app.example.com`.
- Проверьте `VITE_API_URL=https://api.example.com`.
- Проверьте `SUPABASE_JWT_SECRET` в `api`, `collab` и `voice`.
- Проверьте доступность `SUPABASE_URL_DOCKER` из контейнеров.

Если voice не работает:

- Проверьте открытые RTC-порты `MEDIASOUP_RTC_MIN_PORT`-`MEDIASOUP_RTC_MAX_PORT` для TCP/UDP.
- Проверьте `MEDIASOUP_ANNOUNCED_IP`, он должен быть публичным IP сервера.
- Проверьте TURN, если клиенты находятся за строгими NAT.

Если preview не открывается:

- Проверьте wildcard DNS `*.stand.example.com`.
- Проверьте `STAND_BASE_DOMAIN_DOCKER=stand.example.com`.
- Проверьте Docker network из `PREVIEW_NETWORK_NAME` (`whaler-preview` по умолчанию).
