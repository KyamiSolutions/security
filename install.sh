#!/bin/bash
set -e

# ── Värvid ──────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}✓ $*${N}"; }
info() { echo -e "${Y}→ $*${N}"; }
err()  { echo -e "${R}✗ $*${N}"; exit 1; }

echo ""
echo "  KyamiSecurity (Gladys Assistant fork) — paigaldaja"
echo "────────────────────────────────────────────────────"

CURRENT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CURRENT_DIR"

# ── Docker ────────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  info "Docker ei ole paigaldatud, paigaldan..."
  curl -fsSL https://get.docker.com | sh
  ok "Docker paigaldatud"
else
  ok "Docker on juba paigaldatud"
fi

if ! docker compose version &>/dev/null; then
  err "Docker Compose plugin puudub. Paigalda: sudo apt install docker-compose-plugin"
fi
ok "Docker Compose OK"

# ── Node (front build jaoks) ──────────────────────────────────────────────────
info "Kontrollin Node.js 22.x..."
if ! command -v node &>/dev/null || ! node -e "process.exit(process.versions.node.split('.')[0] >= 22 ? 0 : 1)"; then
  err "Vaja Node.js 22.x front'i ehitamiseks. Paigalda: https://nodejs.org/ või nvm"
fi
ok "Node.js OK"

# ── Front build ───────────────────────────────────────────────────────────────
info "Paigaldan front'i sõltuvused ja ehitan kasutajaliidese..."
(cd front && npm ci && npm run build)
rm -rf static
cp -r front/build static
ok "Front ehitatud (static/)"

# ── .env ──────────────────────────────────────────────────────────────────────
ENV_FILE="$CURRENT_DIR/docker/.env"
if [ ! -f "$ENV_FILE" ]; then
  info "Loon .env faili..."
  cat > "$ENV_FILE" <<EOF
TZ=Europe/Tallinn
EOF
  ok ".env loodud ($ENV_FILE)"
else
  ok ".env on juba olemas"
fi

# ── Docker image ehitus ───────────────────────────────────────────────────────
info "Ehitan Docker image'i (see võib mõne minuti aega võtta)..."
docker build -f docker/Dockerfile.buildx -t kyami-security:latest .
ok "Docker image ehitatud: kyami-security:latest"

# ── docker-compose.yml kohandamine ────────────────────────────────────────────
COMPOSE_FILE="$CURRENT_DIR/docker/docker-compose.local.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
  info "Loon kohandatud docker-compose faili (kasutab kohalikku image'it)..."
  sed 's|image: gladysassistant/gladys:v4|image: kyami-security:latest|; s|container_name: gladys|container_name: kyami-security|' \
    docker/docker-compose.yml > "$COMPOSE_FILE"
  ok "Loodud: $COMPOSE_FILE"
else
  ok "$COMPOSE_FILE on juba olemas, ei kirjuta üle (su muudatused SERVER_PORT/DISCORD_WEBHOOK_URL jm kohta jäävad alles)"
fi

# ── Käivitamine ────────────────────────────────────────────────────────────────
info "Käivitan konteinerid..."
docker compose -f "$COMPOSE_FILE" up -d
ok "Teenus käivitatud"

# ── Tailscale (kaugpääs) ─────────────────────────────────────────────────────
echo ""
echo -e "  ${Y}Kas soovid kaugpääsu (vaata süsteemi ka kodust väljaspool)?${N}"
read -r -p "  Paigalda Tailscale? [j/e]: " TAIL
if [[ "$TAIL" =~ ^[jJ]$ ]]; then
  if command -v tailscale &>/dev/null; then
    ok "Tailscale on juba paigaldatud"
  else
    info "Paigaldan Tailscale'i..."
    curl -fsSL https://tailscale.com/install.sh | sh
    ok "Tailscale paigaldatud"
  fi
  info "Käivitan Tailscale'i (brauser avaneb autentimiseks)..."
  sudo tailscale up
  TAIL_IP=$(tailscale ip -4 2>/dev/null || echo "")
  if [ -n "$TAIL_IP" ]; then
    ok "Tailscale IP: $TAIL_IP"
  fi
else
  TAIL_IP=""
fi

# ── Kokkuvõte ──────────────────────────────────────────────────────────────────
LOCAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "────────────────────────────────────────────────────"
ok "Paigaldus valmis!"
echo ""
echo -e "  Koduvõrgus:   ${G}http://${LOCAL_IP}${N}"
if [ -n "$TAIL_IP" ]; then
echo -e "  Kõikjalt:     ${G}http://${TAIL_IP}${N}"
echo -e "  ${Y}(Tailscale peab olema paigaldatud ka vaataja seadmes: tailscale.com/download)${N}"
fi
echo ""
echo -e "  Teenuse haldus:"
echo -e "    Peata:   ${Y}docker compose -f docker/docker-compose.local.yml down${N}"
echo -e "    Käivita: ${Y}docker compose -f docker/docker-compose.local.yml up -d${N}"
echo -e "    Logid:   ${Y}docker compose -f docker/docker-compose.local.yml logs -f${N}"
echo ""
echo -e "  Kaamera/liikumistuvastuse API asub teenuse all: ${Y}/api/v1/service/kyami-motion/*${N}"
echo -e "  (esmalt logi Gladys'i veebiliideses admin-kasutajaga sisse, seejärel proovi:"
echo -e "   GET /api/v1/service/kyami-motion/probe?ip=<kaamera-ip>&user=admin&password=...)"
echo ""
