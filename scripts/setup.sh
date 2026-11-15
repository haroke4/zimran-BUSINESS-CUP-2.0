#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
uv sync --locked
npm --prefix src/generation ci
./src/generation/node_modules/.bin/playwright install chromium
npm --prefix src/frontend ci
npm --prefix src/frontend run build
