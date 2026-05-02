import hashlib
import os
import secrets
import mysql.connector
from functools import lru_cache
from fastapi import HTTPException, Request

_sessions: dict[str, str] = {}  # token -> username


def _db():
    return mysql.connector.connect(
        host=os.environ.get("MYSQL_HOST", "localhost"),
        user=os.environ.get("MYSQL_USER", "nutikodu"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=os.environ.get("MYSQL_DB", "nutikodu"),
        autocommit=True,
    )


def init_db():
    db = _db()
    cur = db.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(64) UNIQUE NOT NULL,
            salt VARCHAR(64) NOT NULL,
            hash VARCHAR(128) NOT NULL,
            role ENUM('admin','user') DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)
    cur.close()
    db.close()
    _migrate_from_json()


def _migrate_from_json():
    from pathlib import Path
    import json
    old = Path(__file__).parent / "users.json"
    if not old.exists():
        # Loo admin .env-st kui tabelis pole ühtegi kasutajat
        db = _db()
        cur = db.cursor()
        cur.execute("SELECT COUNT(*) FROM users")
        count = cur.fetchone()[0]
        cur.close(); db.close()
        if count == 0:
            admin_user = os.environ.get("ADMIN_USER", "admin")
            admin_pass = os.environ.get("ADMIN_PASSWORD", "")
            if admin_pass:
                add_user(admin_user, admin_pass, "admin")
        return
    data = json.loads(old.read_text())
    db = _db()
    cur = db.cursor()
    for username, v in data.items():
        cur.execute("SELECT id FROM users WHERE username=%s", (username,))
        if not cur.fetchone():
            cur.execute(
                "INSERT INTO users (username, salt, hash, role) VALUES (%s,%s,%s,%s)",
                (username, v["salt"], v["hash"], v.get("role", "user")),
            )
    cur.close(); db.close()
    old.rename(old.with_suffix(".json.bak"))
    print("Kasutajad migreeritud users.json -> MySQL")


def _hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()


def login(username: str, password: str) -> str:
    db = _db()
    cur = db.cursor(dictionary=True)
    cur.execute("SELECT * FROM users WHERE username=%s", (username,))
    u = cur.fetchone()
    cur.close(); db.close()
    if not u or _hash(password, u["salt"]) != u["hash"]:
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
    db = _db()
    cur = db.cursor(dictionary=True)
    cur.execute("SELECT username, role, created_at FROM users ORDER BY created_at")
    rows = cur.fetchall()
    cur.close(); db.close()
    return [{"username": r["username"], "role": r["role"],
             "created_at": r["created_at"].isoformat() if r["created_at"] else None}
            for r in rows]


def add_user(username: str, password: str, role: str = "user"):
    if not username or not password:
        raise HTTPException(400, "Kasutajanimi ja parool on kohustuslikud")
    salt = secrets.token_hex(16)
    h = _hash(password, salt)
    db = _db()
    cur = db.cursor()
    try:
        cur.execute(
            "INSERT INTO users (username, salt, hash, role) VALUES (%s,%s,%s,%s)",
            (username, salt, h, role),
        )
    except mysql.connector.IntegrityError:
        raise HTTPException(409, "Kasutaja on juba olemas")
    finally:
        cur.close(); db.close()


def delete_user(username: str, current_user: str):
    if username == current_user:
        raise HTTPException(400, "Ei saa iseennast kustutada")
    db = _db()
    cur = db.cursor()
    cur.execute("DELETE FROM users WHERE username=%s", (username,))
    if cur.rowcount == 0:
        cur.close(); db.close()
        raise HTTPException(404, "Kasutajat ei leitud")
    cur.close(); db.close()
    for token, u in list(_sessions.items()):
        if u == username:
            _sessions.pop(token, None)


def change_password(username: str, new_password: str):
    if not new_password:
        raise HTTPException(400, "Parool ei tohi olla tühi")
    salt = secrets.token_hex(16)
    h = _hash(new_password, salt)
    db = _db()
    cur = db.cursor()
    cur.execute("UPDATE users SET salt=%s, hash=%s WHERE username=%s", (salt, h, username))
    if cur.rowcount == 0:
        cur.close(); db.close()
        raise HTTPException(404, "Kasutajat ei leitud")
    cur.close(); db.close()
