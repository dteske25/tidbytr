#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${CONFIG_PATH:-/data/options.json}"
RUNTIME_CONFIG_PATH="${TIDBYTR_CONFIG_PATH:-/data/config.json}"

mkdir -p /data
node /app/dist/server/ha-options.js "$CONFIG_PATH" "$RUNTIME_CONFIG_PATH"

export TIDBYTR_DATA_DIR="${TIDBYTR_DATA_DIR:-/data}"
export TIDBYTR_CONFIG_PATH="$RUNTIME_CONFIG_PATH"
export TIDBYTR_HOST="${TIDBYTR_HOST:-0.0.0.0}"
export TIDBYTR_PORT="${TIDBYTR_PORT:-8787}"

exec node /app/dist/server/index.js
