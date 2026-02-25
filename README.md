# X-Assistant (Minimal)

X-Assistant is a Chrome extension that extracts **X/Twitter Bookmarks and Likes** and exports reports.

## What It Does

- Extract bookmarks
- Extract likes
- Extract both in one run
- Export all stored records as:
  - `md`
  - `csv`
  - `txt`
  - `json`

Each record includes core fields: scope, author, tweet time (when available), captured time, text, media URLs, metrics, and tweet URL.

## UI Scope

The popup is intentionally minimal:

- `Extract Bookmarks`
- `Extract Likes`
- `Extract Both`
- `@username` input (for likes route)
- `Export Report` with format selector

## Build & Test

```bash
npm install
npm run build
npm test -- --runInBand
```

## Load in Chrome

1. Run `npm run build`
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked"
5. Select repository root

`manifest.json` loads runtime files from `dist/`.
