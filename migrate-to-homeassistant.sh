#!/bin/bash
set -e

# ── Värvid ──────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}✓ $*${N}"; }
info() { echo -e "${Y}→ $*${N}"; }
err()  { echo -e "${R}✗ $*${N}"; exit 1; }

echo ""
echo "  Üleminek Gladys'elt Home Assistant'ile (automaatne)"
echo "────────────────────────────────────────────────────"

CURRENT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CURRENT_DIR"

# ── 1. Home Assistant käivitamine ────────────────────────────────────────────
if ! docker ps --format '{{.Names}}' | grep -q '^homeassistant$'; then
  info "Käivitan Home Assistant'i..."
  mkdir -p "$CURRENT_DIR/homeassistant-config"
  docker compose -f docker/docker-compose.homeassistant.yml up -d
else
  ok "Home Assistant töötab juba"
fi

info "Ootan, kuni Home Assistant vastab (kuni 2 min)..."
READY=0
for i in $(seq 1 60); do
  if curl -fs http://127.0.0.1:8123 >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done
[ "$READY" -eq 1 ] || err "Home Assistant ei vastanud 2 minuti jooksul. Kontrolli: docker compose -f docker/docker-compose.homeassistant.yml logs"
ok "Home Assistant vastab (port 8123)"

# ── 2. Apache vhost leidmine ja suunamine ────────────────────────────────────
VHOST_FILE=$(sudo grep -rl "mrnux.ee" /etc/apache2/sites-available/ 2>/dev/null | grep -v "ha\.mrnux\.ee" | head -n1 || true)
if [ -z "$VHOST_FILE" ]; then
  err "Ei leidnud mrnux.ee Apache vhost faili automaatselt (otsisin /etc/apache2/sites-available/). Kontrolli käsitsi ja anna mulle teada, mis fail see on."
fi
ok "Leidsin Apache vhost: $VHOST_FILE"

BACKUP_FILE="${VHOST_FILE}.bak-$(date +%Y%m%d%H%M%S)"
sudo cp "$VHOST_FILE" "$BACKUP_FILE"
ok "Varukoopia: $BACKUP_FILE (taastamiseks vt lõpus)"

info "Suunan mrnux.ee: port 8080 (Gladys) -> 8123 (Home Assistant)..."
sudo sed -i 's/127\.0\.0\.1:8080/127.0.0.1:8123/g; s/localhost:8080/127.0.0.1:8123/g' "$VHOST_FILE"

if ! sudo grep -q "proxy_wstunnel\|Upgrade.*websocket\|websocket.*Upgrade" "$VHOST_FILE"; then
  info "Lisan WebSocket toe (Home Assistant liides vajab seda reaalajas uuenduste jaoks)..."
  sudo sed -i '/<VirtualHost/a\
    RewriteEngine On\
    RewriteCond %{HTTP:Upgrade} =websocket [NC]\
    RewriteRule /(.*) ws://127.0.0.1:8123/$1 [P,L]' "$VHOST_FILE"
fi

sudo a2enmod proxy proxy_http proxy_wstunnel rewrite >/dev/null

if ! sudo apache2ctl configtest 2>&1; then
  sudo cp "$BACKUP_FILE" "$VHOST_FILE"
  err "Apache config viga - taastasin varukoopia automaatselt. Gladys jäi puutumata. Saada mulle viga, et parandaks."
fi

sudo systemctl restart apache2
ok "Apache suunatud Home Assistant'ile (mrnux.ee -> 8123)"

# ── 3. Gladys'e peatamine (ei kustuta, taastatav) ────────────────────────────
if docker ps --format '{{.Names}}' | grep -q '^kyami-security$'; then
  info "Peatan Gladys'e (andmed/pilt jäävad alles, taastatav)..."
  docker compose -f docker/docker-compose.local.yml down
  ok "Gladys peatatud"
else
  ok "Gladys ei tööta juba"
fi

# ── Kokkuvõte ──────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────"
ok "Üleminek valmis! https://mrnux.ee näitab nüüd Home Assistant'i."
echo ""
echo -e "  Kui midagi valesti läks, taasta Gladys nii:"
echo -e "    ${Y}sudo cp $BACKUP_FILE $VHOST_FILE && sudo systemctl restart apache2${N}"
echo -e "    ${Y}cd $CURRENT_DIR && docker compose -f docker/docker-compose.local.yml up -d${N}"
echo ""
