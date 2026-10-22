# KAYRO AI

Persian-first AI workspace built with React, TypeScript, Vite, Cloudflare Pages Functions, and D1.

## Current behavior

- The main site and chat are public: **opening the website does not require an account, login, or email code**.
- Chat history is scoped to a secure, anonymous, HttpOnly browser cookie. It remains available in the same browser; clearing cookies or using another browser starts a separate history.
- Conversations created in a public browser are isolated from the Telegram owner's private conversations.
- Owner-only endpoints for OpenRouter and Telegram settings are protected by Cloudflare Access on the API paths only. The root page and public chat endpoints are not behind Access.
- Provider keys are encrypted with AES-GCM in D1 and are never returned to the frontend.
- Only OpenRouter models with explicit zero input and output prices are eligible. A free model may still be unavailable or rate-limited.

## Continuous integration

GitHub Actions on pushes and pull requests runs:
- TypeScript checks for the frontend, Worker, and Pages Functions.
- Unit tests for zero-price model filtering, task routing, and anonymous-session cookies.
- Production build and a deployable bundle artifact.

See [CI runs](https://github.com/kiarash707/AI/actions).

## Cloudflare Pages deployment

The Cloudflare Pages project `kayro-ai` has been created, its dedicated D1 database is connected, and its production variables are configured. A production deployment has **not** yet been published.

### Automatic deployment (recommended)

Add these GitHub repository secrets under **Settings → Secrets and variables → Actions**:

1. `CLOUDFLARE_API_TOKEN`: a Cloudflare API token scoped to this account with **Cloudflare Pages: Edit**. Do not use a Global API Key and never paste the token into chat.
2. `CLOUDFLARE_ACCOUNT_ID`: the account ID shown in Cloudflare Dashboard. For the currently connected account, it is `d800fbf453d1edd2f9172a5a172e7792`.

After they are saved, run **Actions → Deploy KAYRO AI to Cloudflare Pages → Run workflow**, using branch `main`. Future pushes deploy automatically. If the secrets are not set, the deploy job is skipped with a notice while CI still runs.

### One-time manual deployment

The latest successful `KAYRO AI CI` run uploads a `kayro-ai-deploy-<commit>` artifact ZIP. Download it from the run's **Artifacts** section, then in Cloudflare Dashboard open **Workers & Pages → Pages → kayro-ai → Create a new deployment → Production** and upload that ZIP. Do not extract or edit the ZIP before upload. The bundle contains the static site and the Pages `_worker.js` API handler.

Once deployment completes, test:
- Public site: `https://kayro-ai.pages.dev`
- Health: `https://kayro-ai.pages.dev/api/health`
- The health endpoint should return `ok: true` and `database: "ok"`.

## Owner settings and AI setup

Opening the public site does not require login. Only the sensitive API settings routes (`/api/ai/*` and `/api/settings*`) require the owner email code through Cloudflare Access. On the AI settings page, use **بازکردن درگاه امن تنظیمات**, complete the owner check in the new tab, then return to the site and refresh the page.

After deployment:
1. Open **هوش مصنوعی و API**.
2. Enter a fresh OpenRouter API key, test it, and save it. Never commit a provider key to GitHub.
3. The site will then show available zero-priced models. No paid-model fallback is used.

The encryption secret and Access configuration are stored in the Cloudflare Pages project's production settings, not in frontend code. Telegram is not production-ready until its bot token, webhook secret, and owner numeric ID are configured separately.

## Known limitations

The Chrome extension is still a scaffold; secure pairing and browser action execution are not complete. The app also does not yet provide general user accounts/invites, complete task orchestration, all third-party integrations, file uploads, or guaranteed model availability. Passing CI validates type checks, tests, and build output; it does not substitute for the post-deployment health and chat tests above.
