#!/bin/bash
set -e

# ── Värvid ──────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}✓ $*${N}"; }
info() { echo -e "${Y}→ $*${N}"; }
err()  { echo -e "${R}✗ $*${N}"; exit 1; }

echo ""
echo "  Music Assistant — paigaldaja"
echo "────────────────────────────────────────────────────"

CURRENT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CURRENT_DIR"

if ! docker compose version &>/dev/null; then
  err "Docker Compose plugin puudub. Paigalda: sudo apt install docker-compose-plugin"
fi
ok "Docker Compose OK"

mkdir -p "$CURRENT_DIR/music-assistant-data"
ok "Andmekaust olemas: $CURRENT_DIR/music-assistant-data"

info "Käivitan Music Assistant konteinerit (host võrgurežiim, port 8095)..."
docker compose -f docker/docker-compose.music-assistant.yml up -d
ok "Music Assistant käivitatud"

LOCAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "────────────────────────────────────────────────────"
ok "Paigaldus valmis!"
echo ""
echo -e "  Testi kohe (Music Assistant enda veebiliides):"
echo -e "    ${G}http://${LOCAL_IP}:8095${N}"
echo ""
echo -e "  Home Assistant'is lisamiseks:"
echo -e "    Settings → Devices & Services → Add Integration → \"Music Assistant\""
echo -e "    URL: ${Y}http://localhost:8095${N} (MITTE mrnux.ee domeen)"
echo ""
echo -e "  Teenuse haldus:"
echo -e "    Peata:   ${Y}docker compose -f docker/docker-compose.music-assistant.yml down${N}"
echo -e "    Logid:   ${Y}docker compose -f docker/docker-compose.music-assistant.yml logs -f${N}"
echo ""
