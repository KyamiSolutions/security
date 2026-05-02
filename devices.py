import json
import os
import httpx

DEVICES_FILE = "devices.json"


def _load() -> list[dict]:
    if not os.path.exists(DEVICES_FILE):
        return []
    with open(DEVICES_FILE, encoding="utf-8") as f:
        return json.load(f)


def _save(devices: list[dict]):
    with open(DEVICES_FILE, "w", encoding="utf-8") as f:
        json.dump(devices, f, indent=2, ensure_ascii=False)


def list_devices() -> list[dict]:
    return _load()


def add_device(name: str, kind: str, ip: str, port: int = 80) -> dict:
    devices = _load()
    new_id = max((d["id"] for d in devices), default=0) + 1
    device = {"id": new_id, "name": name, "kind": kind, "ip": ip, "port": port, "state": False}
    devices.append(device)
    _save(devices)
    return device


def remove_device(device_id: int):
    _save([d for d in _load() if d["id"] != device_id])


async def toggle_device(device_id: int) -> dict:
    devices = _load()
    for d in devices:
        if d["id"] == device_id:
            d["state"] = not d["state"]
            state = "on" if d["state"] else "off"
            try:
                async with httpx.AsyncClient(timeout=3.0) as client:
                    if d["kind"] == "shelly":
                        await client.get(f"http://{d['ip']}/relay/0?turn={state}")
                    elif d["kind"] == "tasmota":
                        await client.get(f"http://{d['ip']}/cm?cmnd=Power%20{state}")
                    else:
                        await client.post(f"http://{d['ip']}:{d['port']}/switch", json={"state": state})
            except Exception:
                pass
            _save(devices)
            return d
    raise ValueError(f"Seade {device_id} ei leitud")
