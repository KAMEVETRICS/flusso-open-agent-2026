#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/flusso"
APP_USER="flusso"
APP_GROUP="flusso"
APP_HOME="/home/flusso"
CONFIG_DIR="/etc/flusso"
ENV_FILE="$CONFIG_DIR/flusso.env"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "Clone the GitHub repository to $APP_DIR before running this installer." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required." >&2
  exit 1
fi

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 16)) {
  console.error("Node.js >= 22.16.0 is required. Found " + process.versions.node + ".");
  process.exit(1);
}
'

if ! getent group "$APP_GROUP" >/dev/null 2>&1; then
  groupadd --system "$APP_GROUP"
fi
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_HOME" \
    --shell /bin/bash --gid "$APP_GROUP" "$APP_USER"
fi

install -d -o root -g "$APP_GROUP" -m 0750 "$CONFIG_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  install -o root -g "$APP_GROUP" -m 0640 \
    "$APP_DIR/deploy/env.production.example" "$ENV_FILE"
  echo "Created $ENV_FILE."
  echo "Fill in OPENAI_API_KEY, FIRECRAWL_API_KEY, and DATABASE_URL, then run this installer again."
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for name in \
  OPENAI_API_KEY \
  FIRECRAWL_API_KEY \
  DATABASE_URL; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is missing from $ENV_FILE." >&2
    exit 1
  fi
done

chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

runuser -u "$APP_USER" -- npm --prefix "$APP_DIR" ci
runuser -u "$APP_USER" -- npm --prefix "$APP_DIR" run build

install -o root -g root -m 0644 \
  "$APP_DIR/deploy/systemd/flusso-engine.service" \
  /etc/systemd/system/flusso-engine.service

chmod 0755 \
  "$APP_DIR/deploy/install-vps.sh" \
  "$APP_DIR/deploy/update-vps.sh" \
  "$APP_DIR/deploy/smoke-test.sh"

systemctl daemon-reload
systemctl enable --now flusso-engine.service

APP_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" bash "$APP_DIR/deploy/smoke-test.sh"

echo "Flusso is running on http://127.0.0.1:3107."
