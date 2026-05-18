set dotenv-load := true

default:
    @just --list

install:
    pnpm install

dev: supabase-start sandbox-up turn-up
    pnpm dev

sandbox-up: sandbox-network sandbox-images

sandbox-network:
    docker network create whaler-preview >/dev/null 2>&1 || true

turn-up:
    docker compose --profile turn up -d coturn

turn-down:
    docker compose --profile turn down

turn-logs:
    docker compose --profile turn logs -f coturn


dev-web:
    pnpm --filter @whaler/web dev

dev-api:
    pnpm --filter @whaler/api dev

dev-collab:
    pnpm --filter @whaler/collab dev

dev-voice:
    pnpm --filter @whaler/voice dev

dev-runner:
    pnpm --filter @whaler/runner dev

supabase-start:
    supabase start -x edge-runtime

supabase-stop:
    supabase stop

supabase-status:
    supabase status

supabase-reset:
    supabase db reset

typecheck:
    pnpm typecheck

build:
    pnpm build

sandbox-images:
    #!/usr/bin/env bash
    set -euo pipefail
    images=(
      "whaler/sandbox-vite-vue:latest infra/sandbox-images/vite-vue"
      "whaler/sandbox-vite-react:latest infra/sandbox-images/vite-react"
      "whaler/sandbox-vite-angular:latest infra/sandbox-images/vite-angular"
      "whaler/sandbox-vite-js:latest infra/sandbox-images/vite-js"
      "whaler/sandbox-vite-ts:latest infra/sandbox-images/vite-ts"
    )
    for item in "${images[@]}"; do
      image="${item%% *}"
      context="${item#* }"
      if docker image inspect "$image" >/dev/null 2>&1; then
        echo "$image already exists"
      else
        docker build -t "$image" "$context"
      fi
    done

compose-up:
    docker compose up --build

compose-down:
    docker compose down

compose-logs:
    docker compose logs -f --tail=120
