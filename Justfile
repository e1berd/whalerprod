set dotenv-load := true

default:
    @just --list

install:
    pnpm install

dev: supabase-start sandbox-up turn-up
    #!/usr/bin/env bash
    set -euo pipefail

    pids=()

    cleanup() {
      trap - INT TERM EXIT
      if [ "${#pids[@]}" -gt 0 ]; then
        kill "${pids[@]}" >/dev/null 2>&1 || true
        wait "${pids[@]}" >/dev/null 2>&1 || true
      fi
    }

    wait_for_port() {
      local name="$1"
      local host="$2"
      local port="$3"

      for _ in $(seq 1 80); do
        if (echo >"/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
          return 0
        fi
        sleep 0.25
      done

      echo "Timed out waiting for ${name} on ${host}:${port}" >&2
      return 1
    }

    trap cleanup INT TERM EXIT

    pnpm -r --parallel \
      --filter @whaler/api \
      --filter @whaler/collab \
      --filter @whaler/runner \
      --filter @whaler/voice \
      dev &
    pids+=("$!")

    wait_for_port api 127.0.0.1 3000
    wait_for_port collab 127.0.0.1 3001
    wait_for_port runner 127.0.0.1 3002
    wait_for_port voice 127.0.0.1 3003

    pnpm -r --parallel --filter @whaler/web dev &
    pids+=("$!")

    wait -n "${pids[@]}"

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
