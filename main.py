import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, Response, StreamingResponse

from auth import verify_key
from camera import Camera, _tcp_reachable, list_usb_cameras, mjpeg_generator, probe_rtsp

# Võtmeks on RTSP URL string või USB indeks int
cameras: dict[str | int, Camera] = {}


def _default_source() -> str | int:
    url = os.environ.get("CAMERA_URL", "")
    if url:
        return url
    return int(os.environ.get("CAMERA_INDEX", "0"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    source = _default_source()
    try:
        cameras[source] = Camera(source)
        print(f"Kaamera avatud: {source}")
    except RuntimeError as e:
        print(f"Hoiatus: {e}")
    yield
    for cam in cameras.values():
        cam.release()


app = FastAPI(title="Kaamera kaughaldus", lifespan=lifespan)


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


@app.get("/cameras")
def get_cameras(_: str = Depends(verify_key)):
    usb = list_usb_cameras()
    rtsp = [k for k in cameras if isinstance(k, str)]
    return {"usb": usb, "rtsp": rtsp}


@app.get("/probe")
def probe(
    ip: str = Query(...),
    user: str = Query("admin"),
    password: str = Query("admin"),
    port: int = Query(554),
    _: str = Depends(verify_key),
):
    """Leiab automaatselt toimiva RTSP raja antud IP-kaamerale."""
    if not _tcp_reachable(ip, port):
        raise HTTPException(503, f"Port {port} on suletud aadressil {ip}. Kontrolli, et kaamera on võrgus.")
    url = probe_rtsp(ip, user, password, port)
    if not url:
        raise HTTPException(404, "RTSP rada ei leitud. Kaamera vastab, aga ükski tuntud rada ei töötanud.")
    cameras[url] = Camera(url)
    # Peida parool vastuses
    safe = url.replace(f":{password}@", ":***@")
    return {"url": safe, "internal_key": url}


@app.get("/stream")
def stream(key: str = Query(...), _: str = Depends(verify_key)):
    cam = _get_camera(key if not key.isdigit() else int(key))
    return StreamingResponse(
        mjpeg_generator(cam),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/snapshot")
def snapshot(key: str = Query(...), _: str = Depends(verify_key)):
    cam = _get_camera(key if not key.isdigit() else int(key))
    frame = cam.snapshot()
    if frame is None:
        raise HTTPException(503, "Kaader pole saadaval")
    return Response(content=frame, media_type="image/jpeg")


@app.get("/controls")
def get_controls(key: str = Query(...), _: str = Depends(verify_key)):
    cam = _get_camera(key if not key.isdigit() else int(key))
    return {"controls": cam.get_v4l2_controls()}


@app.post("/controls")
def set_control(
    key: str = Query(...),
    control: str = Query(...),
    value: int = Query(...),
    _: str = Depends(verify_key),
):
    cam = _get_camera(key if not key.isdigit() else int(key))
    cam.set_v4l2(control, value)
    return {"ok": True, "control": control, "value": value}


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080"))
    ssl_cert = os.environ.get("SSL_CERT")
    ssl_key = os.environ.get("SSL_KEY")

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        ssl_certfile=ssl_cert or None,
        ssl_keyfile=ssl_key or None,
        reload=False,
    )
