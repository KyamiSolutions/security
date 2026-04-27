import cv2
import threading
import time
import subprocess
import os
import socket

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


class Camera:
    def __init__(self, source: str | int):
        # source on kas RTSP URL (str) või USB indeks (int)
        self.source = source
        self.is_rtsp = isinstance(source, str) and source.startswith("rtsp://")
        self.cap = None
        self.lock = threading.Lock()
        self._open()

    def _open(self):
        if self.is_rtsp:
            os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        self.cap = cv2.VideoCapture(self.source)
        if self.is_rtsp:
            self.cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
            self.cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
        if not self.cap.isOpened():
            label = self.source if self.is_rtsp else f"/dev/video{self.source}"
            raise RuntimeError(f"Kaamerat ei leitud: {label}")

    def read_frame(self) -> bytes | None:
        with self.lock:
            ok, frame = self.cap.read()
        if not ok:
            # RTSP ühendus võib katkeda — proovi uuesti avada
            if self.is_rtsp:
                try:
                    self.cap.release()
                    self._open()
                except RuntimeError:
                    pass
            return None
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return buf.tobytes()

    def snapshot(self) -> bytes | None:
        return self.read_frame()

    def release(self):
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


def _tcp_reachable(ip: str, port: int, timeout: float = 3.0) -> bool:
    """Kiire TCP ühenduse kontroll enne RTSP proovimist."""
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def probe_rtsp(ip: str, user: str = "admin", password: str = "admin", port: int = 554) -> str | None:
    """Proovib leida toimivat RTSP rada antud IP-l."""
    if not _tcp_reachable(ip, port):
        return None
    for path in RTSP_PATHS:
        url = f"rtsp://{user}:{password}@{ip}:{port}{path}"
        cap = cv2.VideoCapture(url)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
        if cap.isOpened():
            ok, _ = cap.read()
            cap.release()
            if ok:
                return url
        cap.release()
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
