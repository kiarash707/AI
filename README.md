# KAYRO AI

Persian-first AI agent workspace (React + TypeScript + Vite; Cloudflare Worker + D1). This is an early implementation; passing CI does not mean every planned agent/integration feature is shipped.

## Current implementation
- Responsive Persian RTL workspace, dashboard, chat interface, settings, and model views.
- D1-backed conversation/message endpoints and OpenRouter model discovery. A model is accepted as free only when both input and output prices are explicitly zero.
- Telegram webhook handler with secret-header verification, update de-duplication, `/new`, `/chats`, and shared conversation IDs.
- Chrome Manifest V3 scaffold. Secure pairing and browser-action execution are not implemented yet.
- Design system in `design-system/kayro-ai/MASTER.md`.

## Continuous integration
GitHub Actions runs on pushes and pull requests to `main`. It runs frontend TypeScript, Worker TypeScript, unit tests, and a Vite production build. The tests cover strict zero-price filtering and Persian task routing. See [CI runs](https://github.com/kiarash707/AI/actions).

## Deploy to Cloudflare
The deployment workflow is [deploy-cloudflare.yml](.github/workflows/deploy-cloudflare.yml). It automatically finds or creates the `kayro-ai` D1 database, supplies its real ID to Wrangler only inside the GitHub runner, applies remote migrations, builds, deploys the Worker + static assets, and runs a health smoke-test. The ID and secret values are never committed to the repository.

### One-time GitHub setup
In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:

1. `CLOUDFLARE_API_TOKEN` — create an account API token with Workers Scripts **Admin** permission for initial Worker creation and D1 **Edit/Write** permission for database creation and migrations. Do not use your Global API Key.
2. `CLOUDFLARE_ACCOUNT_ID` — the account ID shown on the Cloudflare Dashboard overview page.

Then open **Actions → Deploy KAYRO AI to Cloudflare Workers → Run workflow** and select `main`. Future pushes to `main` deploy automatically. View the result and website URL in that workflow's summary.

Optional secrets (add in the same GitHub screen):
- `AI_CREDENTIALS_ENCRYPTION_KEY` — a persistent Base64 encoding of 32 random bytes; required before saving a provider key in AI settings. Keep a secure backup and do not rotate it after credentials have been stored unless you intend to re-encrypt them.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` — if both are configured, the workflow uploads them as Worker secrets and registers the Telegram webhook.

If the workflow fails with a permissions error, update the API token with the missing account-level permission; do not paste the token into chat or commit it to GitHub. The Cloudflare connector was not available to the deployment process, so the first real deployment still needs these GitHub secrets.

### Secure the deployed Worker before using the API
The app intentionally fails closed until Cloudflare Access is enabled and owner identity is configured:

1. In Cloudflare, open **Workers & Pages → kayro-ai → Settings → Domains & Routes** and enable **Cloudflare Access** for the Worker. Allow only your verified sign-in email. Protect production traffic, not just previews.
2. Open the Worker's **Settings → Variables and Secrets** and add these plain-text Worker variables:
   - `ACCESS_TEAM_DOMAIN`: your Cloudflare Zero Trust team domain, such as `team-name.cloudflareaccess.com` (no path).
   - `ACCESS_AUD`: the Access application's Audience (AUD) tag.
   - `KAYRO_OWNER_EMAIL`: the exact email authorized to administer this KAYRO workspace.
3. Set `AI_CREDENTIALS_ENCRYPTION_KEY` as a Worker Secret if you did not add it as a GitHub Actions secret. It must decode to exactly 32 bytes. This is separate from the OpenRouter key.
4. After Access and encryption are configured, open the deployed website, enter your OpenRouter API key in **هوش مصنوعی و API**, test the connection, and save. The key is AES-GCM encrypted in D1; the browser receives only a masked value.
5. For Telegram, enter your numeric owner ID in the settings page. The owner ID is not an authentication mechanism by itself; the Worker still requires valid Cloudflare Access for its settings APIs.

The workflow uses `wrangler deploy --keep-vars`, so Worker variables set in the dashboard are preserved on subsequent releases. Same-origin requests are allowed; cross-origin requests require the explicit `ALLOWED_ORIGIN` allowlist. Do not set `DEV_MODE=true` in production.

## Local development
`npm ci && npm run dev` starts the Vite UI. API calls require a local/deployed Worker at `/api`. For local-only Worker smoke tests, create an ignored `.dev.vars` containing a random Base64 32-byte `AI_CREDENTIALS_ENCRYPTION_KEY`, then run `npx wrangler dev --env dev --var DEV_MODE:true`. Never deploy with the local bypass.

## Known limitations
This version does not yet implement general user accounts/invites/role sharing, task orchestration, audit/approval workflow, full Telegram owner-verification lifecycle, encrypted third-party connections, Chrome pairing/action execution, streaming responses, or file uploads. A successful CI run confirms type checks, unit tests, and frontend build only; it does not confirm a live OpenRouter response or prove that all planned features are implemented.
