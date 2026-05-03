import os
import threading
import time
from datetime import datetime

import cv2
import numpy as np
import urllib.request
import json

RECORDINGS_DIR = "recordings"
os.makedirs(RECORDINGS_DIR, exist_ok=True)

RECORD_SECONDS = 30
COOLDOWN_SECONDS = 10
MOTION_THRESHOLD = 8000


class MotionDetector:
    def __init__(self, camera, threshold: int = MOTION_THRESHOLD, fps: int = 8):
        self.camera = camera
        self.threshold = threshold
        self.fps = fps
        self._prev_gray = None
        self._writer = None
        self._recording_until = 0.0
        self._last_motion = 0.0
        self._thread = None
        self._running = False

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def _loop(self):
        interval = 1.0 / self.fps
        while self._running:
            start = time.monotonic()
            frame_bytes = self.camera.read_frame()
            if frame_bytes:
                self._process(frame_bytes)
            elapsed = time.monotonic() - start
            remaining = interval - elapsed
            if remaining > 0:
                time.sleep(remaining)
        if self._writer:
            self._stop_recording()

    def _process(self, frame_bytes: bytes):
        arr = np.frombuffer(frame_bytes, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (21, 21), 0)

        now = time.monotonic()

        if self._prev_gray is not None and self._prev_gray.shape == gray.shape:
            diff = cv2.absdiff(self._prev_gray, gray)
            _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
            changed = np.count_nonzero(thresh)

            if changed > self.threshold:
                self._last_motion = now
                if self._writer is None and (now - self._recording_until) > 0:
                    self._start_recording(frame)

        self._prev_gray = gray

        if self._writer is not None:
            self._writer.write(frame)
            if now > self._recording_until:
                self._stop_recording()

    def _start_recording(self, frame):
        now = datetime.now()
        filename = now.strftime("motion_%Y%m%d_%H%M%S.mp4")
        path = os.path.join(RECORDINGS_DIR, filename)
        h, w = frame.shape[:2]
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        self._writer = cv2.VideoWriter(path, fourcc, self.fps, (w, h))
        self._recording_until = time.monotonic() + RECORD_SECONDS
        threading.Thread(target=_send_discord, args=(now,), daemon=True).start()

    def _stop_recording(self):
        if self._writer:
            self._writer.release()
            self._writer = None
        self._recording_until = time.monotonic() + COOLDOWN_SECONDS


def _send_discord(ts: datetime):
    url = os.environ.get("DISCORD_WEBHOOK_URL", "")
    if not url:
        return
    payload = json.dumps({
        "username": "Nutikodu",
        "embeds": [{
            "title": "🚨 Liikumine tuvastatud!",
            "description": f"Kaamera tuvastas liikumise kell **{ts.strftime('%H:%M:%S')}**",
            "color": 0xe74c3c,
            "footer": {"text": ts.strftime("%d.%m.%Y")}
        }]
    }).encode()
    try:
        req = urllib.request.Request(url, data=payload,
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


def list_recordings() -> list[dict]:
    results = []
    if not os.path.isdir(RECORDINGS_DIR):
        return results
    for name in sorted(os.listdir(RECORDINGS_DIR), reverse=True):
        if name.endswith(".mp4"):
            path = os.path.join(RECORDINGS_DIR, name)
            results.append({
                "filename": name,
                "size": os.path.getsize(path),
                "mtime": os.path.getmtime(path),
            })
    return results
