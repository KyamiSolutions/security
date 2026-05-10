import cv2
import logging
import threading
import time
import subprocess
import os
import socket
from urllib.parse import quote

log = logging.getLogger("nutikodu.camera")

# RTSP rajad — Reolink esimesena, seejärel teised tuntud kaamerad
RTSP_PATHS = [
    "/h264Preview_01_main",                     # Reolink põhistream (H.264)
    "/h265Preview_01_main",                     # Reolink põhistream (H.265)
    "/h264Preview_01_sub",                      # Reolink alamstream
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
    RECONNECT_MIN = 1.0
    RECONNECT_MAX = 30.0

    def __init__(self, source: str | int):
        # source on kas RTSP URL (str) või USB indeks (int)
        self.source = source
        self.is_rtsp = isinstance(source, str) and source.startswith("rtsp://")
        self.cap = None
        self.lock = threading.Lock()
        self._reconnect_lock = threading.Lock()
        self._next_reconnect = 0.0
        self._backoff = self.RECONNECT_MIN
        self._open()

    def _open(self):
        if self.is_rtsp:
            # threads;1 väldib libavcodec pthread_frame assertion crash'i
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|threads;1"
            self.cap = cv2.VideoCapture()
            self.cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000)
            self.cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 8000)
            self.cap.open(self.source, cv2.CAP_FFMPEG)
        else:
            self.cap = cv2.VideoCapture(self.source)
        if not self.cap.isOpened():
            label = self.source if self.is_rtsp else f"/dev/video{self.source}"
            raise RuntimeError(f"Kaamerat ei leitud: {label}")

    def _try_reconnect(self) -> bool:
        """Üritab voogu uuesti avada exponential backoff'iga. Tagastab True kui õnnestus."""
        if not self.is_rtsp:
            return False
        now = time.monotonic()
        if now < self._next_reconnect:
            return False
        if not self._reconnect_lock.acquire(blocking=False):
            return False
        try:
            if time.monotonic() < self._next_reconnect:
                return False
            try:
                if self.cap:
                    self.cap.release()
            except Exception:
                pass
            try:
                self._open()
                self._backoff = self.RECONNECT_MIN
                self._next_reconnect = 0.0
                log.info("Kaamera ühendus taastatud: %s", self.source)
                return True
            except RuntimeError as e:
                self._backoff = min(self._backoff * 2, self.RECONNECT_MAX)
                self._next_reconnect = time.monotonic() + self._backoff
                log.warning(
                    "Kaamera ühendus katkenud (%s) — uus katse %.1fs pärast",
                    e, self._backoff,
                )
                return False
        finally:
            self._reconnect_lock.release()

    def read_frame(self) -> bytes | None:
        with self.lock:
            ok, frame = self.cap.read() if self.cap else (False, None)
        if not ok:
            if self.is_rtsp:
                self._try_reconnect()
            return None
        h, w = frame.shape[:2]
        if w > 1280:
            frame = cv2.resize(frame, (1280, int(h * 1280 / w)), interpolation=cv2.INTER_LINEAR)
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 65])
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
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def probe_rtsp(ip: str, user: str = "admin", password: str = "admin", port: int = 554) -> str | None:
    """Proovib leida toimivat RTSP rada antud IP-l. Parool URL-enkooditakse automaatselt."""
    if not _tcp_reachable(ip, port):
        return None
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|threads;1"
    encoded_pass = quote(password, safe="")
    for path in RTSP_PATHS:
        url = f"rtsp://{user}:{encoded_pass}@{ip}:{port}{path}"
        cap = cv2.VideoCapture()
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 8000)
        cap.open(url, cv2.CAP_FFMPEG)
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
