# Social Assistant

Social Assistant is a Chrome extension that extracts social content into a local, exportable archive.

Current platform support:

- X / Twitter:
  - `Bookmarks`
  - `Likes`
- Instagram:
  - `Saved`

## What It Does

- Extract one target at a time or all supported targets for the selected platform
- Store records locally in `chrome.storage.local`
- Export mixed-platform datasets as:
  - `md`
  - `csv`
  - `txt`
  - `json`
- Migrate older X-only storage into the current multi-platform schema automatically

## Canonical Record Model

Stored records use a platform-neutral schema:

- `id`
- `platform`
- `target`
- `url`
- `capturedAt`
- `postedAt`
- `author`
- `text`
- `media`
- `metrics`
- `source`
- `meta`

Notes:

- Generic metrics stay at the top level when they apply across platforms, such as `likes`, `replies`, and `views`.
- Platform-specific metrics live under `metrics.platform`, such as X/Twitter `retweets`.
- Legacy X records with `tweetPostedAt` are migrated to `postedAt`.

## Popup Flow

The popup is now platform-first:

1. Choose a platform
2. Choose a target or `All Supported Targets`
3. Provide platform-specific input when required
4. Run extraction
5. Export the combined dataset

Current inputs:

- X / Twitter `Likes` requires `@username`
- Instagram `Saved` requires `@username` so the extension can open the username-scoped saved route on web

## Architecture

The extension is organized around a small multi-platform extraction framework:

- Shared contracts define canonical records, settings, and messaging payloads
- Platform adapters declare supported targets, route builders, route detection, validation, and parser entry points
- Background orchestration expands platform requests into per-target tasks
- Content scripts run adapter-aware extraction and scoped network caching
- Exporters render all formats from one canonical projection layer

## Storage and Migration

Storage schema version is now `3`.

Migration behavior:

- Existing X/Twitter records are preserved
- Legacy `scope` values become canonical `target` values
- Legacy `tweetPostedAt` becomes `postedAt`
- Legacy single-platform settings are moved into `settingsByPlatform`

## Testing

The test suite now covers:

- canonical contract validation
- storage migration to schema v3
- X DOM and network extraction behavior
- Instagram saved DOM extraction
- mixed-platform export output
- popup multi-platform behavior
- mixed-platform ingest/query/export smoke flow

Run checks with:

```bash
npm install
npm run build
npm test -- --runInBand
```

## Load in Chrome

1. Run `npm run build`
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click `Load unpacked`
5. Select the repository root

`manifest.json` loads runtime files from `dist/`.

## Current Scope

Implemented now:

- X / Twitter `Bookmarks`
- X / Twitter `Likes`
- Instagram `Saved`

Explicitly out of scope for this version:

- Instagram liked-post extraction
- Server-side sync or cloud storage
- AI enrichment in the popup flow
