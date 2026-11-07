#!/usr/bin/env bash
# Update the running application (also called by setup-server.sh with --first-run). Run on the server as root:  saad-deploy
# Order matters: backup -> pull -> install -> MIGRATE -> build -> restart -> health check. A failed migration stops before any restart.
set -euo pipefail
APP=/opt/saad-albaqmi; RUN_USER=saad; ETC=/etc/saad-albaqmi
set -a; . "$ETC/api.env"; . "$ETC/web-build.env"; set +a
as_app() { sudo -u "$RUN_USER" --preserve-env=DATABASE_URL,VITE_CLERK_PUBLISHABLE_KEY,VITE_AUTH_MODE,VITE_CLERK_PROXY_URL,NODE_ENV,PORT,BASE_PATH bash -lc "cd $APP && $*"; }
if [ "${1:-}" != "--first-run" ]; then
  install -d -m 700 /var/backups/saad-albaqmi
  sudo -u postgres pg_dump -Fc "${DB_NAME:-saad_albaqmi}" > "/var/backups/saad-albaqmi/pre-deploy-$(date +%F-%H%M).dump"
  git -C "$APP" fetch --all -q
  BR=$(git -C "$APP" rev-parse --abbrev-ref HEAD)
  git -C "$APP" reset -q --hard "origin/$BR"
  chown -R "$RUN_USER":"$RUN_USER" "$APP"
fi
as_app "pnpm install --frozen-lockfile --config.strict-dep-builds=false"
as_app "pnpm --filter @workspace/db run migrate"
export PORT=3000 BASE_PATH=/
as_app "pnpm --filter @workspace/api-server run build"
as_app "pnpm --filter @workspace/saad-albaqmi run build"
export PORT="${API_PORT:-3001}"
systemctl restart saad-albaqmi-api
for i in $(seq 1 20); do
  if curl -fs "http://127.0.0.1:${API_PORT:-3001}/api/readyz" >/dev/null; then echo "API healthy"; exit 0; fi
  sleep 1
done
echo "API did not become healthy: journalctl -u saad-albaqmi-api -n 80"
exit 1
