import cv2
import threading
import time
import subprocess
import os


class Camera:
    def __init__(self, device_index: int = 0):
        self.device_index = device_index
        self.cap = None
        self.lock = threading.Lock()
        self._open()

    def _open(self):
        self.cap = cv2.VideoCapture(self.device_index)
        if not self.cap.isOpened():
            raise RuntimeError(f"Kaamerat ei leitud: /dev/video{self.device_index}")

    def read_frame(self) -> bytes | None:
        with self.lock:
            ok, frame = self.cap.read()
        if not ok:
            return None
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return buf.tobytes()

    def snapshot(self) -> bytes | None:
        return self.read_frame()

    def release(self):
        if self.cap:
            self.cap.release()

    # v4l2 settings — silently ignored if v4l2-utils not installed
    def set_v4l2(self, control: str, value: int):
        dev = f"/dev/video{self.device_index}"
        subprocess.run(
            ["v4l2-ctl", f"--device={dev}", f"--set-ctrl={control}={value}"],
            capture_output=True,
        )

    def get_v4l2_controls(self) -> dict:
        dev = f"/dev/video{self.device_index}"
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


def list_cameras() -> list[int]:
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
