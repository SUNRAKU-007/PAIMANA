"""
auth.py -- Authentication & Authorization for PAIMANA Backend
Password hashing with passlib/bcrypt, JWT tokens with python-jose,
JSON-backed user store at ./data/users.json with demo seed accounts.
"""

import os
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

# Workaround for passlib with bcrypt >= 4.0.0 / 5.0.0
import bcrypt
if not hasattr(bcrypt, "__about__"):
    class _About:
        __version__ = getattr(bcrypt, "__version__", "5.0.0")
    bcrypt.__about__ = _About()

import passlib.handlers.bcrypt
passlib.handlers.bcrypt._BcryptCommon._workrounds_initialized = True

from passlib.context import CryptContext
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

load_dotenv()
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv(os.path.join(BASE_DIR, "..", ".env"))

# ── JWT Configuration ──────────────────────────────────────────────────
SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY:
    # Fallback to generating one and persisting to .env if needed
    SECRET_KEY = secrets.token_hex(32)

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

# ── Password Hashing ───────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


VALID_ROLES = {"admin", "field_officer", "public", "contractor"}


# ── User Store Helper ──────────────────────────────────────────────────
def _get_users_file_path() -> str:
    candidates = [
        os.path.join(".", "data", "users.json"),
        os.path.join("data", "users.json"),
        os.path.join(BASE_DIR, "data", "users.json"),
        os.path.join(BASE_DIR, "..", "data", "users.json"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    # Default path is ./data/users.json relative to current directory or BASE_DIR
    target = os.path.join(".", "data", "users.json")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    return os.path.abspath(target)


def init_user_store():
    """Seed ./data/users.json with demo accounts if it does not exist."""
    file_path = _get_users_file_path()
    if not os.path.exists(file_path):
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        demo_users = [
            {
                "id": "admin",
                "username": "admin",
                "hashed_password": pwd_context.hash("admin123"),
                "role": "admin",
                "full_name": "System Admin",
                "is_verified": True,
            },
            {
                "id": "officer1",
                "username": "officer1",
                "hashed_password": pwd_context.hash("officer123"),
                "role": "field_officer",
                "full_name": "Field Officer",
                "is_verified": True,
            },
            {
                "id": "demo_user",
                "username": "demo_user",
                "hashed_password": pwd_context.hash("demo123"),
                "role": "public",
                "full_name": "Demo Citizen",
                "is_verified": True,
            },
        ]
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump({"users": demo_users}, f, indent=2)
        print(f"Initialized user store at {file_path} with 3 demo accounts.")


def load_users() -> list:
    """Read users list from JSON store, ensuring is_verified is populated."""
    init_user_store()
    file_path = _get_users_file_path()
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            users = data.get("users", [])
            for u in users:
                if "is_verified" not in u:
                    # Existing users (admin, officer1, demo_user, etc.) are treated as verified
                    u["is_verified"] = False if u.get("role") == "contractor" else True
                if "id" not in u:
                    u["id"] = u.get("username")
            return users
    except Exception as e:
        print(f"Error reading users from {file_path}: {e}")
        return []


def save_users(users: list):
    """Write users list to JSON store."""
    file_path = _get_users_file_path()
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump({"users": users}, f, indent=2)


# Initialize store on import
init_user_store()


# ── Auth Functions ─────────────────────────────────────────────────────

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plaintext password against bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Generate bcrypt hash for a plaintext password."""
    return pwd_context.hash(password)


def get_user(username: str) -> Optional[dict]:
    """Retrieve user dictionary by username."""
    users = load_users()
    for user in users:
        if user.get("username") == username:
            if "is_verified" not in user:
                user["is_verified"] = False if user.get("role") == "contractor" else True
            if "id" not in user:
                user["id"] = user.get("username")
            return user
    return None


def authenticate_user(username: str, password: str) -> Optional[dict]:
    """Verify username and password; return user dict on success, None on failure."""
    user = get_user(username)
    if not user:
        return None
    if not verify_password(password, user.get("hashed_password", "")):
        return None
    return user


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a signed JWT access token with expiry."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """FastAPI dependency to decode JWT and return current user, raising 401 if invalid/expired."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = get_user(username)
    if user is None:
        raise credentials_exception
    return user


def require_verified_user(current_user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency that blocks unverified contractors or field officers from accessing gated resources."""
    user_role = current_user.get("role")
    is_verified = current_user.get("is_verified", True if user_role not in ("contractor", "field_officer", "officer") else False)
    if user_role in ("contractor", "field_officer", "officer") and not is_verified:
        type_str = "field officer" if user_role in ("field_officer", "officer") else "contractor"
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Your {type_str} account is pending admin approval",
        )
    return current_user


def require_role(*allowed_roles: str):
    """Dependency factory that wraps get_current_user and raises 403 if role not in allowed_roles,
    or if an unverified user attempts access."""
    def role_checker(current_user: dict = Depends(get_current_user)) -> dict:
        user_role = current_user.get("role")
        is_verified = current_user.get("is_verified", True if user_role not in ("contractor", "field_officer", "officer") else False)
        if user_role in ("contractor", "field_officer", "officer") and not is_verified:
            type_str = "field officer" if user_role in ("field_officer", "officer") else "contractor"
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your {type_str} account is pending admin approval",
            )
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user_role}' is not authorized to access this resource",
            )
        return current_user
    return role_checker

