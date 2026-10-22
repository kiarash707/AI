"""Private Telegram user-account bridge for KAYRO AI.

This service intentionally does not send Telegram message contents to an AI model.
All state-changing actions require explicit confirmation from the authenticated UI.
"""
from __future__ import annotations

import asyncio
import hmac
import os
import re
import time
from datetime import timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from telethon import TelegramClient, errors, types, utils

APP_VERSION = "0.1.0"
SESSION_DIR = Path(os.getenv("TELEGRAM_SESSION_DIR", "/data"))
SESSION_PATH = SESSION_DIR / "kayro-user"
PHONE_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")
MAX_MESSAGE_CHARS = 4096
app = FastAPI(title="KAYRO Telegram Account Bridge", version=APP_VERSION, docs_url=None, redoc_url=None, openapi_url=None)

client: TelegramClient | None = None
pending_phone: str | None = None
pending_phone_code_hash: str | None = None
pending_password_required = False
operation_lock = asyncio.Lock()
request_times: dict[str, list[float]] = {}


class PhoneRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=16)


class CodeRequest(BaseModel):
    code: str = Field(min_length=3, max_length=12)


class PasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=512)


class SendRequest(BaseModel):
    peer: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    confirm: bool = False


class ReadRequest(BaseModel):
    peer: str = Field(min_length=1, max_length=160)
    confirm: bool = False


class LogoutRequest(BaseModel):
    confirm: bool = False


def _configured() -> bool:
    return bool(os.getenv("TELEGRAM_API_ID") and os.getenv("TELEGRAM_API_HASH"))


def _bridge_secret() -> str:
    return os.getenv("KAYRO_BRIDGE_SECRET", "")


async def require_bridge(authorization: str | None = Header(default=None)) -> None:
    expected = _bridge_secret()
    if len(expected) < 32:
        raise HTTPException(status_code=503, detail="Bridge authentication is not configured.")
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Unauthorized.")


def _limit(key: str, count: int, window: int = 60) -> None:
    now = time.monotonic()
    recent = [t for t in request_times.get(key, []) if now - t < window]
    if len(recent) >= count:
        raise HTTPException(status_code=429, detail="Too many requests; try again shortly.")
    recent.append(now)
    request_times[key] = recent


def _safe_error(exc: Exception) -> str:
    if isinstance(exc, errors.FloodWaitError):
        return f"Telegram asked us to wait {min(exc.seconds, 3600)} seconds before retrying."
    if isinstance(exc, errors.PhoneCodeInvalidError):
        return "The login code is incorrect."
    if isinstance(exc, errors.PhoneCodeExpiredError):
        return "The login code has expired; request a new one."
    if isinstance(exc, errors.PasswordHashInvalidError):
        return "The Telegram two-step-verification password is incorrect."
    if isinstance(exc, errors.SessionPasswordNeededError):
        return "This account requires its Telegram two-step-verification password."
    return "Telegram request failed. Check the account connection and try again."


async def _get_client() -> TelegramClient:
    global client
    if not _configured():
        raise HTTPException(status_code=503, detail="Set TELEGRAM_API_ID and TELEGRAM_API_HASH on the service first.")
    if not _bridge_secret() or len(_bridge_secret()) < 32:
        raise HTTPException(status_code=503, detail="Set a strong KAYRO_BRIDGE_SECRET on the service first.")
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(SESSION_DIR, 0o700)
    except OSError:
        pass
    if client is None:
        try:
            client = TelegramClient(
                str(SESSION_PATH),
                int(os.environ["TELEGRAM_API_ID"]),
                os.environ["TELEGRAM_API_HASH"],
                connection_retries=3,
                request_retries=2,
                auto_reconnect=True,
                sequential_updates=True,
                flood_sleep_threshold=20,
            )
            await client.connect()
            try:
                os.chmod(str(SESSION_PATH) + ".session", 0o600)
            except OSError:
                pass
        except Exception as exc:
            client = None
            raise HTTPException(status_code=503, detail=_safe_error(exc)) from None
    elif not client.is_connected():
        try:
            await client.connect()
        except Exception as exc:
            raise HTTPException(status_code=503, detail=_safe_error(exc)) from None
    return client


async def _authorized() -> TelegramClient:
    tg = await _get_client()
    try:
        if not await tg.is_user_authorized():
            raise HTTPException(status_code=409, detail="Connect your Telegram account first.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=_safe_error(exc)) from None
    return tg


def _user_summary(user: Any) -> dict[str, Any]:
    if not user:
        return {}
    name = " ".join(part for part in [getattr(user, "first_name", None), getattr(user, "last_name", None)] if part)
    return {
        "id": str(user.id),
        "name": name or "Telegram account",
        "username": getattr(user, "username", None),
        "phone": None,
        "is_bot": bool(getattr(user, "bot", False)),
    }


def _peer_input(value: str) -> str | int:
    value = value.strip()
    if value == "me":
        return "me"
    if re.fullmatch(r"-?[0-9]{1,22}", value):
        return int(value)
    return value.lstrip("@") if re.fullmatch(r"@?[A-Za-z][A-Za-z0-9_]{3,31}", value) else value


def _dialog_type(entity: Any) -> str:
    if isinstance(entity, types.User):
        return "bot" if entity.bot else "user"
    if isinstance(entity, types.Channel):
        return "channel" if entity.broadcast else "supergroup"
    if isinstance(entity, types.Chat):
        return "group"
    return "unknown"


def _message_summary(message: Any) -> dict[str, Any]:
    date = message.date.astimezone(timezone.utc).isoformat() if message.date else None
    return {
        "id": int(message.id),
        "date": date,
        "out": bool(message.out),
        "sender_id": str(message.sender_id) if message.sender_id is not None else None,
        "text": (message.message or "")[:4096],
        "has_media": bool(message.media),
        "media_type": type(message.media).__name__ if message.media else None,
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    # Public health check contains no identifiers, configuration values or session state.
    return {"ok": True, "service": "kayro-telegram-bridge", "version": APP_VERSION}


@app.get("/status", dependencies=[Depends(require_bridge)])
async def status() -> dict[str, Any]:
    configured = _configured() and len(_bridge_secret()) >= 32
    if not configured:
        return {"configured": False, "authorized": False, "account": None}
    tg = await _get_client()
    try:
        authorized = await tg.is_user_authorized()
        me = await tg.get_me() if authorized else None
        account = _user_summary(me)
        if me and getattr(me, "phone", None):
            account["phone"] = "••••" + str(me.phone)[-4:]
        return {"configured": True, "authorized": bool(authorized), "account": account or None}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=_safe_error(exc)) from None


@app.post("/auth/start", dependencies=[Depends(require_bridge)])
async def auth_start(body: PhoneRequest) -> dict[str, Any]:
    global pending_phone, pending_phone_code_hash, pending_password_required
    _limit("auth-start", 3, 600)
    phone = body.phone.strip()
    if not PHONE_RE.fullmatch(phone):
        raise HTTPException(status_code=422, detail="Enter the phone number in international format, for example +491234567890.")
    async with operation_lock:
        tg = await _get_client()
        if await tg.is_user_authorized():
            raise HTTPException(status_code=409, detail="A Telegram account is already connected. Disconnect it before linking another account.")
        try:
            sent = await tg.send_code_request(phone)
            pending_phone = phone
            pending_phone_code_hash = sent.phone_code_hash
            pending_password_required = False
            return {"ok": True, "code_sent": True, "delivery": type(sent.type).__name__, "message": "Enter the code Telegram delivered in the official app or via its chosen delivery method."}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=_safe_error(exc)) from None


@app.post("/auth/code", dependencies=[Depends(require_bridge)])
async def auth_code(body: CodeRequest) -> dict[str, Any]:
    global pending_phone, pending_phone_code_hash, pending_password_required
    _limit("auth-code", 6, 600)
    if not pending_phone or not pending_phone_code_hash:
        raise HTTPException(status_code=409, detail="Request a fresh login code first.")
    code = body.code.strip().replace(" ", "")
    if not re.fullmatch(r"[0-9]{3,12}", code):
        raise HTTPException(status_code=422, detail="The login code format is invalid.")
    async with operation_lock:
        tg = await _get_client()
        try:
            await tg.sign_in(phone=pending_phone, code=code, phone_code_hash=pending_phone_code_hash)
            me = await tg.get_me()
            pending_phone = None
            pending_phone_code_hash = None
            pending_password_required = False
            return {"ok": True, "requires_password": False, "account": _user_summary(me)}
        except errors.SessionPasswordNeededError:
            pending_password_required = True
            return {"ok": True, "requires_password": True, "message": "Enter your Telegram two-step-verification password. This is not stored."}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=_safe_error(exc)) from None


@app.post("/auth/password", dependencies=[Depends(require_bridge)])
async def auth_password(body: PasswordRequest) -> dict[str, Any]:
    global pending_phone, pending_phone_code_hash, pending_password_required
    _limit("auth-password", 5, 600)
    if not pending_phone or not pending_password_required:
        raise HTTPException(status_code=409, detail="A two-step-verification password is not currently requested.")
    async with operation_lock:
        tg = await _get_client()
        try:
            await tg.sign_in(password=body.password)
            me = await tg.get_me()
            pending_phone = None
            pending_phone_code_hash = None
            pending_password_required = False
            return {"ok": True, "requires_password": False, "account": _user_summary(me)}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=_safe_error(exc)) from None


@app.post("/logout", dependencies=[Depends(require_bridge)])
async def logout(body: LogoutRequest) -> dict[str, Any]:
    global client, pending_phone, pending_phone_code_hash, pending_password_required
    if body.confirm is not True:
        raise HTTPException(status_code=422, detail="Explicit confirmation is required.")
    async with operation_lock:
        tg = await _get_client()
        try:
            if await tg.is_user_authorized():
                await tg.log_out()
            await tg.disconnect()
            client = None
            pending_phone = None
            pending_phone_code_hash = None
            pending_password_required = False
            try:
                Path(str(SESSION_PATH) + ".session").unlink(missing_ok=True)
            except OSError:
                pass
            return {"ok": True, "authorized": False}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=_safe_error(exc)) from None


@app.get("/dialogs", dependencies=[Depends(require_bridge)])
async def dialogs(limit: int = Query(default=30, ge=1, le=100)) -> dict[str, Any]:
    tg = await _authorized()
    try:
        items = []
        async for dialog in tg.iter_dialogs(limit=limit):
            entity = dialog.entity
            items.append({
                "id": str(dialog.id),
                "title": str(dialog.name or "Untitled dialog")[:160],
                "type": _dialog_type(entity),
                "username": getattr(entity, "username", None),
                "unread_count": int(dialog.unread_count or 0),
                "pinned": bool(dialog.pinned),
                "last_message_date": dialog.date.astimezone(timezone.utc).isoformat() if dialog.date else None,
            })
        return {"items": items, "count": len(items)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=_safe_error(exc)) from None


@app.get("/dialogs/{peer}/messages", dependencies=[Depends(require_bridge)])
async def messages(peer: str, limit: int = Query(default=30, ge=1, le=100)) -> dict[str, Any]:
    tg = await _authorized()
    async with operation_lock:
        try:
            entity = await tg.get_entity(_peer_input(peer))
            items = []
            async for message in tg.iter_messages(entity, limit=limit):
                items.append(_message_summary(message))
            items.reverse()
            return {"peer": peer, "items": items, "count": len(items)}
        except Exception as exc:
            raise HTTPException(status_code=404, detail=_safe_error(exc)) from None


@app.get("/search", dependencies=[Depends(require_bridge)])
async def search(q: str = Query(min_length=2, max_length=120), max_dialogs: int = Query(default=12, ge=1, le=20)) -> dict[str, Any]:
    tg = await _authorized()
    _limit("search", 5, 60)
    term = q.strip()
    if not term:
        raise HTTPException(status_code=422, detail="Enter a search term.")
    async with operation_lock:
        try:
            found: list[dict[str, Any]] = []
            async for dialog in tg.iter_dialogs(limit=max_dialogs):
                async for message in tg.iter_messages(dialog.entity, search=term, limit=3):
                    item = _message_summary(message)
                    item["peer_id"] = str(dialog.id)
                    item["peer_title"] = str(dialog.name or "Untitled dialog")[:160]
                    found.append(item)
                    if len(found) >= 30:
                        return {"query": term, "items": found, "count": len(found)}
            return {"query": term, "items": found, "count": len(found)}
        except Exception as exc:
            raise HTTPException(status_code=502, detail=_safe_error(exc)) from None


@app.post("/send", dependencies=[Depends(require_bridge)])
async def send_message(body: SendRequest) -> dict[str, Any]:
    tg = await _authorized()
    _limit("send", 15, 60)
    if body.confirm is not True:
        raise HTTPException(status_code=422, detail="Explicit send confirmation is required.")
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Message cannot be empty.")
    async with operation_lock:
        try:
            entity = await tg.get_entity(_peer_input(body.peer))
            sent = await tg.send_message(entity, message, link_preview=False)
            return {"ok": True, "peer": body.peer, "message_id": int(sent.id), "sent_at": sent.date.astimezone(timezone.utc).isoformat()}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=_safe_error(exc)) from None


@app.post("/read", dependencies=[Depends(require_bridge)])
async def mark_read(body: ReadRequest) -> dict[str, Any]:
    tg = await _authorized()
    if body.confirm is not True:
        raise HTTPException(status_code=422, detail="Explicit confirmation is required.")
    async with operation_lock:
        try:
            entity = await tg.get_entity(_peer_input(body.peer))
            await tg.send_read_acknowledge(entity)
            return {"ok": True, "peer": body.peer, "read": True}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=_safe_error(exc)) from None
