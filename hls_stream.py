import logging
import subprocess
import threading
import time
from pathlib import Path

HLS_DIR = Path("/tmp/nutikodu_hls")
VAAPI_DEVICE = "/dev/dri/renderD128"
DVR_WINDOW_SECONDS = 3600  # 1h DVR buffer

log = logging.getLogger("nutikodu.hls")


class HLSStream:
    def __init__(self, rtsp_url: str):
        self.rtsp_url = rtsp_url
        self._proc: subprocess.Popen | None = None
        self._stop = False
        self._mode = "vaapi"  # "vaapi" või "sw"
        self._fail_count = 0
        self._last_stderr = ""
        HLS_DIR.mkdir(exist_ok=True)

    @property
    def m3u8(self) -> Path:
        return HLS_DIR / "stream.m3u8"

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def last_error(self) -> str:
        return self._last_stderr[-500:] if self._last_stderr else ""

    def start(self):
        self._stop = False
        self._launch()
        threading.Thread(target=self._watch, daemon=True).start()
        threading.Thread(target=self._cleanup_loop, daemon=True).start()

    def _cmd_vaapi(self) -> list[str]:
        return [
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
            "-hls_list_size", "6",
            "-hls_flags", "append_list",
            str(self.m3u8),
        ]

    def _cmd_sw(self) -> list[str]:
        return [
            "ffmpeg", "-y",
            "-rtsp_transport", "tcp",
            "-i", self.rtsp_url,
            "-vf", "scale=1280:-2",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-crf", "26",
            "-an",
            "-f", "hls",
            "-hls_time", "2",
            "-hls_list_size", "6",
            "-hls_flags", "append_list",
            str(self.m3u8),
        ]

    def _launch(self):
        cmd = self._cmd_vaapi() if self._mode == "vaapi" else self._cmd_sw()
        log.info("HLS käivitub (%s režiim)", self._mode)
        self._proc = subprocess.Popen(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
        )

    def _drain_stderr(self):
        if not self._proc or not self._proc.stderr:
            return
        try:
            data = self._proc.stderr.read()
            if data:
                self._last_stderr = data.decode("utf-8", errors="replace")
        except Exception:
            pass

    def _watch(self):
        start_time = time.monotonic()
        while not self._stop:
            if self._proc and self._proc.poll() is not None:
                self._drain_stderr()
                run_time = time.monotonic() - start_time
                if not self._stop:
                    if self._mode == "vaapi" and run_time < 5:
                        self._fail_count += 1
                        if self._fail_count >= 2:
                            log.warning(
                                "VAAPI ebaõnnestus 2 korda (%s) — lülitun software encoding'ule",
                                self._last_stderr.strip().splitlines()[-1] if self._last_stderr else "tundmatu viga",
                            )
                            self._mode = "sw"
                            self._fail_count = 0
                    elif self._mode == "sw" and run_time < 5:
                        log.warning("HLS software encoding kukkus kohe (%ss): %s",
                                    f"{run_time:.1f}",
                                    self._last_stderr.strip().splitlines()[-1] if self._last_stderr else "tundmatu viga")
                    time.sleep(3)
                    start_time = time.monotonic()
                    self._launch()
            time.sleep(2)

    def _cleanup_loop(self):
        """Kustutab .ts failid mis on vanemad kui DVR aken + 5 min margin."""
        while not self._stop:
            time.sleep(300)
            cutoff = time.time() - DVR_WINDOW_SECONDS - 300
            try:
                for ts in HLS_DIR.glob("*.ts"):
                    try:
                        if ts.stat().st_mtime < cutoff:
                            ts.unlink()
                    except OSError:
                        pass
            except Exception:
                pass

    def stop(self):
        self._stop = True
        if self._proc:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        self._drain_stderr()

    def ready(self) -> bool:
        return self.m3u8.exists()
