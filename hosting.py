import os
import re
import secrets
import string
import subprocess

import httpx

CF_API = "https://api.cloudflare.com/client/v4"
DOMAIN = os.environ.get("HOSTING_DOMAIN", "mrnux.ee")
LOCAL_HTTP = os.environ.get("HOSTING_LOCAL_HTTP", "http://localhost:80")


def _cf():
    token = os.environ.get("CF_API_TOKEN", "")
    zone = os.environ.get("CF_ZONE_ID", "")
    account = os.environ.get("CF_ACCOUNT_ID", "")
    tunnel = os.environ.get("CF_TUNNEL_ID", "")
    if not all([token, zone, account, tunnel]):
        raise RuntimeError("Cloudflare credentials puuduvad .env failis")
    return token, zone, account, tunnel


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


def _valid_subdomain(name: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?", name))


def _tunnel_config() -> dict:
    _, _, account, tunnel = _cf()
    return _request("GET", f"/accounts/{account}/cfd_tunnel/{tunnel}/configurations")


def _set_tunnel_config(config: dict) -> None:
    _, _, account, tunnel = _cf()
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


def _dns_add_cname(name: str) -> str:
    _, zone, _, tunnel = _cf()
    target = f"{tunnel}.cfargotunnel.com"
    data = _request(
        "POST",
        f"/zones/{zone}/dns_records",
        json={"type": "CNAME", "name": name, "content": target, "proxied": True},
    )
    return (data.get("result") or {}).get("id", "")


def _dns_find_record(name: str) -> str | None:
    _, zone, _, _ = _cf()
    data = _request("GET", f"/zones/{zone}/dns_records?name={name}")
    results = data.get("result") or []
    return results[0]["id"] if results else None


def _dns_delete(record_id: str) -> None:
    _, zone, _, _ = _cf()
    _request("DELETE", f"/zones/{zone}/dns_records/{record_id}")


def _virtualmin(args: list[str]) -> str:
    cmd = ["sudo", "/usr/sbin/virtualmin", *args]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        msg = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"Virtualmin viga: {msg}")
    return result.stdout


def _vmin_create(domain: str, password: str) -> None:
    _virtualmin([
        "create-domain",
        "--domain", domain,
        "--pass", password,
        "--unix",
        "--dir",
        "--web",
        "--mysql",
        "--limits-from-plan",
    ])


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
        if not host or host == DOMAIN:
            continue
        if not host.endswith(f".{DOMAIN}"):
            continue
        sub = host[: -len(DOMAIN) - 1]
        sites.append({"subdomain": sub, "hostname": host, "service": rule.get("service", "")})
    return sites


def add_site(subdomain: str) -> dict:
    sub = subdomain.strip().lower()
    if not _valid_subdomain(sub):
        raise RuntimeError("Vigane alamdomeen — ainult tähed, numbrid ja sidekriips")
    if sub in {"www", "panel", "ssh", "api"}:
        raise RuntimeError(f"Alamdomeen '{sub}' on reserveeritud")
    full = f"{sub}.{DOMAIN}"
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
        _dns_add_cname(full)
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
    return {"hostname": full, "password": password, "panel": f"https://panel.{DOMAIN}"}


def remove_site(subdomain: str) -> None:
    sub = subdomain.strip().lower()
    if not _valid_subdomain(sub):
        raise RuntimeError("Vigane alamdomeen")
    full = f"{sub}.{DOMAIN}"
    rec_id = _dns_find_record(full)
    if rec_id:
        _dns_delete(rec_id)
    _tunnel_remove_hostname(full)
    if _vmin_exists(full):
        _vmin_delete(full)
