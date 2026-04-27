import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from auth import verify_key
from camera import Camera, list_cameras, mjpeg_generator

cameras: dict[int, Camera] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ava vaikimisi kaamera käivitumisel
    default = int(os.environ.get("CAMERA_INDEX", "0"))
    try:
        cameras[default] = Camera(default)
    except RuntimeError as e:
        print(f"Hoiatus: {e}")
    yield
    for cam in cameras.values():
        cam.release()


app = FastAPI(title="Kaamera kaughaldus", lifespan=lifespan)


def _get_camera(index: int) -> Camera:
    if index not in cameras:
        try:
            cameras[index] = Camera(index)
        except RuntimeError:
            raise HTTPException(404, f"Kaamera {index} pole saadaval")
    return cameras[index]


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def index():
    with open("templates/index.html", encoding="utf-8") as f:
        return f.read()


@app.get("/cameras")
def get_cameras(_: str = Depends(verify_key)):
    return {"cameras": list_cameras()}


@app.get("/stream/{index}")
def stream(index: int = 0, _: str = Depends(verify_key)):
    cam = _get_camera(index)
    return StreamingResponse(
        mjpeg_generator(cam),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/snapshot/{index}")
def snapshot(index: int = 0, _: str = Depends(verify_key)):
    cam = _get_camera(index)
    frame = cam.snapshot()
    if frame is None:
        raise HTTPException(503, "Kaader pole saadaval")
    return Response(content=frame, media_type="image/jpeg")


@app.get("/controls/{index}")
def get_controls(index: int = 0, _: str = Depends(verify_key)):
    cam = _get_camera(index)
    return {"controls": cam.get_v4l2_controls()}


@app.post("/controls/{index}")
def set_control(
    index: int = 0,
    control: str = Query(...),
    value: int = Query(...),
    _: str = Depends(verify_key),
):
    cam = _get_camera(index)
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
