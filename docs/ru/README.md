# Документация Whaler

Whaler состоит из нескольких отдельных сервисов: Vue-приложение, API с
авторизацией, сервер коллаборации, voice-сервис и внутренний Docker runner.
Supabase отвечает за Auth, Postgres и Storage. Caddy принимает публичный HTTPS
трафик и маршрутизирует домены приложения, API, realtime-сервисов и preview.

## С чего начать

- [Локальная разработка](./DEVELOPMENT.md): установка зависимостей, запуск
  Supabase, запуск приложения, сброс локальной базы и работа с отдельными
  сервисами.
- [Production-деплой](./DEPLOYMENT.md): подготовка сервера, DNS, self-hosted
  Supabase, wildcard TLS для preview и запуск Whaler.
- [Архитектура](./ARCHITECTURE.md): модель workspace/container, realtime,
  preview routing и границы безопасности.

## Кратко о runtime

Whaler хранит metadata workspace и файлы в Postgres, а исполняемое состояние
зеркалирует в Docker-контейнер с volume, смонтированным в `/workspace`.
Браузерный редактор работает через API и collab websocket, а preview и terminal
команды запускаются внутри sandbox-контейнера через внутренний runner.

Это не статический редактор кода: preview является настоящим процессом внутри
того же filesystem, который редактирует пользователь.

## Карта сервисов

- `web`: Vue/Vuetify frontend, в production отдается nginx.
- `api`: Hono API для workspaces, файлов, профилей, preview-сессий и проверок
  доступа.
- `collab`: Hocuspocus/Yjs websocket server для document state и presence.
- `runner`: внутренний Docker control plane для workspace-контейнеров и preview
  proxy.
- `voice`: mediasoup signaling и управление voice rooms.
- `caddy`: публичная HTTPS/HTTP3 точка входа.
- `supabase`: внешний/self-hosted stack для Auth, Postgres и Storage.
