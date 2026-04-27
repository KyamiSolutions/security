import cv2
import threading
import time
import subprocess
import os
import numpy as np

# Tuntud RTSP rajad Hiina IP-kaameratele (proovitakse järjekorras)
RTSP_PATHS = [
    "/11",                                      # CamHi / Zhongxin põhistream
    "/12",                                      # CamHi alamstream
    "/stream",
    "/live/ch00_0",
    "/ch0_0.264",
    "/videoMain",
    "/cam/realmonitor?channel=1&subtype=0",     # Dahua
    "/h264/ch1/main/av_stream",                 # Hikvision
]


def _ffmpeg_probe_dims(url: str) -> tuple[int, int] | None:
    """Tagastab (laius, kõrgus) või None kui ühendus ebaõnnestus."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-rtsp_transport", "tcp",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=p=0",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            w, h = map(int, result.stdout.strip().split(","))
            return w, h
    except Exception:
        pass
    return None


class Camera:
    def __init__(self, source: str | int):
        # source on kas RTSP URL (str) või USB indeks (int)
        self.source = source
        self.is_rtsp = isinstance(source, str) and source.startswith("rtsp://")
        self.lock = threading.Lock()
        self._latest_frame: bytes | None = None
        self._ffmpeg_proc = None
        self.cap = None
        self._open()

    def _open(self):
        if self.is_rtsp:
            self._open_ffmpeg()
        else:
            self.cap = cv2.VideoCapture(self.source)
            if not self.cap.isOpened():
                label = f"/dev/video{self.source}"
                raise RuntimeError(f"Kaamerat ei leitud: {label}")

    def _open_ffmpeg(self):
        dims = _ffmpeg_probe_dims(self.source)
        if dims is None:
            raise RuntimeError(f"Kaamerat ei leitud: {self.source}")
        self._frame_w, self._frame_h = dims
        self._frame_size = self._frame_w * self._frame_h * 3

        self._ffmpeg_proc = subprocess.Popen(
            [
                "ffmpeg", "-loglevel", "error",
                "-rtsp_transport", "tcp",
                "-i", self.source,
                "-f", "rawvideo", "-pix_fmt", "bgr24",
                "pipe:1",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        t = threading.Thread(target=self._read_loop, daemon=True)
        t.start()

    def _read_loop(self):
        proc = self._ffmpeg_proc
        while True:
            raw = proc.stdout.read(self._frame_size)
            if not raw or len(raw) != self._frame_size:
                break
            frame = np.frombuffer(raw, np.uint8).reshape(
                (self._frame_h, self._frame_w, 3)
            )
            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            with self.lock:
                self._latest_frame = buf.tobytes()
        # Ühendus katkes — proovi 2 sek pärast uuesti
        time.sleep(2)
        try:
            self._open_ffmpeg()
        except RuntimeError:
            pass

    def read_frame(self) -> bytes | None:
        if self.is_rtsp:
            with self.lock:
                return self._latest_frame
        with self.lock:
            ok, frame = self.cap.read()
        if not ok:
            return None
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return buf.tobytes()

    def snapshot(self) -> bytes | None:
        return self.read_frame()

    def release(self):
        if self._ffmpeg_proc:
            self._ffmpeg_proc.kill()
        if self.cap:
            self.cap.release()

    def set_v4l2(self, control: str, value: int):
        if self.is_rtsp:
            return
        dev = f"/dev/video{self.source}"
        subprocess.run(
            ["v4l2-ctl", f"--device={dev}", f"--set-ctrl={control}={value}"],
            capture_output=True,
        )

    def get_v4l2_controls(self) -> dict:
        if self.is_rtsp:
            return {}
        dev = f"/dev/video{self.source}"
        result = subprocess.run(
            ["v4l2-ctl", f"--device={dev}", "--list-ctrls"],
            capture_output=True, text=True,
        )
        controls = {}
        for line in result.stdout.splitlines():
            line = line.strip()
            if not line or ":" not in line:
                continue
            name_part, _, rest = line.partition(":")
            name = name_part.split()[-1]
            for token in rest.split():
                if token.startswith("value="):
                    try:
                        controls[name] = int(token.split("=")[1])
                    except ValueError:
                        pass
        return controls


def probe_rtsp(ip: str, user: str = "admin", password: str = "admin", port: int = 554) -> str | None:
    """Proovib leida toimivat RTSP rada antud IP-l."""
    for path in RTSP_PATHS:
        url = f"rtsp://{user}:{password}@{ip}:{port}{path}"
        if _ffmpeg_probe_dims(url) is not None:
            return url
    return None


def list_usb_cameras() -> list[int]:
    found = []
    for i in range(8):
        path = f"/dev/video{i}"
        if os.path.exists(path):
            cap = cv2.VideoCapture(i)
            if cap.isOpened():
                found.append(i)
                cap.release()
    return found


def mjpeg_generator(camera: Camera, fps: int = 15):
    interval = 1.0 / fps
    while True:
        start = time.monotonic()
        frame = camera.read_frame()
        if frame:
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
            )
        elapsed = time.monotonic() - start
        remaining = interval - elapsed
        if remaining > 0:
            time.sleep(remaining)
