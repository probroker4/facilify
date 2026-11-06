#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/facilify
DATA_DIR=/var/lib/facilify
ENV_FILE=/etc/facilify.env
RUN_USER=facilify
HOST_ARG="${1:-}"
ORIG_HOME="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"
TARBALL="${TARBALL:-$ORIG_HOME/facilify-deploy.tar.gz}"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo:  sudo bash bootstrap.sh"
[ -f "$TARBALL" ] || die "Could not find $TARBALL. Upload facilify-deploy.tar.gz to your home folder first (see DEPLOY.md, step 5)."
export DEBIAN_FRONTEND=noninteractive

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 3500 ] && ! swapon --show | grep -q .; then
  say "Adding 3 GB of swap space (this server has ${MEM_MB} MB of memory)"
  fallocate -l 3G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=3072 status=none
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Installing system packages"
apt-get update -y >/dev/null
apt-get install -y curl ca-certificates gnupg openssl netcat-openbsd iptables-persistent debian-keyring debian-archive-keyring apt-transport-https build-essential python3 >/dev/null

node_ok() { node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; }
if ! node_ok; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
fi
node_ok || die "Node 22.13 or newer is required but this server has $(node -v 2>/dev/null || echo none)."
echo "Node $(node -v)"

if ! command -v caddy >/dev/null; then
  say "Installing Caddy (web server with automatic HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y >/dev/null
  apt-get install -y caddy >/dev/null
fi

say "Opening ports 80 and 443 in the server firewall"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport "$p" -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

id "$RUN_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$RUN_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"
say "Unpacking the app into $APP_DIR"
tar -xzf "$TARBALL" -C "$APP_DIR" --no-same-owner
cd "$APP_DIR"
say "Installing dependencies (a few minutes)"
npm ci --no-audit --no-fund --fetch-retries=5 >/dev/null
say "Building the app (a few minutes on a small server)"
NODE_OPTIONS="--max-old-space-size=2048" npx next build >/tmp/facilify-build.log 2>&1 || { tail -30 /tmp/facilify-build.log; die "The build failed (log above, full log: /tmp/facilify-build.log)."; }
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR" "$DATA_DIR"
chmod 700 "$DATA_DIR"

if [ -n "$HOST_ARG" ]; then
  HOST="$HOST_ARG"
else
  IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)"
  [ -n "$IP" ] || die "Could not work out this server's public IP. Run again with your domain name:  sudo bash bootstrap.sh your.domain.name"
  HOST="${IP//./-}.sslip.io"
fi

if [ ! -f "$ENV_FILE" ]; then
  say "Creating $ENV_FILE with a new random secret"
  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
CERTFLOW_DATA_DIR=$DATA_DIR
CERTFLOW_SECRET=$(openssl rand -hex 32)
CERTFLOW_BASE_URL=https://$HOST
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
CERTFLOW_OPEN_SIGNIN=1
ORGANIZER_EMAILS=
GOOGLE_FONTS_API_KEY=
EOF
else
  sed -i "s|^CERTFLOW_BASE_URL=.*|CERTFLOW_BASE_URL=https://$HOST|" "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

cat > /etc/systemd/system/facilify.service <<EOF
[Unit]
Description=Facilify
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$HOST {
	encode gzip
	request_body {
		max_size 30MB
	}
	reverse_proxy 127.0.0.1:3000
}
EOF

say "Starting Facilify"
systemctl daemon-reload
systemctl enable facilify >/dev/null 2>&1
systemctl restart facilify
systemctl restart caddy

OK=0
for _ in $(seq 1 45); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
[ "$OK" -eq 1 ] || { journalctl -u facilify -n 40 --no-pager; die "The app did not start (log above)."; }

say "Checking whether this server can send email through an SMTP server (port 587)"
if timeout 8 bash -c '</dev/tcp/smtp.gmail.com/587' 2>/dev/null; then SMTP="OPEN: SMTP sending will work."; else SMTP="BLOCKED: use Gmail (Google sign-in) as the sender instead of SMTP. Gmail and Drive are not affected."; fi

cat <<EOF

=====================================================================
 Facilify is running.

   Open:  https://$HOST
   (If the page does not load in ~1 minute, check step 4 of DEPLOY.md: the Oracle firewall rules for ports 80 and 443.)

   NEXT: open the address and create your organizer account right away.
         Until the first account exists, anyone who finds the address could create it.

   SMTP port 587 from this server: $SMTP

   Logs:   sudo journalctl -u facilify -f
   Update: upload a new facilify-deploy.tar.gz and run this script again.
   Backup: $DATA_DIR  and  $ENV_FILE  (keep the secret, or saved Google/SMTP logins cannot be read again)
=====================================================================
EOF
