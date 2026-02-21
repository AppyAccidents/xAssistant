# XBMA API – Cloudflare Worker

Backend for the X Bookmarks Analyzer Chrome extension.

## What it does

| Route | Purpose |
|---|---|
| `POST /webhook/bmc` | Receives BuyMeACoffee subscription events, creates/updates subscriber records, sends activation emails |
| `POST /verify` | Extension calls this to verify a user's activation token and get their tier/quota |
| `POST /analyze` | Gemini Pro proxy – your API key stays here, never in the extension |
| `GET  /health` | Health check |

## One-time setup

### 1. Create KV namespaces

```bash
cd worker
npx wrangler kv:namespace create SUBSCRIBERS
npx wrangler kv:namespace create RATE_LIMITS
```

Copy the output IDs into `wrangler.toml`.

### 2. Set secrets

```bash
npx wrangler secret put GEMINI_PRO_API_KEY   # your Gemini Pro key from AI Studio
npx wrangler secret put BMC_WEBHOOK_SECRET   # from BMC dashboard → Webhooks
npx wrangler secret put RESEND_API_KEY       # from resend.com
npx wrangler secret put TOKEN_HMAC_SECRET    # any random 32-char string
```

### 3. Configure Resend

- Sign up at resend.com (free: 3,000 emails/mo)
- Add and verify your domain
- Update the `from:` address in `src/handlers/shared.js` → `sendActivationEmail()`

### 4. Deploy

```bash
npm install
npm run deploy
```

Note the deployed URL, e.g. `https://xbma-api.YOUR_SUBDOMAIN.workers.dev`

### 5. Configure BMC webhook

- Go to BuyMeACoffee → Settings → Webhooks
- Add: `https://xbma-api.YOUR_SUBDOMAIN.workers.dev/webhook/bmc`
- Copy the secret into `wrangler secret put BMC_WEBHOOK_SECRET`

### 6. Update the extension

In `src/providers/gemini.js` update `WORKER_URL` to your deployed Worker URL.

## Security model

- **Gemini Pro API key** lives only in Cloudflare secrets. It is never sent to the browser.
- **Activation tokens** (`xbma_<40 hex chars>`) are generated server-side using HMAC-SHA256 and stored in KV.
- **Rate limiting** is enforced server-side (50 analyses/day per subscriber), not bypassable by the extension.
- **Subscription validity** is checked on every `/analyze` call against the KV expiry date. Cancellations take effect at the natural renewal date (grace period).
- The Worker validates BMC webhook signatures before processing any event.

## Local development

```bash
npm run dev
```

Then in the extension, set `WORKER_URL` to `http://localhost:8787`.
