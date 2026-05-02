import os
import secrets
from fastapi import Depends, HTTPException, Query

_sessions: set[str] = set()


def login(username: str, password: str) -> str:
    expected_user = os.environ.get("ADMIN_USER", "admin")
    expected_pass = os.environ.get("ADMIN_PASSWORD", "")
    if username == expected_user and password == expected_pass:
        token = secrets.token_hex(32)
        _sessions.add(token)
        return token
    raise HTTPException(401, "Vale kasutajanimi või parool")


def logout(token: str):
    _sessions.discard(token)


def verify_key(api_key: str = Query(..., alias="api_key")) -> str:
    if api_key in _sessions or api_key == os.environ.get("CAMERA_API_KEY", ""):
        return api_key
    raise HTTPException(403, "Vigane võti — logi uuesti sisse")
