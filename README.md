# KAYRO AI

Persian-first AI agent workspace (React + TypeScript + Vite; Cloudflare Worker + D1 target). This checkout is an early implementation, not a production deployment.

## Current implementation

- RTL responsive workspace UI, dashboard, conversation history, AI settings and model views.
- D1-backed conversation/message APIs; input validation and owner-only production authorization via verified Cloudflare Access JWTs.
- AES-GCM encrypted OpenRouter credential management, masked readback, test/delete operations, zero-price text-model discovery, capability-aware routing, bounded model fallback, and per-owner rate limits.
- Telegram webhook with secret-header verification, duplicate-update protection, and shared AI/model settings for owner conversations.
- Chrome MV3 package scaffold (pairing API is not implemented yet).
- Design System in `design-system/kayro-ai/MASTER.md`.

## Local development

Install with `npm ci`. Generate a local-only encryption secret once: `printf 'AI_CREDENTIALS_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" > .dev.vars` (this file is ignored by Git). Run `npm run worker:dev` in one terminal and `npm run dev` in another; Vite proxies `/api` to the local Worker at port 8789. Apply local schema with `npx wrangler d1 migrations apply kayro-ai --local --env dev`. The local Worker bypass is supplied only by the `worker:dev` command and is not a production setting. Build/check: `npm run check && npm test && npm run format:check && npm run build`.

## AI API setup (Cloudflare; not yet deployed)

1. Create a D1 database and replace the placeholder database ID in `wrangler.toml`; apply migrations with `npx wrangler d1 migrations apply kayro-ai --remote`.
2. Configure Cloudflare Access to protect the Worker/site. Set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `KAYRO_OWNER_EMAIL` as Worker vars. API endpoints fail closed unless a valid Access JWT for that exact owner email is verified. Do not set `DEV_MODE` outside the local `dev` environment.
3. Generate an independent 32-byte encryption key and add it as a Worker Secret. Example: `openssl rand -base64 32 | npx wrangler secret put AI_CREDENTIALS_ENCRYPTION_KEY`. This is not the OpenRouter key. Keep it backed up securely: without it the stored credential cannot be decrypted.
4. Apply the SQL migration. From the site's **هوش مصنوعی و API** page, enter the OpenRouter key, test connectivity, choose automatic or a listed zero-input/zero-output model, then save. The OpenRouter credential is AES-GCM encrypted in D1; the browser receives only a last-four mask and status.
5. For local-only smoke tests, create an ignored `.dev.vars` containing a random Base64 32-byte `AI_CREDENTIALS_ENCRYPTION_KEY`; run `npx wrangler dev --env dev --var DEV_MODE:true`. `DEV_MODE` is supplied only as a local CLI argument, not configured in `wrangler.toml`, so production deployment remains fail-closed. Never deploy with the local bypass.
6. Telegram uses the same encrypted OpenRouter credential and model settings once its bot token, webhook secret, webhook, and verified numeric owner ID have been configured. Do not expose the Worker publicly without Access.
7. Never configure the OpenRouter key as a frontend variable or commit it. No `OPENROUTER_API_KEY` Worker secret is needed: the owner-managed key is encrypted in D1.

## Current limitations / safety

This version does not implement general account/invite/role management or tenant sharing; the current AI settings and API deliberately authorize only the configured Cloudflare Access owner. The Access JWT is verified (signature, issuer, audience, expiry, and owner email); production APIs fail closed if Access configuration is missing. Other remaining gaps include secure Telegram token management/owner OTP and webhook registration, task orchestration, audit/approval engine, encrypted third-party integrations, Chrome pairing/action execution, streaming responses, uploads, and automated production deployment. Telegram calls the same shared AI configuration when its webhook is configured and the owner ID is registered, but the complete Telegram account-verification lifecycle is not shipped. No deployment or real OpenRouter test was possible: Wrangler reported no authenticated Cloudflare account, and no API credential was safely configured on the server. Credentials shared in chat are not used; rotate any exposed key before entering a new one in the authenticated site.
