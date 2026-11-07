#!/usr/bin/env bash
# One-time server setup (Ubuntu/Debian). Run ON THE SERVER as root:
#   scp deploy/secrets.env root@SERVER:/root/secrets.env
#   scp deploy/setup-server.sh root@SERVER:/root/ && ssh root@SERVER 'bash /root/setup-server.sh /root/secrets.env'
# It installs Node.js 22, pnpm, PostgreSQL, nginx, creates the database "saad_albaqmi", builds the app, applies the migrations,
# installs a systemd service, nginx (+HTTPS when DOMAIN is set), a firewall and nightly backups. Safe to run again.
set -euo pipefail
ENV_FILE="${1:-/root/secrets.env}"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (copy deploy/secrets.env to the server first)"; exit 1; }
set -a; . "$ENV_FILE"; set +a
: "${DB_PASSWORD:?DB_PASSWORD is empty}"
AUTH_MODE="${AUTH_MODE:-local}"   # local = self-hosted sign-in + in-app OTP (no Clerk, no e-mail provider); clerk = external provider
if [ "$AUTH_MODE" = "clerk" ]; then
  : "${CLERK_SECRET_KEY:?CLERK_SECRET_KEY is empty}"
  : "${VITE_CLERK_PUBLISHABLE_KEY:?VITE_CLERK_PUBLISHABLE_KEY is empty}"
fi
: "${ORG_OWNER_EMAIL:?ORG_OWNER_EMAIL is empty}"
: "${OTP_HMAC_SECRET:?OTP_HMAC_SECRET is empty}"
: "${CARD_HMAC_SECRET:?CARD_HMAC_SECRET is empty}"
APP=/opt/saad-albaqmi; RUN_USER=saad; ETC=/etc/saad-albaqmi; PORT=3001
DB_NAME="${DB_NAME:-saad_albaqmi}"; DB_USER="${DB_USER:-saad}"; GIT_BRANCH="${GIT_BRANCH:-main}"
REPO=https://github.com/msafr5-web/saad-albaqmi.git

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx postgresql postgresql-contrib ufw certbot python3-certbot-nginx ca-certificates sudo
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@10 --activate

echo "== database $DB_NAME"
systemctl enable --now postgresql
sudo -u postgres psql -v ON_ERROR_STOP=1 -v pw="$DB_PASSWORD" -v u="$DB_USER" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'u') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'u') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'u', :'pw') \gexec
SQL
sudo -u postgres psql -v ON_ERROR_STOP=1 -v d="$DB_NAME" -v u="$DB_USER" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' TEMPLATE template0', :'d', :'u') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'d') \gexec
SQL
sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS btree_gist;'
DATABASE_URL="postgres://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME"

echo "== application user and code"
id "$RUN_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$RUN_USER"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch --all -q
  git -C "$APP" checkout -q "$GIT_BRANCH"
  git -C "$APP" reset -q --hard "origin/$GIT_BRANCH"
else
  git clone -q --branch "$GIT_BRANCH" "$REPO" "$APP"
fi
chown -R "$RUN_USER":"$RUN_USER" "$APP"

echo "== runtime configuration ($ETC, readable by root and the service user only)"
install -d -m 750 -o root -g "$RUN_USER" "$ETC"
cat > "$ETC/api.env" <<ENV
NODE_ENV=production
PORT=$PORT
DATABASE_URL=$DATABASE_URL
AUTH_MODE=$AUTH_MODE
OTP_CHANNEL=${OTP_CHANNEL:-$([ "$AUTH_MODE" = local ] && echo app || echo email)}
OWNER_SETUP_TOKEN=${OWNER_SETUP_TOKEN:-$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)}
CLERK_SECRET_KEY=${CLERK_SECRET_KEY:-}
CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY:-${VITE_CLERK_PUBLISHABLE_KEY:-}}
ORG_OWNER_EMAIL=$ORG_OWNER_EMAIL
RESEND_API_KEY=${RESEND_API_KEY:-}
RESEND_FROM_EMAIL=${RESEND_FROM_EMAIL:-}
APP_PUBLIC_URL=${DOMAIN:+https://$DOMAIN}
OTP_HMAC_SECRET=$OTP_HMAC_SECRET
CARD_HMAC_SECRET=$CARD_HMAC_SECRET
OTP_FINANCE_REQUIRED=${OTP_FINANCE_REQUIRED:-false}
RATE_LIMIT_PER_MINUTE=${RATE_LIMIT_PER_MINUTE:-300}
RATE_LIMIT_WRITES_PER_MINUTE=${RATE_LIMIT_WRITES_PER_MINUTE:-60}
PERSONAL_RECORD_LIMIT=${PERSONAL_RECORD_LIMIT:-2000}
TRUST_PROXY_HOPS=1
DB_POOL_MAX=10
DB_NAME=$DB_NAME
API_PORT=$PORT
ENV
cat > "$ETC/web-build.env" <<ENV
VITE_AUTH_MODE=$AUTH_MODE
VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY:-}
VITE_CLERK_PROXY_URL=${VITE_CLERK_PROXY_URL:-}
ENV
chmod 640 "$ETC/api.env" "$ETC/web-build.env"
chown root:"$RUN_USER" "$ETC/api.env" "$ETC/web-build.env"

echo "== services"
install -m 755 "$APP/deploy/deploy.sh" /usr/local/bin/saad-deploy
install -m 644 "$APP/deploy/saad-albaqmi-api.service" /etc/systemd/system/saad-albaqmi-api.service
sed -e "s#__DOMAIN__#${DOMAIN:-_}#g" -e "s#__APP__#$APP#g" -e "s#__PORT__#$PORT#g" "$APP/deploy/nginx.conf.template" > /etc/nginx/sites-available/saad-albaqmi
ln -sf /etc/nginx/sites-available/saad-albaqmi /etc/nginx/sites-enabled/saad-albaqmi
rm -f /etc/nginx/sites-enabled/default
systemctl daemon-reload
systemctl enable saad-albaqmi-api

echo "== install, migrate, build, start"
/usr/local/bin/saad-deploy --first-run
nginx -t
systemctl reload nginx

echo "== firewall and HTTPS"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
if [ -n "${DOMAIN:-}" ] && [ -n "${LETSENCRYPT_EMAIL:-}" ]; then
  certbot --nginx -d "$DOMAIN" -m "$LETSENCRYPT_EMAIL" --agree-tos -n --redirect || echo "!! certbot failed: check that $DOMAIN points to this server (A record)"
else
  echo "!! DOMAIN or LETSENCRYPT_EMAIL missing: running over plain HTTP. Sign-in (Clerk) and NFC need HTTPS."
fi

echo "== nightly backup (14 days)"
install -d -m 700 /var/backups/saad-albaqmi
printf '%s\n' "30 2 * * * root sudo -u postgres pg_dump -Fc $DB_NAME > /var/backups/saad-albaqmi/\$(date +\\%F).dump && find /var/backups/saad-albaqmi -name '*.dump' -mtime +14 -delete" > /etc/cron.d/saad-albaqmi-backup
echo "Done. Check: curl -s http://127.0.0.1:$PORT/api/readyz"
