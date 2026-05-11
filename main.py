import asyncio
import os
import shutil
import subprocess
import time as _time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import Depends, FastAPI, Form, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from auth import (login as auth_login, logout as auth_logout, verify_session,
                  get_username, list_users, add_user, delete_user, change_password,
                  init_db, verify_2fa, enable_2fa, disable_2fa, get_2fa_status, get_user_role,
                  verify_totp_code, confirm_2fa)
from camera import Camera, _tcp_reachable, mjpeg_generator, probe_rtsp
from devices import add_device, list_devices, remove_device, toggle_device
import settings as _settings
from motion import MotionDetector, list_recordings, RECORDINGS_DIR, send_discord, start_retention_loop
from hls_stream import HLSStream, HLS_DIR
import hosting

cameras: dict[str | int, Camera] = {}
detectors: dict[str | int, MotionDetector] = {}
hls_stream: HLSStream | None = None

_cpu_sample: tuple[float, float] | None = None  # (idle, total) viimasest /proc/stat lugemisest


def _read_uptime_seconds() -> int:
    try:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    except OSError:
        return 0


def _read_meminfo() -> dict:
    try:
        with open("/proc/meminfo") as f:
            data = {}
            for line in f:
                key, _, rest = line.partition(":")
                rest = rest.strip().split()
                if rest:
                    data[key] = int(rest[0]) * 1024  # kB → B
            total = data.get("MemTotal", 0)
            avail = data.get("MemAvailable", data.get("MemFree", 0))
            return {"total": total, "used": total - avail, "available": avail}
    except OSError:
        return {"total": 0, "used": 0, "available": 0}


def _read_cpu_percent() -> float:
    """Tagastab CPU kasutuse % alates eelmisest kutsest. Esimene kutse on 0."""
    global _cpu_sample
    try:
        with open("/proc/stat") as f:
            line = f.readline()
        parts = [int(x) for x in line.split()[1:]]
        idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
        total = sum(parts)
        prev = _cpu_sample
        _cpu_sample = (idle, total)
        if prev is None:
            return 0.0
        d_idle = idle - prev[0]
        d_total = total - prev[1]
        if d_total <= 0:
            return 0.0
        return max(0.0, min(100.0, (1 - d_idle / d_total) * 100))
    except OSError:
        return 0.0


def _service_active(name: str) -> bool:
    try:
        r = subprocess.run(
            ["systemctl", "is-active", "--quiet", name],
            timeout=3,
        )
        return r.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _default_source() -> str | int | None:
    url = os.environ.get("CAMERA_URL", "")
    if url:
        return url
    idx = os.environ.get("CAMERA_INDEX", "")
    if idx:
        return int(idx)
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global hls_stream
    init_db()
    start_retention_loop()
    source = _default_source()
    if source is not None:
        try:
            cam = await asyncio.to_thread(Camera, source)
            cameras[source] = cam
            det = MotionDetector(cam)
            det.start()
            detectors[source] = det
            print(f"Kaamera avatud ja liikumistuvastus käivitatud: {source}")
        except RuntimeError as e:
            print(f"Hoiatus: {e}")
        if isinstance(source, str) and source.startswith("rtsp://"):
            hls_stream = HLSStream(source)
            hls_stream.start()
            print("HLS stream käivitatud (VAAPI)")
    yield
    if hls_stream:
        hls_stream.stop()
    for det in detectors.values():
        det.stop()
    for cam in cameras.values():
        cam.release()


app = FastAPI(title="KyamiSecurity", lifespan=lifespan)

_static = Path(__file__).parent / "static"
if _static.exists():
    app.mount("/static", StaticFiles(directory=str(_static)), name="static")


def _cam(key: str) -> Camera:
    k: str | int = int(key) if key.isdigit() else key
    if k not in cameras:
        try:
            cam = Camera(k)
            cameras[k] = cam
            det = MotionDetector(cam)
            det.start()
            detectors[k] = det
        except RuntimeError:
            raise HTTPException(404, f"Kaamera pole saadaval: {key}")
    return cameras[k]


# ── HTML ─────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def index():
    with open("templates/index.html", encoding="utf-8") as f:
        return f.read()

_PUBLIC_PAGES = {"smart-login", "smart-signup", "smart-forgot-password", "smart-onboarding", "smart-splash"}

@app.get("/{page}.html", response_class=HTMLResponse, include_in_schema=False)
def serve_html(page: str, request: Request):
    from fastapi.responses import RedirectResponse
    if page not in _PUBLIC_PAGES:
        try:
            verify_session(request)
        except HTTPException:
            return RedirectResponse(url="/smart-login.html")
    path = Path("templates") / f"{page}.html"
    if not path.exists():
        return RedirectResponse(url="/")
    return path.read_text(encoding="utf-8")


def require_admin(token: str = Depends(verify_session)):
    if get_user_role(token) != "admin":
        raise HTTPException(403, "Ainult adminile lubatud")
    return token


# ── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/login")
def login(username: str = Form(...), password: str = Form(...)):
    result = auth_login(username, password)
    if result["requires_2fa"]:
        return JSONResponse({"ok": True, "requires_2fa": True, "temp_token": result["temp_token"]})
    cam_key = ""
    src = _default_source()
    if src is not None:
        cam_key = str(src)
    resp = JSONResponse({"ok": True, "requires_2fa": False, "cam_key": cam_key})
    resp.set_cookie("session", result["token"], httponly=True, samesite="lax", max_age=86400)
    return resp


@app.post("/login/2fa")
def login_2fa(temp_token: str = Form(...), code: str = Form(...)):
    token = verify_2fa(temp_token, code)
    cam_key = ""
    src = _default_source()
    if src is not None:
        cam_key = str(src)
    resp = JSONResponse({"ok": True, "cam_key": cam_key})
    resp.set_cookie("session", token, httponly=True, samesite="lax", max_age=86400)
    return resp


@app.post("/logout")
def logout(token: str = Depends(verify_session)):
    auth_logout(token)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("session")
    return resp


# ── 2FA ──────────────────────────────────────────────────────────────────────

@app.get("/users/me")
def get_me(token: str = Depends(verify_session)):
    return {"username": get_username(token), "role": get_user_role(token)}


@app.get("/users/me/2fa")
def get_my_2fa(token: str = Depends(verify_session)):
    username = get_username(token)
    return {"enabled": get_2fa_status(username)}


@app.post("/users/me/2fa/enable")
def my_2fa_enable(token: str = Depends(verify_session)):
    username = get_username(token)
    return enable_2fa(username)


@app.post("/users/me/2fa/disable")
def my_2fa_disable(token: str = Depends(verify_session)):
    username = get_username(token)
    disable_2fa(username)
    return {"ok": True}


@app.post("/users/me/2fa/verify")
def my_2fa_verify(code: str = Form(...), token: str = Depends(verify_session)):
    username = get_username(token)
    if not confirm_2fa(username, code):
        raise HTTPException(400, "Vale kood")
    return {"ok": True}


# ── HLS ──────────────────────────────────────────────────────────────────────

@app.get("/hls/stream.m3u8")
def hls_manifest(_: str = Depends(verify_session)):
    if not hls_stream or not hls_stream.ready():
        raise HTTPException(503, "HLS stream pole veel valmis")
    return FileResponse(str(hls_stream.m3u8), media_type="application/vnd.apple.mpegurl",
                        headers={"Cache-Control": "no-cache"})


@app.get("/hls/dvr.m3u8")
def hls_dvr_manifest(_: str = Depends(verify_session)):
    if not hls_stream:
        raise HTTPException(503, "HLS pole aktiivne")
    ts_files = sorted(
        (f for f in HLS_DIR.iterdir() if f.suffix == ".ts"),
        key=lambda p: p.stat().st_mtime,
    )
    if not ts_files:
        raise HTTPException(503, "DVR segmendid puuduvad")
    target_dur = 2
    try:
        for line in hls_stream.m3u8.read_text().splitlines():
            if line.startswith("#EXT-X-TARGETDURATION:"):
                target_dur = int(line.split(":")[1])
                break
    except Exception:
        pass
    lines = [
        "#EXTM3U", "#EXT-X-VERSION:3",
        f"#EXT-X-TARGETDURATION:{target_dur}",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        "#EXT-X-MEDIA-SEQUENCE:0",
    ]
    for ts in ts_files:
        lines.append(f"#EXTINF:{float(target_dur):.6f},")
        lines.append(f"/hls/{ts.name}")
    lines.append("#EXT-X-ENDLIST")
    return Response(
        "\n".join(lines) + "\n",
        media_type="application/vnd.apple.mpegurl",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/hls/{filename}")
def hls_segment(filename: str, _: str = Depends(verify_session)):
    path = HLS_DIR / filename
    if not path.exists() or path.suffix not in (".ts", ".m3u8"):
        raise HTTPException(404, "Segment ei leitud")
    media_type = "video/MP2T" if filename.endswith(".ts") else "application/vnd.apple.mpegurl"
    return FileResponse(str(path), media_type=media_type,
                        headers={"Cache-Control": "no-cache"})


@app.get("/hls-status")
def hls_status(_: str = Depends(verify_session)):
    return {"ready": bool(hls_stream and hls_stream.ready())}


# ── Camera ───────────────────────────────────────────────────────────────────

@app.get("/stream")
def stream(key: str = Query(...), _: str = Depends(verify_session)):
    cam = _cam(key)
    return StreamingResponse(
        mjpeg_generator(cam),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/snapshot")
def snapshot(key: str = Query(...), _: str = Depends(verify_session)):
    cam = _cam(key)
    frame = cam.snapshot()
    if frame is None:
        raise HTTPException(503, "Kaader pole saadaval")
    return Response(content=frame, media_type="image/jpeg")


@app.get("/probe")
async def probe(
    ip: str = Query(...),
    user: str = Query("admin"),
    password: str = Query("admin"),
    port: int = Query(554),
    _: str = Depends(verify_session),
):
    reachable = await asyncio.to_thread(_tcp_reachable, ip, port)
    if not reachable:
        raise HTTPException(503, f"Port {port} suletud aadressil {ip}")
    url = await asyncio.to_thread(probe_rtsp, ip, user, password, port)
    if not url:
        raise HTTPException(404, "RTSP rada ei leitud")
    if url not in cameras:
        cam = await asyncio.to_thread(Camera, url)
        cameras[url] = cam
        det = MotionDetector(cam)
        det.start()
        detectors[url] = det
    safe = url.replace(f":{password}@", ":***@")
    return {"url": safe, "internal_key": url}


# ── Recordings ───────────────────────────────────────────────────────────────

@app.get("/recordings")
def recordings(_: str = Depends(verify_session)):
    return list_recordings()


@app.get("/recordings/{filename}")
def download_recording(filename: str, _: str = Depends(verify_session)):
    path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Fail ei leitud")
    return FileResponse(path, media_type="video/mp4", filename=filename)


_THUMBS_DIR = os.path.join(RECORDINGS_DIR, ".thumbs")


@app.get("/recordings/{filename}/thumb")
def recording_thumb(filename: str, _: str = Depends(verify_session)):
    if not filename.endswith(".mp4") or "/" in filename or ".." in filename:
        raise HTTPException(400, "Vigane failinimi")
    src = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(src):
        raise HTTPException(404, "Fail ei leitud")
    os.makedirs(_THUMBS_DIR, exist_ok=True)
    thumb = os.path.join(_THUMBS_DIR, filename[:-4] + ".jpg")
    if not os.path.isfile(thumb) or os.path.getmtime(thumb) < os.path.getmtime(src):
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-ss", "1", "-i", src,
                 "-frames:v", "1", "-vf", "scale=320:-1", "-q:v", "5", thumb],
                capture_output=True, timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise HTTPException(500, "Thumbnail genereerimine ebaõnnestus")
    if not os.path.isfile(thumb):
        raise HTTPException(500, "Thumbnail puudub")
    return FileResponse(thumb, media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=86400"})


@app.delete("/recordings/{filename}")
def delete_recording(filename: str, _: str = Depends(require_admin)):
    path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Fail ei leitud")
    os.remove(path)
    return {"ok": True}


# ── Devices ──────────────────────────────────────────────────────────────────

@app.get("/devices")
def get_devices(_: str = Depends(verify_session)):
    return list_devices()


@app.post("/devices")
def create_device(
    name: str = Form(...),
    kind: str = Form(...),
    ip: str = Form(...),
    port: int = Form(80),
    _: str = Depends(require_admin),
):
    return add_device(name, kind, ip, port)


@app.delete("/devices/{device_id}")
def delete_device(device_id: str, _: str = Depends(require_admin)):
    remove_device(device_id)
    return {"ok": True}


@app.post("/devices/{device_id}/toggle")
async def toggle(device_id: str, _: str = Depends(verify_session)):
    return await toggle_device(device_id)


# ── Users ────────────────────────────────────────────────────────────────────

@app.get("/users")
def get_users(_: str = Depends(require_admin)):
    return list_users()


@app.post("/users")
def create_user(
    username: str = Form(...),
    password: str = Form(...),
    role: str = Form("user"),
    _: str = Depends(require_admin),
):
    add_user(username, password, role)
    return {"ok": True}


@app.delete("/users/{username}")
def remove_user(username: str, token: str = Depends(require_admin)):
    current = get_username(token)
    delete_user(username, current)
    return {"ok": True}


@app.post("/users/{username}/password")
def update_password(
    username: str,
    password: str = Form(...),
    token: str = Depends(verify_session),
):
    current = get_username(token)
    # Kasutaja saab muuta ainult oma parooli; admin saab kõiki
    users = list_users()
    current_role = next((u["role"] for u in users if u["username"] == current), "user")
    if current != username and current_role != "admin":
        raise HTTPException(403, "Pole lubatud")
    change_password(username, password)
    return {"ok": True}


# ── Settings ─────────────────────────────────────────────────────────────────

@app.get("/settings")
def get_settings(_: str = Depends(require_admin)):
    return _settings.load()


@app.post("/settings")
async def update_settings(request: Request, _: str = Depends(require_admin)):
    data = await request.json()
    _settings.save(data)
    new_url = data.get("camera_url", "")
    if new_url and new_url not in cameras:
        try:
            cam = await asyncio.to_thread(Camera, new_url)
            cameras[new_url] = cam
            det = MotionDetector(cam)
            det.start()
            detectors[new_url] = det
        except Exception as e:
            print(f"Hoiatus: kaamera lisamine ebaõnnestus ({new_url}): {e}")
    return {"ok": True}


@app.post("/settings/test-discord")
def settings_test_discord(_: str = Depends(require_admin)):
    cfg = _settings.load()
    url = cfg.get("discord_webhook_url", "")
    ok, msg = send_discord(
        url,
        "✅ Test teade",
        "See on testteade Nutikodu seadete lehelt — kui näed seda, siis Discord webhook töötab.",
    )
    return {"ok": ok, "message": msg}


@app.get("/motion-status")
def motion_status(_: str = Depends(verify_session)):
    return {
        "active_detectors": [str(k) for k in detectors.keys()],
        "active_cameras": [str(k) for k in cameras.keys()],
        "hls_running": bool(hls_stream and hls_stream.ready()),
    }


@app.get("/stats")
def get_stats(_: str = Depends(verify_session)):
    recs = list_recordings()
    now = datetime.now()
    today_start = datetime(now.year, now.month, now.day)

    by_day = []
    for offset in range(6, -1, -1):
        day = today_start - timedelta(days=offset)
        day_end = day + timedelta(days=1)
        count = sum(1 for r in recs if day.timestamp() <= r["mtime"] < day_end.timestamp())
        by_day.append({
            "date": day.strftime("%Y-%m-%d"),
            "label": day.strftime("%a") if offset > 0 else "Täna",
            "count": count,
        })

    by_hour = [{"hour": h, "count": 0} for h in range(24)]
    today_recs = [r for r in recs if r["mtime"] >= today_start.timestamp()]
    for r in today_recs:
        hour = datetime.fromtimestamp(r["mtime"]).hour
        by_hour[hour]["count"] += 1

    peak_hour = max(by_hour, key=lambda x: x["count"]) if any(h["count"] for h in by_hour) else None

    total_size = sum(r["size"] for r in recs)
    try:
        usage = shutil.disk_usage(RECORDINGS_DIR if os.path.isdir(RECORDINGS_DIR) else ".")
        disk_total = usage.total
        disk_free = usage.free
    except OSError:
        disk_total = 0
        disk_free = 0

    today_count = len(today_recs)
    yesterday_start = today_start - timedelta(days=1)
    yesterday_count = sum(
        1 for r in recs
        if yesterday_start.timestamp() <= r["mtime"] < today_start.timestamp()
    )

    mem = _read_meminfo()
    cpu_pct = _read_cpu_percent()
    uptime_sec = _read_uptime_seconds()

    health = {
        "camera": bool(cameras),
        "motion": any(d._running for d in detectors.values()) if detectors else False,
        "hls": bool(hls_stream and hls_stream.ready()),
        "hls_mode": hls_stream.mode if hls_stream else None,
        "hls_error": hls_stream.last_error if hls_stream and not hls_stream.ready() else "",
        "tunnel": _service_active("cloudflared"),
    }

    return {
        "by_day": by_day,
        "by_hour": by_hour,
        "today_count": today_count,
        "yesterday_count": yesterday_count,
        "peak_hour": peak_hour,
        "total_recordings": len(recs),
        "recordings_size_bytes": total_size,
        "disk_total_bytes": disk_total,
        "disk_free_bytes": disk_free,
        "system": {
            "uptime_seconds": uptime_sec,
            "cpu_percent": round(cpu_pct, 1),
            "ram_total_bytes": mem["total"],
            "ram_used_bytes": mem["used"],
        },
        "health": health,
    }


# ── Hosting ──────────────────────────────────────────────────────────────────

@app.get("/hosting", include_in_schema=False)
def hosting_page():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/#hosting")


@app.get("/hosting/sites")
def hosting_list(_: str = Depends(require_admin)):
    try:
        return hosting.list_sites()
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/hosting/sites")
def hosting_create(
    domain: str = Form(None),
    subdomain: str = Form(None),
    _: str = Depends(require_admin),
):
    target = domain or subdomain
    if not target:
        raise HTTPException(400, "Domeen on kohustuslik")
    if domain is None and subdomain is not None and "." not in subdomain:
        target = f"{subdomain}.{hosting.DEFAULT_DOMAIN}"
    try:
        return hosting.add_site(target)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.delete("/hosting/sites/{domain:path}")
def hosting_delete(domain: str, _: str = Depends(require_admin)):
    target = domain
    if "." not in target:
        target = f"{target}.{hosting.DEFAULT_DOMAIN}"
    try:
        hosting.remove_site(target)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(400, str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8080")), reload=False)
