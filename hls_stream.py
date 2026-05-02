import subprocess
import threading
import time
from pathlib import Path

HLS_DIR = Path("/tmp/nutikodu_hls")
VAAPI_DEVICE = "/dev/dri/renderD128"


class HLSStream:
    def __init__(self, rtsp_url: str):
        self.rtsp_url = rtsp_url
        self._proc: subprocess.Popen | None = None
        self._stop = False
        HLS_DIR.mkdir(exist_ok=True)

    @property
    def m3u8(self) -> Path:
        return HLS_DIR / "stream.m3u8"

    def start(self):
        self._stop = False
        self._launch()
        threading.Thread(target=self._watch, daemon=True).start()

    def _launch(self):
        cmd = [
            "ffmpeg", "-y",
            "-hwaccel", "vaapi",
            "-hwaccel_device", VAAPI_DEVICE,
            "-hwaccel_output_format", "vaapi",
            "-rtsp_transport", "tcp",
            "-i", self.rtsp_url,
            "-vf", "scale_vaapi=1280:-2",
            "-c:v", "h264_vaapi",
            "-qp", "26",
            "-an",
            "-f", "hls",
            "-hls_time", "2",
            "-hls_list_size", "4",
            "-hls_flags", "delete_segments+append_list",
            str(self.m3u8),
        ]
        self._proc = subprocess.Popen(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

    def _watch(self):
        while not self._stop:
            if self._proc and self._proc.poll() is not None:
                if not self._stop:
                    time.sleep(3)
                    self._launch()
            time.sleep(2)

    def stop(self):
        self._stop = True
        if self._proc:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()

    def ready(self) -> bool:
        return self.m3u8.exists()
