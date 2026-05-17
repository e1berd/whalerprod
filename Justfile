set dotenv-load := true

default:
    @just --list

install:
    pnpm install

dev:
    pnpm dev


dev-web:
    pnpm --filter @whaler/web dev

dev-api:
    pnpm --filter @whaler/api dev

dev-collab:
    pnpm --filter @whaler/collab dev

dev-runner:
    pnpm --filter @whaler/runner dev

supabase-start:
    supabase start

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

compose-up:
    docker compose up --build

compose-down:
    docker compose down

compose-logs:
    docker compose logs -f --tail=120
