#!/bin/bash
set -e

# ── Värvid ──────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}✓ $*${N}"; }
info() { echo -e "${Y}→ $*${N}"; }
err()  { echo -e "${R}✗ $*${N}"; exit 1; }

echo ""
echo "  Kaamera kaughaldus — paigaldaja"
echo "────────────────────────────────────"

# ── Python ──────────────────────────────────────────────────────────────────
info "Kontrollin Python 3.10+..."
python3 -c "import sys; assert sys.version_info >= (3,10)" 2>/dev/null \
  || err "Vaja Python 3.10 või uuemat. Käivita: sudo apt install python3"
ok "Python OK"

# ── Sõltuvused ───────────────────────────────────────────────────────────────
INSTALL_DIR="$HOME/kaamera"
info "Paigaldan kausta: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR/"
cd "$INSTALL_DIR"

info "Paigaldan Python-paketid..."
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
ok "Paketid paigaldatud"

# ── API võti ─────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  info "Loon .env faili..."
  RANDOM_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
  cat > .env <<EOF
CAMERA_API_KEY=$RANDOM_KEY
HOST=0.0.0.0
PORT=8080
EOF
  echo ""
  echo -e "  ${Y}Sinu API võti on:${N}"
  echo -e "  ${G}$RANDOM_KEY${N}"
  echo -e "  ${Y}(salvestatud ka faili: $INSTALL_DIR/.env)${N}"
  echo ""
else
  ok ".env on juba olemas"
fi

# ── systemd teenus ───────────────────────────────────────────────────────────
info "Seadistan automaatse käivituse (systemd)..."
SERVICE_FILE="$HOME/.config/systemd/user/kaamera.service"
mkdir -p "$(dirname "$SERVICE_FILE")"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Kaamera kaughaldus
After=network.target

[Service]
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/.venv/bin/python main.py
EnvironmentFile=$INSTALL_DIR/.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable kaamera
systemctl --user start kaamera
ok "Teenus käivitatud"

# ── Kohalik IP ───────────────────────────────────────────────────────────────
LOCAL_IP=$(hostname -I | awk '{print $1}')
PORT=$(grep PORT "$INSTALL_DIR/.env" | cut -d= -f2 || echo 8080)

echo ""
echo "────────────────────────────────────"
ok "Paigaldus valmis!"
echo ""
echo -e "  Ava brauseris: ${G}http://${LOCAL_IP}:${PORT}${N}"
echo ""
echo -e "  Teenuse haldus:"
echo -e "    Peata:   ${Y}systemctl --user stop kaamera${N}"
echo -e "    Käivita: ${Y}systemctl --user start kaamera${N}"
echo -e "    Logid:   ${Y}journalctl --user -u kaamera -f${N}"
echo ""
