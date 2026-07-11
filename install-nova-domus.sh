#!/bin/bash
set -e

# ── Värvid ──────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}✓ $*${N}"; }
info() { echo -e "${Y}→ $*${N}"; }
err()  { echo -e "${R}✗ $*${N}"; exit 1; }

echo ""
echo "  Nova Domus (ha-fusion) — paigaldaja"
echo "────────────────────────────────────────────────────"

CURRENT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CURRENT_DIR"

if ! docker compose version &>/dev/null; then
  err "Docker Compose plugin puudub. Paigalda: sudo apt install docker-compose-plugin"
fi
ok "Docker Compose OK"

mkdir -p "$CURRENT_DIR/nova-domus-data"
ok "Andmekaust olemas: $CURRENT_DIR/nova-domus-data"

info "Käivitan Nova Domus konteinerit (host võrgurežiim, port 5050)..."
docker compose -f docker/docker-compose.nova-domus.yml up -d
ok "Nova Domus käivitatud"

LOCAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "────────────────────────────────────────────────────"
ok "Paigaldus valmis!"
echo ""
echo -e "  Testi kohe:"
echo -e "    ${G}http://${LOCAL_IP}:5050${N}"
echo ""
echo -e "  Esimesel avamisel võib küsida Home Assistant'iga ühendumist/sisselogimist -"
echo -e "  järgi ekraanil olevaid juhiseid."
echo ""
echo -e "  Teenuse haldus:"
echo -e "    Peata:   ${Y}docker compose -f docker/docker-compose.nova-domus.yml down${N}"
echo -e "    Logid:   ${Y}docker compose -f docker/docker-compose.nova-domus.yml logs -f${N}"
echo ""
