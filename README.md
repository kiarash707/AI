# KAYRO AI

Persian-first AI agent workspace (React + TypeScript + Vite; Cloudflare Worker + D1 target). This checkout is an early implementation, not a production deployment.

## Current implementation
- RTL responsive workspace UI, dashboard, chat history UI, settings/model views.
- D1-backed conversation/message endpoints and OpenRouter model discovery with strict zero input/output price filtering.
- Telegram webhook skeleton with Telegram secret-header verification, update de-duplication, `/new` and `/chats` starting points.
- Chrome MV3 package scaffold (pairing API is not implemented yet).
- Design System in `design-system/kayro-ai/MASTER.md`.

## Local UI
`npm install && npm run dev` (Vite serves on 0.0.0.0). API calls require a deployed/local Worker at `/api`; configure Vite proxy if running separate processes. Build/check: `npm run build`.

## Continuous integration
GitHub Actions runs on pushes and pull requests to `main`. The required checks are frontend TypeScript, Cloudflare Worker TypeScript, unit tests, and the Vite production build. The suite covers strict zero-price filtering (both prompt and completion must explicitly be zero) and Persian task classification. See [latest CI runs](https://github.com/kiarash707/AI/actions).

## AI API setup (Cloudflare; not yet deployed)
1. Create a D1 database and replace the placeholder database ID in `wrangler.toml`; apply migrations with `npx wrangler d1 migrations apply kayro-ai --remote`.
2. Configure Cloudflare Access to protect the Worker/site. Set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `KAYRO_OWNER_EMAIL` as Worker vars. API endpoints fail closed unless a valid Access JWT for that exact owner email is verified. Do not set `DEV_MODE` outside the local `dev` environment.
3. Generate an independent 32-byte encryption key and add it as a Worker Secret. Example: `openssl rand -base64 32 | npx wrangler secret put AI_CREDENTIALS_ENCRYPTION_KEY`. This is not the OpenRouter key. Keep it backed up securely: without it the stored credential cannot be decrypted.
4. Apply the SQL migration. From the site's **هوش مصنوعی و API** page, enter the OpenRouter key, test connectivity, choose automatic or a listed zero-input/zero-output model, then save. The OpenRouter credential is AES-GCM encrypted in D1; the browser receives only a last-four mask and status.
5. For local-only smoke tests, create an ignored `.dev.vars` containing a random Base64 32-byte `AI_CREDENTIALS_ENCRYPTION_KEY`; run `npx wrangler dev --env dev --var DEV_MODE:true`. `DEV_MODE` is supplied only as a local CLI argument, not configured in `wrangler.toml`, so production deployment remains fail-closed. Never deploy with the local bypass.
6. Telegram uses the same encrypted OpenRouter credential and model settings once its bot token, webhook secret, webhook, and verified numeric owner ID have been configured. Do not expose the Worker publicly without Access.
7. Never configure the OpenRouter key as a frontend variable or commit it. No `OPENROUTER_API_KEY` Worker secret is needed: the owner-managed key is encrypted in D1.

## Current limitations / safety
This version does not implement general account/invite/role management or tenant sharing; the current AI settings and API deliberately authorize only the configured Cloudflare Access owner. The Access JWT is verified (signature, issuer, audience, expiry, and owner email); production APIs fail closed if Access configuration is missing. Other remaining gaps include secure Telegram token management/owner OTP and webhook registration, task orchestration, audit/approval engine, encrypted third-party integrations, Chrome pairing/action execution, streaming responses, uploads, and production deployment. Telegram calls the same shared AI configuration when its webhook is configured and the owner ID is registered, but the complete Telegram account-verification lifecycle is not shipped. No production deployment or live OpenRouter test is confirmed. CI success means the code checks and frontend build pass; it does not mean a public site is deployed. Deployment still requires a real D1 database ID, `ALLOWED_ORIGIN`, Cloudflare Access settings, and Worker Secrets. A live OpenRouter connectivity test also requires the owner to enter a valid key through the secured settings page.
