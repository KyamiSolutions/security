import json
import os
from pathlib import Path

SETTINGS_FILE = Path(__file__).parent / "settings.json"

DEFAULTS: dict = {
    "camera_url": "",
    "motion_threshold": 8000,
    "motion_record_seconds": 30,
    "motion_cooldown_seconds": 10,
    "discord_webhook_url": "",
    "notifications_enabled": True,
}


def load() -> dict:
    base = dict(DEFAULTS)
    base["camera_url"] = os.environ.get("CAMERA_URL", "")
    base["discord_webhook_url"] = os.environ.get("DISCORD_WEBHOOK_URL", "")
    if SETTINGS_FILE.exists():
        try:
            stored = json.loads(SETTINGS_FILE.read_text())
            base.update(stored)
        except Exception:
            pass
    return base


def save(updates: dict):
    current = load()
    current.update({k: v for k, v in updates.items() if k in DEFAULTS})
    SETTINGS_FILE.write_text(json.dumps(current, indent=2))
