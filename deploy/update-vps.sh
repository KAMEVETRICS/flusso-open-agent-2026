#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/flusso"
APP_USER="flusso"
ENV_FILE="/etc/flusso/flusso.env"

# Units installed by the retired OKX marketplace integration.
LEGACY_UNITS=(
  flusso-a2a-health.timer
  flusso-a2a-health.service
  flusso-recovery.timer
  flusso-recovery.service
  flusso-a2a.service
)

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this updater as root." >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "$APP_DIR is not a Git clone." >&2
  exit 1
fi

if [[ -n "$(runuser -u "$APP_USER" -- git -C "$APP_DIR" status --porcelain)" ]]; then
  echo "The VPS worktree has local changes. Commit or remove them before updating." >&2
  exit 1
fi

previous_revision="$(runuser -u "$APP_USER" -- git -C "$APP_DIR" rev-parse HEAD)"
runuser -u "$APP_USER" -- git -C "$APP_DIR" pull --ff-only
current_revision="$(runuser -u "$APP_USER" -- git -C "$APP_DIR" rev-parse HEAD)"

if [[ "$previous_revision" != "$current_revision" && "${FLUSSO_UPDATE_REEXEC:-0}" != "1" ]]; then
  exec env FLUSSO_UPDATE_REEXEC=1 bash "$APP_DIR/deploy/update-vps.sh"
fi

runuser -u "$APP_USER" -- npm --prefix "$APP_DIR" ci
runuser -u "$APP_USER" -- npm --prefix "$APP_DIR" run build

for unit in "${LEGACY_UNITS[@]}"; do
  if [[ -f "/etc/systemd/system/$unit" ]]; then
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/$unit"
    echo "Retired legacy unit $unit."
  fi
done

install -o root -g root -m 0644 \
  "$APP_DIR/deploy/systemd/flusso-engine.service" \
  /etc/systemd/system/flusso-engine.service
systemctl daemon-reload
systemctl restart flusso-engine.service

APP_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" bash "$APP_DIR/deploy/smoke-test.sh"

echo "Deployment updated successfully."
