import json
import os
import uuid

import httpx

DEVICES_FILE = "devices.json"


def _load() -> list[dict]:
    if not os.path.exists(DEVICES_FILE):
        return []
    with open(DEVICES_FILE) as f:
        return json.load(f)


def _save(devices: list[dict]):
    with open(DEVICES_FILE, "w") as f:
        json.dump(devices, f, indent=2)


def list_devices() -> list[dict]:
    return _load()


def add_device(name: str, kind: str, ip: str, port: int = 80) -> dict:
    devices = _load()
    device = {
        "id": str(uuid.uuid4()),
        "name": name,
        "kind": kind,  # shelly | tasmota | sonoff | http
        "ip": ip,
        "port": port,
        "state": False,
    }
    devices.append(device)
    _save(devices)
    return device


def remove_device(device_id: str):
    devices = [d for d in _load() if d["id"] != device_id]
    _save(devices)


async def toggle_device(device_id: str) -> dict:
    devices = _load()
    device = next((d for d in devices if d["id"] == device_id), None)
    if not device:
        return {"error": "Seadet ei leitud"}

    new_state = not device.get("state", False)
    base = f"http://{device['ip']}:{device['port']}"

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            if device["kind"] == "shelly":
                action = "on" if new_state else "off"
                await client.get(f"{base}/relay/0?turn={action}")
            elif device["kind"] == "tasmota":
                cmd = "Power%20on" if new_state else "Power%20off"
                await client.get(f"{base}/cm?cmnd={cmd}")
            elif device["kind"] == "sonoff":
                cmd = "on" if new_state else "off"
                await client.post(
                    f"{base}/zeroconf/switch",
                    json={"deviceid": "", "data": {"switch": cmd}},
                    headers={"Content-Type": "application/json"},
                )
            elif device["kind"] == "http":
                await client.post(f"{base}/switch", json={"state": new_state})
    except Exception as e:
        return {"error": str(e)}

    device["state"] = new_state
    _save(devices)
    return device
