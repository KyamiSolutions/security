import cv2
import numpy as np
import os
import threading
import time
from datetime import datetime

RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "recordings")
_RECORD_SECONDS = 30
_COOLDOWN = 10


class MotionDetector:
    def __init__(self, camera, threshold: int = 8000, fps: int = 8):
        self.camera = camera
        self.threshold = threshold
        self.fps = fps
        self._prev_gray = None
        self._writer = None
        self._recording = False
        self._motion_at: float = 0
        self._last_triggered: float = 0
        self._current_file: str = ""
        self._running = False
        self._thread: threading.Thread | None = None
        os.makedirs(RECORDINGS_DIR, exist_ok=True)

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        self._stop_recording()

    def _loop(self):
        interval = 1.0 / self.fps
        while self._running:
            t0 = time.monotonic()
            frame_bytes = self.camera.read_frame()
            if frame_bytes:
                self._process(frame_bytes)
            elapsed = time.monotonic() - t0
            rem = interval - elapsed
            if rem > 0:
                time.sleep(rem)

    def _process(self, frame_bytes: bytes):
        arr = np.frombuffer(frame_bytes, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return

        gray = cv2.GaussianBlur(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (21, 21), 0)
        if self._prev_gray is None:
            self._prev_gray = gray
            return

        diff = cv2.absdiff(self._prev_gray, gray)
        motion_px = cv2.countNonZero(cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)[1])
        self._prev_gray = gray
        now = time.time()

        if motion_px > self.threshold:
            if not self._recording and (now - self._last_triggered) > _COOLDOWN:
                self._start_recording(frame)
                self._last_triggered = now
            self._motion_at = now

        if self._recording:
            self._writer.write(frame)
            if (now - self._motion_at) > _RECORD_SECONDS:
                self._stop_recording()

    def _start_recording(self, frame):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(RECORDINGS_DIR, f"motion_{ts}.mp4")
        h, w = frame.shape[:2]
        self._writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), self.fps, (w, h))
        self._current_file = path
        self._recording = True
        print(f"Liikumine tuvastatud → {path}")

    def _stop_recording(self):
        if self._writer:
            self._writer.release()
            self._writer = None
        self._recording = False


def list_recordings() -> list[dict]:
    os.makedirs(RECORDINGS_DIR, exist_ok=True)
    out = []
    for name in sorted(os.listdir(RECORDINGS_DIR), reverse=True):
        if not name.endswith(".mp4"):
            continue
        path = os.path.join(RECORDINGS_DIR, name)
        st = os.stat(path)
        out.append({
            "filename": name,
            "size_mb": round(st.st_size / 1_048_576, 1),
            "created": datetime.fromtimestamp(st.st_mtime).strftime("%d.%m.%Y %H:%M:%S"),
        })
    return out
