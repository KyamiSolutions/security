#!/bin/bash
set -e

# ── Värvid ──────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}✓ $*${N}"; }
info() { echo -e "${Y}→ $*${N}"; }
err()  { echo -e "${R}✗ $*${N}"; exit 1; }

echo ""
echo "  Frigate (AI liikumis-/objektituvastus) — paigaldaja"
echo "────────────────────────────────────────────────────"

CURRENT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CURRENT_DIR"

if ! docker compose version &>/dev/null; then
  err "Docker Compose plugin puudub. Paigalda: sudo apt install docker-compose-plugin"
fi
ok "Docker Compose OK"

# ── Mosquitto (MQTT) config ──────────────────────────────────────────────────
mkdir -p "$CURRENT_DIR/mosquitto-config" "$CURRENT_DIR/mosquitto-data"
if [ ! -f "$CURRENT_DIR/mosquitto-config/mosquitto.conf" ]; then
  cp "$CURRENT_DIR/docker/mosquitto.conf.template" "$CURRENT_DIR/mosquitto-config/mosquitto.conf"
  ok "Mosquitto config loodud"
else
  ok "Mosquitto config on juba olemas, ei kirjuta üle"
fi

# ── Frigate config ────────────────────────────────────────────────────────────
mkdir -p "$CURRENT_DIR/frigate-config" "$CURRENT_DIR/frigate-media"
if [ ! -f "$CURRENT_DIR/frigate-config/config.yml" ]; then
  cp "$CURRENT_DIR/docker/frigate-config.yml.template" "$CURRENT_DIR/frigate-config/config.yml"
  ok "Frigate config loodud ($CURRENT_DIR/frigate-config/config.yml)"
  echo -e "  ${Y}Vaata see fail üle - kaamera IP/tee on eeldatud, muuda vajadusel.${N}"
else
  ok "Frigate config on juba olemas, ei kirjuta üle"
fi

# ── Kaamera kasutajanimi/parool (frigate.env) ─────────────────────────────────
ENV_FILE="$CURRENT_DIR/docker/frigate.env"
if [ ! -f "$ENV_FILE" ]; then
  echo ""
  echo -e "  ${Y}Kaamera autentimine (salvestatakse ainult sellesse serverisse, ei lähe gitti)${N}"
  read -r -p "  Kaamera kasutajanimi [admin]: " CAM_USER
  CAM_USER="${CAM_USER:-admin}"
  read -r -s -p "  Kaamera parool: " CAM_PASS
  echo ""
  cat > "$ENV_FILE" <<EOF
FRIGATE_RTSP_USER=$CAM_USER
FRIGATE_RTSP_PASSWORD=$CAM_PASS
EOF
  chmod 600 "$ENV_FILE"
  ok "frigate.env loodud"
else
  ok "frigate.env on juba olemas, ei küsi uuesti"
fi

# ── Käivitamine ────────────────────────────────────────────────────────────────
info "Käivitan Mosquitto ja Frigate konteinerid..."
docker compose -f docker/docker-compose.frigate.yml up -d
ok "Käivitatud"

LOCAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "────────────────────────────────────────────────────"
ok "Paigaldus valmis!"
echo ""
echo -e "  Frigate liides (testi kohe, enne HA integreerimist):"
echo -e "    ${G}http://${LOCAL_IP}:5000${N}"
echo ""
echo -e "  Kui kaamerapilt seal töötab, mine Home Assistant'is:"
echo -e "    Settings → Devices & Services → Add Integration → otsi \"Frigate\""
echo -e "    (kui otsingus ei leia, tuleb kõigepealt HACS paigaldada - anna märku)"
echo ""
echo -e "  Teenuse haldus:"
echo -e "    Peata:   ${Y}docker compose -f docker/docker-compose.frigate.yml down${N}"
echo -e "    Logid:   ${Y}docker compose -f docker/docker-compose.frigate.yml logs -f frigate${N}"
echo ""
