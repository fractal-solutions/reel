# FilamuReel

A lean, single-process African cinema app built with Bun, React, and SQLite. Bun serves the React UI and JSON API; the API uses Bun's built-in SQL interface with a local SQLite database. The browser app does not need a separate API server or generated client package.

See [ROADMAP.md](./ROADMAP.md) for the current authentication and video-player state, provisional features, recommended priorities, and open product/operational decisions.

## Requirements

- Bun 1.4 or newer

## Run locally

```sh
bun install
bun dev
```

The server prints its local URL on startup. The SQLite database is initialized automatically on first run; no PostgreSQL server or workspace setup is required.
Set `PORT` to use a different local port (the default is `3000`).

## Build and run

```sh
bun run build
bun start
```

## Main areas

- Home, film catalogue, film details, reviews, and editorial features
- Watchlist and continue-watching progress
- Creator dashboard, film publishing, real playback analytics, and payout status
- Subscription plan presentation

The creator/viewer identity is a demo identity, as in the source application. Authentication, subscription checkout, payment settlement, and payout processing are not connected. Earnings are deliberately not estimated from views. Playback statistics are based on viewing events recorded when a film is played. Local uploads are available, but production-scale media hosting and delivery are not configured.

Creator Studio accepts local JPEG, PNG, and WebP poster uploads up to 10 MB and MP4, WebM, and QuickTime video uploads up to 500 MB. Files are written to the local `uploads/` directory (override with `UPLOAD_DIR`) and served by the same Bun server. Uploaded media and the SQLite database are ignored by Git.
