import os
import secrets
from fastapi import HTTPException, Request

_sessions: set[str] = set()


def login(username: str, password: str) -> str:
    expected_user = os.environ.get("ADMIN_USER", "admin")
    expected_pass = os.environ.get("ADMIN_PASSWORD", "")
    if not expected_pass:
        raise HTTPException(500, "ADMIN_PASSWORD pole seadistatud")
    if username == expected_user and password == expected_pass:
        token = secrets.token_hex(32)
        _sessions.add(token)
        return token
    raise HTTPException(401, "Vale kasutajanimi või parool")


def logout(token: str):
    _sessions.discard(token)


def verify_session(request: Request) -> str:
    token = request.cookies.get("session") or request.headers.get("X-Session-Token")
    if not token or token not in _sessions:
        raise HTTPException(401, "Pole sisse logitud")
    return token
