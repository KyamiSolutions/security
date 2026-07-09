#!/bin/bash
set -e

# ── Värvid ──────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}✓ $*${N}"; }
info() { echo -e "${Y}→ $*${N}"; }
err()  { echo -e "${R}✗ $*${N}"; exit 1; }

echo ""
echo "  Home Assistant — paigaldaja (jookseb Gladys'e kõrval)"
echo "────────────────────────────────────────────────────"

CURRENT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CURRENT_DIR"

if ! command -v docker &>/dev/null; then
  err "Docker ei ole paigaldatud. Käivita esmalt ./install.sh (Gladys'e paigaldaja), see paigaldab Docker'i ka."
fi
if ! docker compose version &>/dev/null; then
  err "Docker Compose plugin puudub. Paigalda: sudo apt install docker-compose-plugin"
fi
ok "Docker Compose OK"

mkdir -p "$CURRENT_DIR/homeassistant-config"
ok "Config kaust olemas: $CURRENT_DIR/homeassistant-config"

info "Käivitan Home Assistant konteineri (host võrgurežiim, port 8123)..."
docker compose -f docker/docker-compose.homeassistant.yml up -d
ok "Home Assistant käivitatud"

LOCAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "────────────────────────────────────────────────────"
ok "Paigaldus valmis!"
echo ""
echo -e "  Testi kohe (enne domeeni/Apache seadistust):"
echo -e "    ${G}http://${LOCAL_IP}:8123${N}"
echo ""
echo -e "  Järgmised sammud domeeniga (ha.mrnux.ee) kasutamiseks:"
echo -e "    1. Lisa DNS A-kirje: ha.mrnux.ee -> selle serveri avalik IP"
echo -e "    2. Kopeeri docker/apache-ha.conf.example -> /etc/apache2/sites-available/ha.mrnux.ee.conf"
echo -e "       ja kohanda vajadusel"
echo -e "    3. sudo a2enmod proxy proxy_http proxy_wstunnel rewrite"
echo -e "    4. sudo a2ensite ha.mrnux.ee.conf && sudo systemctl reload apache2"
echo -e "    5. sudo certbot --apache -d ha.mrnux.ee"
echo ""
echo -e "  Teenuse haldus:"
echo -e "    Peata:   ${Y}docker compose -f docker/docker-compose.homeassistant.yml down${N}"
echo -e "    Käivita: ${Y}docker compose -f docker/docker-compose.homeassistant.yml up -d${N}"
echo -e "    Logid:   ${Y}docker compose -f docker/docker-compose.homeassistant.yml logs -f${N}"
echo ""
