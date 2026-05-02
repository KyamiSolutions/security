import hashlib
import json
import os
import secrets
from pathlib import Path
from fastapi import HTTPException, Request

USERS_FILE = Path(__file__).parent / "users.json"
_sessions: dict[str, str] = {}  # token -> username


def _hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()


def _load() -> dict:
    if USERS_FILE.exists():
        return json.loads(USERS_FILE.read_text())
    # Esimene käivitus: loo admin kasutaja .env paroolist
    admin_pass = os.environ.get("ADMIN_PASSWORD", "")
    admin_user = os.environ.get("ADMIN_USER", "admin")
    if not admin_pass:
        return {}
    salt = secrets.token_hex(16)
    users = {admin_user: {"salt": salt, "hash": _hash(admin_pass, salt), "role": "admin"}}
    _save(users)
    return users


def _save(users: dict):
    USERS_FILE.write_text(json.dumps(users, indent=2))


def login(username: str, password: str) -> str:
    users = _load()
    u = users.get(username)
    if not u:
        raise HTTPException(401, "Vale kasutajanimi või parool")
    if _hash(password, u["salt"]) != u["hash"]:
        raise HTTPException(401, "Vale kasutajanimi või parool")
    token = secrets.token_hex(32)
    _sessions[token] = username
    return token


def logout(token: str):
    _sessions.pop(token, None)


def verify_session(request: Request) -> str:
    token = request.cookies.get("session") or request.headers.get("X-Session-Token")
    if not token or token not in _sessions:
        raise HTTPException(401, "Pole sisse logitud")
    return token


def get_username(token: str) -> str:
    return _sessions.get(token, "")


def list_users() -> list[dict]:
    return [{"username": u, "role": v["role"]} for u, v in _load().items()]


def add_user(username: str, password: str, role: str = "user"):
    if not username or not password:
        raise HTTPException(400, "Kasutajanimi ja parool on kohustuslikud")
    users = _load()
    if username in users:
        raise HTTPException(409, "Kasutaja on juba olemas")
    salt = secrets.token_hex(16)
    users[username] = {"salt": salt, "hash": _hash(password, salt), "role": role}
    _save(users)


def delete_user(username: str, current_user: str):
    if username == current_user:
        raise HTTPException(400, "Ei saa iseennast kustutada")
    users = _load()
    if username not in users:
        raise HTTPException(404, "Kasutajat ei leitud")
    del users[username]
    _save(users)
    # Logi see kasutaja välja
    for token, u in list(_sessions.items()):
        if u == username:
            _sessions.pop(token, None)


def change_password(username: str, new_password: str):
    if not new_password:
        raise HTTPException(400, "Parool ei tohi olla tühi")
    users = _load()
    if username not in users:
        raise HTTPException(404, "Kasutajat ei leitud")
    salt = secrets.token_hex(16)
    users[username]["salt"] = salt
    users[username]["hash"] = _hash(new_password, salt)
    _save(users)
