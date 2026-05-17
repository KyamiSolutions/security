# Nutikodu – Claude Code kontekst

## Projekti ülevaade
Koduturvakaamera süsteem FastAPI + MySQL + Cloudflare Tunnel.
Server: ASUS VivoBook (`mrnux@mrnux-VivoBook-ASUSLaptop-X512DA-X512DA`).
Avalik URL: **https://mrnux.ee** (Cloudflare Tunnel kaudu).

## Git
- Branch: `claude/vaata-k8d0S`
- Remote: `https://github.com/kyamisolutions/security`
- Serveril: `~/security/`, venv: `~/security/venv/`

## Disain – KOHUSTUSLIK SÄILITADA

**Split-layout login leht** — see on õige ja kinnitatud kujundus, MITTE kunagi asendada teisega:
- Vasak pool (`.l-left`): tume gradient (`#1a1033` → `#2d1b69` → `#1e3a5f`), valge tekst, logo, feature list
- Parem pool (`.l-right`): valge taust, sisselogimise vorm
- Mobiilis (max-width 700px): ainult parem pool (valge) nähtav
- Nupud: `#4f46e5` (indigo), border-radius 10px
- Fondid: `Inter`, `system-ui`

**Dashboard** — tume sidebar vasakul, sisu paremal. Värvipalett:
- `--primary: #4f46e5`
- `--bg: #f8f8fb`
- `--sidebar: #1e1b4b`
- `--card: #ffffff`

Kui uus sessioon tahab disaini muuta — EI. Kasuta olemasolevat `templates/index.html`.

## Tehniline stack
- **Backend**: FastAPI (Python 3.12), uvicorn port 8080
- **DB**: MySQL, kasutaja `nutikodu`, db `nutikodu`
- **Auth**: session cookie (`httponly`, `samesite=lax`), PBKDF2-SHA256 salasõna hash
- **2FA**: pyotp TOTP, QR kood PNG base64-na (`qrcode[pil]` + `Pillow`)
- **Kaamera**: OpenCV MJPEG stream, HLS (ffmpeg VAAPI)
- **Tunnel**: cloudflared systemd service, config `/etc/cloudflared/config.yml`
- **Tunnel ID**: `243b9c43-90b8-4d1a-927e-dc20b366769a`

## Systemd teenused serveril
```
sudo systemctl status nutikodu       # app port 8080
sudo systemctl status cloudflared    # tunnel mrnux.ee -> localhost:8080
```
Mõlemad on `enabled` (käivituvad automaatselt taaskäivitusel).

## Vajalikud pip paketid (venv)
```
fastapi uvicorn python-dotenv mysql-connector-python
opencv-python-headless pyotp qrcode[pil] Pillow
python-multipart
```

## 2FA voog (õige implementatsioon)
1. `POST /users/me/2fa/enable` → tagastab `{secret, uri, qr_png}` (PNG base64)
2. Kasutaja skannib QR → sisestab koodi
3. `POST /users/me/2fa/verify` (form: `code`) → kinnitab et kood on õige
4. `POST /users/me/2fa/disable` → keelab 2FA

## Cloudflare seaded
- SSL/TLS: **Flexible** (origin on HTTP, Cloudflare lisab HTTPS)
- Always Use HTTPS: sisse lülitatud
- Nameservers: `jen.ns.cloudflare.com`, `nolan.ns.cloudflare.com` (elkdata'is)

## Serveri git update käsk
```bash
cd ~/security && git fetch origin claude/vaata-k8d0S && git reset --hard origin/claude/vaata-k8d0S && sudo systemctl restart nutikodu
```
