import os
import re
import secrets
import string
import subprocess

import httpx

CF_API = "https://api.cloudflare.com/client/v4"
DEFAULT_DOMAIN = os.environ.get("HOSTING_DOMAIN", "mrnux.ee")
LOCAL_HTTP = os.environ.get("HOSTING_LOCAL_HTTP", "http://localhost:80")

_RESERVED_HOSTS = {"www.mrnux.ee", "panel.mrnux.ee", "ssh.mrnux.ee", "api.mrnux.ee", "mrnux.ee"}


def _cf():
    token = os.environ.get("CF_API_TOKEN", "")
    account = os.environ.get("CF_ACCOUNT_ID", "")
    tunnel = os.environ.get("CF_TUNNEL_ID", "")
    if not all([token, account, tunnel]):
        raise RuntimeError("Cloudflare credentials puuduvad .env failis (CF_API_TOKEN, CF_ACCOUNT_ID, CF_TUNNEL_ID)")
    return token, account, tunnel


def _request(method: str, path: str, json: dict | None = None) -> dict:
    token, *_ = _cf()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    with httpx.Client(timeout=30) as c:
        r = c.request(method, f"{CF_API}{path}", headers=headers, json=json)
        r.raise_for_status()
        data = r.json()
    if not data.get("success", True):
        errs = "; ".join(e.get("message", "") for e in data.get("errors", []))
        raise RuntimeError(f"Cloudflare API viga: {errs}")
    return data


def _gen_password(length: int = 16) -> str:
    chars = string.ascii_letters + string.digits
    return "".join(secrets.choice(chars) for _ in range(length))


def _valid_hostname(name: str) -> bool:
    if not name or len(name) > 253:
        return False
    label = r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?"
    return bool(re.fullmatch(rf"{label}(\.{label})+", name))


def _find_zone_id(hostname: str) -> str:
    """Otsib Cloudflare tsooni mis kõige paremini sobib hostnamele.
    Nt 'blog.kalle.ee' jaoks leiab 'kalle.ee' tsooni kui see eksisteerib."""
    parts = hostname.split(".")
    candidates = [".".join(parts[i:]) for i in range(len(parts) - 1)]
    for candidate in candidates:
        data = _request("GET", f"/zones?name={candidate}")
        results = data.get("result") or []
        if results:
            return results[0]["id"]
    raise RuntimeError(
        f"Cloudflare tsooni ei leitud domeenile '{hostname}'. "
        f"Lisa domeen Cloudflare'is (Add Site) ja muuda registrari nameservers Cloudflare omadeks enne uuesti proovimist."
    )


def _tunnel_config() -> dict:
    _, account, tunnel = _cf()
    return _request("GET", f"/accounts/{account}/cfd_tunnel/{tunnel}/configurations")


def _set_tunnel_config(config: dict) -> None:
    _, account, tunnel = _cf()
    _request(
        "PUT",
        f"/accounts/{account}/cfd_tunnel/{tunnel}/configurations",
        json={"config": config},
    )


def _tunnel_add_hostname(hostname: str, service: str) -> None:
    cfg_resp = _tunnel_config()
    config = (cfg_resp.get("result") or {}).get("config") or {}
    ingress = config.get("ingress", []) or []
    catch_all = None
    if ingress and "hostname" not in ingress[-1]:
        catch_all = ingress.pop()
    if any(rule.get("hostname") == hostname for rule in ingress):
        raise RuntimeError(f"Hostname {hostname} on juba tunneli konfiguratsioonis")
    ingress.append({"hostname": hostname, "service": service})
    if catch_all:
        ingress.append(catch_all)
    else:
        ingress.append({"service": "http_status:404"})
    config["ingress"] = ingress
    _set_tunnel_config(config)


def _tunnel_remove_hostname(hostname: str) -> None:
    cfg_resp = _tunnel_config()
    config = (cfg_resp.get("result") or {}).get("config") or {}
    ingress = config.get("ingress", []) or []
    new_ingress = [rule for rule in ingress if rule.get("hostname") != hostname]
    if len(new_ingress) == len(ingress):
        return
    config["ingress"] = new_ingress
    _set_tunnel_config(config)


def _dns_add_cname(zone_id: str, name: str) -> str:
    _, _, tunnel = _cf()
    target = f"{tunnel}.cfargotunnel.com"
    data = _request(
        "POST",
        f"/zones/{zone_id}/dns_records",
        json={"type": "CNAME", "name": name, "content": target, "proxied": True},
    )
    return (data.get("result") or {}).get("id", "")


def _dns_find_record(zone_id: str, name: str) -> str | None:
    data = _request("GET", f"/zones/{zone_id}/dns_records?name={name}")
    results = data.get("result") or []
    return results[0]["id"] if results else None


def _dns_delete(zone_id: str, record_id: str) -> None:
    _request("DELETE", f"/zones/{zone_id}/dns_records/{record_id}")


def _virtualmin(args: list[str]) -> str:
    cmd = ["sudo", "/usr/sbin/virtualmin", *args]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        msg = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"Virtualmin viga: {msg}")
    return result.stdout


def _vmin_create(domain: str, password: str) -> None:
    args = [
        "create-domain",
        "--domain", domain,
        "--pass", password,
        "--unix",
        "--dir",
        "--web",
        "--mysql",
        "--webmin",
        "--logrotate",
        "--limits-from-plan",
    ]
    ip = os.environ.get("HOSTING_DEFAULT_IP", "").strip()
    if ip:
        args += ["--ip", ip, "--ip-already"]
    _virtualmin(args)


def _vmin_delete(domain: str) -> None:
    _virtualmin(["delete-domain", "--domain", domain])


def _vmin_exists(domain: str) -> bool:
    try:
        _virtualmin(["list-domains", "--domain", domain, "--name-only"])
        return True
    except RuntimeError:
        return False


def list_sites() -> list[dict]:
    cfg_resp = _tunnel_config()
    config = (cfg_resp.get("result") or {}).get("config") or {}
    ingress = config.get("ingress", []) or []
    sites = []
    for rule in ingress:
        host = rule.get("hostname")
        if not host or host in _RESERVED_HOSTS:
            continue
        sites.append({"hostname": host, "service": rule.get("service", "")})
    return sites


def add_site(domain: str) -> dict:
    full = domain.strip().lower().rstrip(".")
    if not _valid_hostname(full):
        raise RuntimeError("Vigane domeen — peab olema kujul nagu 'näide.ee' või 'blog.näide.ee'")
    if full in _RESERVED_HOSTS:
        raise RuntimeError(f"Domeen '{full}' on reserveeritud süsteemile")

    zone_id = _find_zone_id(full)

    if _vmin_exists(full):
        raise RuntimeError(f"Domeen {full} on Virtualminis juba olemas")

    password = _gen_password()
    _vmin_create(full, password)

    try:
        _tunnel_add_hostname(full, LOCAL_HTTP)
    except Exception as e:
        try:
            _vmin_delete(full)
        except Exception:
            pass
        raise RuntimeError(f"Tunneli seadistamine ebaõnnestus: {e}")

    try:
        _dns_add_cname(zone_id, full)
    except Exception as e:
        try:
            _tunnel_remove_hostname(full)
        except Exception:
            pass
        try:
            _vmin_delete(full)
        except Exception:
            pass
        raise RuntimeError(f"DNS kirje loomine ebaõnnestus: {e}")

    return {"hostname": full, "password": password, "panel": f"https://panel.{DEFAULT_DOMAIN}"}


def remove_site(domain: str) -> None:
    full = domain.strip().lower().rstrip(".")
    if not _valid_hostname(full):
        raise RuntimeError("Vigane domeen")

    try:
        zone_id = _find_zone_id(full)
        rec_id = _dns_find_record(zone_id, full)
        if rec_id:
            _dns_delete(zone_id, rec_id)
    except RuntimeError:
        pass

    _tunnel_remove_hostname(full)

    if _vmin_exists(full):
        _vmin_delete(full)
