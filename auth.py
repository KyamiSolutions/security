import hashlib
import os
import secrets
import mysql.connector
import pyotp
import qrcode
import qrcode.image.svg
from io import BytesIO
from fastapi import HTTPException, Request

_sessions: dict[str, str] = {}       # token -> username
_pending_2fa: dict[str, str] = {}    # temp_token -> username


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
            totp_secret VARCHAR(64) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)
    # Lisa totp_secret veerg kui puudub (olemasolev tabel)
    try:
        cur.execute("ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64) DEFAULT NULL")
    except mysql.connector.Error:
        pass
    cur.close()
    db.close()
    _migrate_from_json()


def _create_admin_from_env():
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
            print(f"Admin kasutaja loodud: {admin_user}")


def _migrate_from_json():
    from pathlib import Path
    import json
    old = Path(__file__).parent / "users.json"
    if not old.exists():
        _create_admin_from_env()
        return
    data = json.loads(old.read_text())
    if not isinstance(data, dict):
        old.rename(old.with_suffix(".json.bak"))
        _create_admin_from_env()
        return
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


def _get_user(username: str) -> dict | None:
    db = _db()
    cur = db.cursor(dictionary=True)
    cur.execute("SELECT * FROM users WHERE username=%s", (username,))
    u = cur.fetchone()
    cur.close(); db.close()
    return u


def login(username: str, password: str) -> dict:
    u = _get_user(username)
    if not u or _hash(password, u["salt"]) != u["hash"]:
        raise HTTPException(401, "Vale kasutajanimi või parool")
    if u["totp_secret"]:
        temp = secrets.token_hex(16)
        _pending_2fa[temp] = username
        return {"requires_2fa": True, "temp_token": temp}
    token = secrets.token_hex(32)
    _sessions[token] = username
    return {"requires_2fa": False, "token": token}


def verify_2fa(temp_token: str, code: str) -> str:
    username = _pending_2fa.get(temp_token)
    if not username:
        raise HTTPException(401, "Aegunud või vale 2FA sessioon")
    u = _get_user(username)
    if not u or not u["totp_secret"]:
        raise HTTPException(401, "2FA pole seadistatud")
    totp = pyotp.TOTP(u["totp_secret"])
    if not totp.verify(code, valid_window=1):
        raise HTTPException(401, "Vale 2FA kood")
    _pending_2fa.pop(temp_token, None)
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
    cur.execute("SELECT username, role, totp_secret, created_at FROM users ORDER BY created_at")
    rows = cur.fetchall()
    cur.close(); db.close()
    return [{"username": r["username"], "role": r["role"],
             "totp_enabled": bool(r["totp_secret"]),
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


def enable_2fa(username: str) -> dict:
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=username, issuer_name="Nutikodu")
    # QR kood SVG-na
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgImage)
    buf = BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode()
    if '?>' in svg:
        svg = svg.split('?>', 1)[-1].strip()
    db = _db()
    cur = db.cursor()
    cur.execute("UPDATE users SET totp_secret=%s WHERE username=%s", (secret, username))
    cur.close(); db.close()
    return {"secret": secret, "uri": uri, "qr_svg": svg}


def disable_2fa(username: str):
    db = _db()
    cur = db.cursor()
    cur.execute("UPDATE users SET totp_secret=NULL WHERE username=%s", (username,))
    cur.close(); db.close()


def get_2fa_status(username: str) -> bool:
    u = _get_user(username)
    return bool(u and u["totp_secret"])


def get_user_role(token: str) -> str:
    username = _sessions.get(token, "")
    if not username:
        return "user"
    u = _get_user(username)
    return u["role"] if u else "user"
