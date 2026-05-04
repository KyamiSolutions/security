import asyncio
import os
from contextlib import asynccontextmanager
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
from motion import MotionDetector, list_recordings, RECORDINGS_DIR
from hls_stream import HLSStream, HLS_DIR

cameras: dict[str | int, Camera] = {}
detectors: dict[str | int, MotionDetector] = {}
hls_stream: HLSStream | None = None


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

@app.get("/smart-dashboard", response_class=HTMLResponse, include_in_schema=False)
def smart_dashboard():
    return Path("templates/smart-dashboard.html").read_text(encoding="utf-8")

@app.get("/{page}.html", response_class=HTMLResponse, include_in_schema=False)
def serve_html(page: str):
    path = Path("templates") / f"{page}.html"
    if not path.exists():
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="/smart-dashboard.html")
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
        except Exception:
            pass
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8080")), reload=False)
