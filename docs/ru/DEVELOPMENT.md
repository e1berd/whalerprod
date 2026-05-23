# Локальная разработка

Эта инструкция поднимает полный development stack WhalerProd на одной машине.

## Требования

- Node.js `>=22.13.0` и pnpm `11.2.2`.
- Docker с Docker Compose plugin.
- Supabase CLI.
- `just`.
- Локальный Docker socket по пути `/var/run/docker.sock`.

## Первый запуск

Установите зависимости:

```bash
just install
```

Скопируйте пример окружения:

```bash
cp .env.example .env
```

Запустите локальный Supabase:

```bash
just supabase-start
```

Посмотрите сгенерированные локальные ключи:

```bash
just supabase-status
```

Скопируйте local Supabase anon key в `VITE_SUPABASE_ANON_KEY` в `.env`.
Остальные development-значения в `.env.example` уже указывают на локальные
порты Supabase.

Создайте Docker network для preview и соберите отсутствующие sandbox images:

```bash
just sandbox-up
```

Сбросьте/примените локальную базу:

```bash
just supabase-reset
```

Запустите полный stack:

```bash
just dev
```

Web-приложение будет доступно на `http://localhost:5173`.

## Что запускает `just dev`

`just dev` стартует локальный Supabase, проверяет sandbox images, запускает TURN
и затем поднимает:

- API на `http://localhost:3000`.
- Collaboration websocket server на `ws://localhost:3001`.
- Runner на `http://localhost:3002`.
- Voice websocket server на `ws://localhost:3003`.
- Web app на `http://localhost:5173`.

## Запуск отдельных сервисов

Эти команды удобны, когда нужно работать только над одним сервисом:

```bash
just dev-api
just dev-collab
just dev-runner
just dev-voice
just dev-web
```

## Работа с базой

После изменения схемы создайте Drizzle migration:

```bash
pnpm db:generate
```

Примените migration через настроенный `DATABASE_URL`:

```bash
pnpm db:migrate
```

Только для локального Supabase можно сбросить базу и применить migrations
заново:

```bash
just supabase-reset
```

Не запускайте `just supabase-reset` на production-данных.

## Preview sandboxes

Runner управляет Docker-контейнерами через локальный Docker socket. Каждый
workspace получает контейнер и Docker volume, смонтированный в `/workspace`.
Preview images собираются командой:

```bash
just sandbox-images
```

Локальная preview network создается командой:

```bash
just sandbox-network
```

## Проверка

Перед pull request или деплоем запустите:

```bash
just typecheck
just build
docker compose config
```

Если preview не стартует, смотрите preview log в UI или логи runner:

```bash
docker compose logs --tail=120 runner
```
