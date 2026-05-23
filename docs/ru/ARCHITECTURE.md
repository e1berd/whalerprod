# Архитектура

Whaler построен вокруг простого правила: браузерный редактор и исполняемый
sandbox должны описывать один и тот же workspace.

## Основные сервисы

- `web`: Vue/Vuetify приложение с CodeMirror.
- `api`: Hono API для lifecycle workspace, файлов, профилей, membership,
  preview creation и orchestration runner.
- `collab`: Hocuspocus/Yjs server для realtime text, cursor, selection и
  workspace presence.
- `runner`: внутренний сервис, который управляет Docker.
- `voice`: mediasoup service для voice rooms.
- `caddy`: публичный HTTPS router.
- `supabase`: self-hosted Auth, Postgres и Storage.

## Workspace state

Состояние workspace состоит из двух слоев:

- Postgres хранит durable metadata: workspaces, members, files, profiles и Yjs
  document snapshots.
- Docker хранит executable state: у каждого workspace есть контейнер и volume,
  смонтированный в `/workspace`.

При create/update API сначала пишет canonical row в Postgres, затем вызывает
runner, чтобы зеркалировать файл или директорию в workspace container. Runner
использует Docker archive writes, а не shell-команды для записи файлов.

## Lifecycle контейнера

Workspace containers называются `whaler-<workspace-id>`. Volumes называются
`whaler-workspace-<workspace-id>`.

Runner:

- проверяет, что нужный sandbox image существует;
- создает или переиспользует workspace container;
- подключает container к preview network;
- монтирует workspace volume в `/workspace`;
- применяет лимиты memory, CPU, PID, capabilities и privileges;
- держит container живым через `sleep infinity`;
- перезапускает container перед web preview.

## Preview flow

1. Пользователь нажимает Run.
2. API проверяет доступ и загружает конфигурацию workspace image.
3. API гарантирует наличие default files и replay текущего file tree в
   container.
4. API создает preview id и host внутри настроенного stand domain.
5. Runner перезапускает container, стартует preview command, пишет logs в
   `/tmp` и ждет выбранный port.
6. Caddy маршрутизирует preview hostname к runner.
7. Runner proxy HTTP requests к container IP и preview port.

Для Vite templates Whaler вырезает Vite HMR client и отдает no-op HMR
compatibility module. Это убирает websocket warnings в браузере, но сохраняет
CSS injection для Vite-served modules.

## Collaboration flow

Collaboration server проверяет Supabase JWT и доступ к запрошенному file
document или workspace presence document.

Для file documents:

- если Yjs snapshot уже есть, он загружается из `collab_documents`;
- иначе initial Yjs document создается из `files.content`;
- при store encoded Yjs state сохраняется, а `files.content` обновляется
  текущим текстом.

Так Whaler поддерживает realtime editing и одновременно держит plain text file
tree доступным для API и runner.

## Границы безопасности

- Browser clients никогда не получают доступ к Docker socket.
- Runner endpoints находятся под `/internal/*` и требуют `x-runner-token`.
- Docker containers запускаются с dropped capabilities и `no-new-privileges`.
- Sandbox memory, CPU и PID limits настраиваются через env.
- Preview containers живут в отдельной Docker network.
- Public domains завершаются и маршрутизируются через Caddy.
- Supabase JWT проверяются app services перед доступом к workspace.

Runner намеренно обладает большими правами, потому что управляет Docker.
Держите его приватным внутри compose network и ротируйте `RUNNER_INTERNAL_TOKEN`,
если он утек.
