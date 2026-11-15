#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f src/static/dist/index.html ]]; then
  npm --prefix src/frontend run build
fi
uv_args=(run --locked)
if [[ -f .env ]]; then
  uv_args+=(--env-file .env)
fi
exec uv "${uv_args[@]}" uvicorn src.main:app --host "${STORYFORK_HOST:-127.0.0.1}" --port "${STORYFORK_PORT:-8000}"
