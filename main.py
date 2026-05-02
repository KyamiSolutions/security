import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, Response, StreamingResponse, FileResponse
from pydantic import BaseModel

from auth import login, logout, verify_key
from camera import Camera, _tcp_reachable, list_usb_cameras, mjpeg_generator, probe_rtsp
from motion import MotionDetector, list_recordings, RECORDINGS_DIR
from devices import list_devices, add_device, remove_device, toggle_device

cameras: dict[str | int, Camera] = {}
motion_detectors: dict[str | int, MotionDetector] = {}


def _default_source() -> str | int:
    url = os.environ.get("CAMERA_URL", "")
    if url:
        return url
    return int(os.environ.get("CAMERA_INDEX", "0"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    source = _default_source()
    try:
        cam = await asyncio.to_thread(Camera, source)
        cameras[source] = cam
        md = MotionDetector(cam)
        md.start()
        motion_detectors[source] = md
        print(f"Kaamera avatud ja liikumistuvastus käivitatud: {source}")
    except RuntimeError as e:
        print(f"Hoiatus: {e}")
    yield
    for md in motion_detectors.values():
        md.stop()
    for cam in cameras.values():
        cam.release()


app = FastAPI(title="Nutikodu", lifespan=lifespan)


class LoginRequest(BaseModel):
    username: str
    password: str


class LogoutRequest(BaseModel):
    token: str


class DeviceRequest(BaseModel):
    name: str
    kind: str
    ip: str
    port: int = 80


def _get_camera(key: str | int) -> Camera:
    if key not in cameras:
        try:
            cameras[key] = Camera(key)
        except RuntimeError:
            raise HTTPException(404, f"Kaamera pole saadaval: {key}")
    return cameras[key]


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def index():
    with open("templates/index.html", encoding="utf-8") as f:
        return f.read()


@app.post("/login")
def do_login(req: LoginRequest):
    token = login(req.username, req.password)
    source = _default_source()
    return {"token": token, "cam_key": str(source)}


@app.post("/logout")
def do_logout(req: LogoutRequest):
    logout(req.token)
    return {"ok": True}


@app.get("/stream")
def stream(key: str = Query(...), _: str = Depends(verify_key)):
    cam = _get_camera(key if not key.isdigit() else int(key))
    return StreamingResponse(mjpeg_generator(cam), media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/snapshot")
def snapshot(key: str = Query(...), _: str = Depends(verify_key)):
    cam = _get_camera(key if not key.isdigit() else int(key))
    frame = cam.snapshot()
    if frame is None:
        raise HTTPException(503, "Kaader pole saadaval")
    return Response(content=frame, media_type="image/jpeg")


@app.get("/recordings")
def get_recordings(_: str = Depends(verify_key)):
    return list_recordings()


@app.get("/recordings/{filename}")
def download_recording(filename: str, _: str = Depends(verify_key)):
    path = Path(RECORDINGS_DIR) / filename
    if not path.exists() or not filename.endswith(".mp4"):
        raise HTTPException(404, "Salvestus ei leitud")
    return FileResponse(path, media_type="video/mp4", filename=filename)


@app.delete("/recordings/{filename}")
def delete_recording(filename: str, _: str = Depends(verify_key)):
    path = Path(RECORDINGS_DIR) / filename
    if not path.exists():
        raise HTTPException(404, "Salvestus ei leitud")
    path.unlink()
    return {"ok": True}


@app.get("/devices")
def get_devices(_: str = Depends(verify_key)):
    return list_devices()


@app.post("/devices")
def create_device(req: DeviceRequest, _: str = Depends(verify_key)):
    return add_device(req.name, req.kind, req.ip, req.port)


@app.delete("/devices/{device_id}")
def delete_device(device_id: int, _: str = Depends(verify_key)):
    remove_device(device_id)
    return {"ok": True}


@app.post("/devices/{device_id}/toggle")
async def do_toggle(device_id: int, _: str = Depends(verify_key)):
    try:
        return await toggle_device(device_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.get("/probe")
async def probe(ip: str = Query(...), user: str = Query("admin"), password: str = Query("admin"), port: int = Query(554), _: str = Depends(verify_key)):
    if not await asyncio.to_thread(_tcp_reachable, ip, port):
        raise HTTPException(503, f"Port {port} suletud aadressil {ip}")
    url = await asyncio.to_thread(probe_rtsp, ip, user, password, port)
    if not url:
        raise HTTPException(404, "RTSP rada ei leitud")
    cameras[url] = Camera(url)
    return {"url": url.replace(f":{password}@", ":***@"), "internal_key": url}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8080")), reload=False)
