import os
import secrets
from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader, APIKeyQuery

API_KEY_ENV = "CAMERA_API_KEY"

_header_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)
_query_scheme = APIKeyQuery(name="api_key", auto_error=False)


def _get_required_key() -> str:
    key = os.environ.get(API_KEY_ENV, "")
    if not key:
        raise RuntimeError(
            f"Seadista API võti: export {API_KEY_ENV}=<sinu-salasõna>"
        )
    return key


def verify_key(
    header_key: str | None = Security(_header_scheme),
    query_key: str | None = Security(_query_scheme),
) -> str:
    provided = header_key or query_key
    if not provided or not secrets.compare_digest(provided, _get_required_key()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Vale või puuduv API võti",
        )
    return provided
