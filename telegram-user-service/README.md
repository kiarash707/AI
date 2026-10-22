# KAYRO Telegram Account Bridge

A private Telethon service for the user's own Telegram account. It runs separately from Cloudflare Pages because an authenticated MTProto client needs a long-lived session and persistent storage.

## Security model

- The service does not expose API docs or an unauthenticated account API. All private routes require `Authorization: Bearer <KAYRO_BRIDGE_SECRET>`.
- Only the Cloudflare Worker should know the bridge secret. Never expose it to browser code or commit it.
- Keep `/data` on a Railway persistent volume. The `*.session` file is an account credential: anyone who obtains it may act as the account.
- Login code and optional 2-step password are submitted over the authenticated owner-only Cloudflare Access route and are not logged or persisted as plaintext.
- The `/send`, `/read`, and `/logout` endpoints require an explicit confirmation field.
- Message search and history are returned to the owner dashboard; this service deliberately does not forward Telegram message contents into an AI model.

## Required service variables

- `TELEGRAM_API_ID`: from https://my.telegram.org → API development tools.
- `TELEGRAM_API_HASH`: from the same page. Keep private.
- `KAYRO_BRIDGE_SECRET`: a cryptographically random secret, at least 32 characters.
- `TELEGRAM_SESSION_DIR`: optional; keep at `/data` when using a Railway volume.

Configure Railway root directory as `/telegram-user-service`, attach a persistent volume at `/data`, and set health-check path to `/health`.

## Private HTTP API

- `GET /status`
- `POST /auth/start` with `{ "phone": "+49…" }`
- `POST /auth/code` with `{ "code": "…" }`
- `POST /auth/password` with `{ "password": "…" }` when Telegram 2-step verification requests it
- `GET /dialogs?limit=30`
- `GET /dialogs/{peer}/messages?limit=30`
- `GET /search?q=term`
- `POST /send` with `{ "peer": "…", "message": "…", "confirm": true }`
- `POST /read` with `{ "peer": "…", "confirm": true }`
- `POST /logout` with `{ "confirm": true }`

This connects a personal Telegram client, not a Bot API bot. Telegram can choose to deliver the login code inside an official Telegram session rather than by SMS. API access is subject to Telegram's official API terms and rate limits.
