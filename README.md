# FilamuReel

A lean, single-process African cinema app built with Bun, React, and SQLite. Bun serves the UI and JSON API; the API uses Bun's built-in SQL interface. No separate API server, PostgreSQL service, or workspace setup is required.

## Requirements

- Bun 1.4 or newer

## Run locally

```sh
bun install
bun dev
```

The server starts the app and its API together. SQLite is initialized automatically on first run. Set `PORT` to use another port (default `3000`), or `HOST` to change the network interface it listens on (default `0.0.0.0`).

### Open the development app on a phone

Run `bun dev` on the computer hosting the project, then open `http://<computer-LAN-IP>:3000` on a phone connected to the same network. For example, use `http://192.168.1.20:3000` if that is the computer's local IP. Allow Bun through the computer's firewall if the phone cannot connect.

Do not serve `dist/` with a static file server such as `bunx serve` when you need the working app. `bun run build` creates browser assets only; it does not include the SQLite database or `/api/*` backend routes, so data requests return 404. Run the integrated Bun app server (`bun dev` for local development, or `bun start` for production) instead. The frontend calls `/api/*` on the same host and port that serves the app.

Local development seeds demo accounts:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@filamureel.local` | `ReelAdmin2026!` |
| Creator | `creator@filamureel.local` | `ReelCreator2026!` |
| Audience | `audience@filamureel.local` | `ReelAudience2026!` |

These credentials and seeded accounts are for local demos only. Never deploy them or use them for real accounts.

## Build and run

```sh
bun run build
bun start
```

`bun start` runs the integrated app and API server; it is not a static server for the generated `dist/` directory. Production startup requires `ADMIN_PASSWORD` with at least 12 characters (see **Accounts and roles**). Binding to `0.0.0.0` makes the server reachable from other devices on the LAN; restrict network access with the host firewall and do not expose a demo or development instance to an untrusted network.

## Install as an app

FilamuReel includes a web app manifest, Reel wordmark icons, and a service worker that caches the app shell and an offline page. API responses and uploaded media are deliberately not cached. Production deployments must use HTTPS (localhost is considered secure for development).

On supported Android and desktop browsers, the install banner appears after a short delay when the browser signals that installation is available. On iPhone and iPad, use **Share → Add to Home Screen**; iOS does not provide the same automatic install prompt. The banner can be dismissed and won't be shown again in that browser profile.

## Accounts and roles

- Audience and creator users can register, sign in, and sign out. Personal progress and watchlists are account-scoped.
- Creators can manage their own films and view account-based playback analytics.
- Creators can upload videos directly to a selected Reel section from Creator Studio, optionally associate a published film, and track moderation status.
- Creators can still submit a film's existing trailer from My Films.
- Administrators can manage real accounts, films, Reel submissions, reviews, subscriptions, and plans; view platform analytics and the admin audit log.
- Local demo accounts are excluded from platform analytics.
- Production startup requires `ADMIN_PASSWORD` with at least 12 characters. Set `ADMIN_EMAIL` to change the bootstrap administrator email (default `admin@filamureel.local`). Configure these in the deployment environment, not in source control.

## Media, payments, and analytics

Playback supports play/pause, seeking, resume/start over, saved progress, trailer tracking, custom FilamuReel loading/buffering UI, and a three-hour viewing prompt. Creator Studio accepts local JPEG, PNG, and WebP poster uploads up to 10 MB and MP4, WebM, and QuickTime video uploads up to 500 MB. Files are stored in `uploads/` (override with `UPLOAD_DIR`) and served by the same Bun server.

Seeded films have no playable video sources; upload or configure media before end-to-end playback can be tested. Production media hosting, delivery, and transcoding are not configured.

### The Reel

Creators use **Creator Studio → Reel uploads** to select **Clips & trailers**, **Interviews**, **Podcasts**, or **Marketing**, then provide a media URL or upload the media file. Podcast uploads support audio (MP3, M4A, WAV, OGG, AAC; 100 MB max) or video (MP4, WebM, QuickTime; 500 MB max); the other sections accept video. A thumbnail is optional; a published film can optionally be linked, but is not required. The selected section controls where the content appears. **My films** also offers a shortcut to submit a film's existing trailer to Clips & trailers. All uploads stay private until an administrator previews and publishes them in **Admin → The Reel**; admins can reject, hide, and feature published entries. Audiences can browse in a grid or scroll-snap vertical feed, react (like, love, fire, wow), and rate clips from one to five stars. Reactions and ratings require a registered audience account; demo accounts are excluded from public aggregate counts.

Plans are informational, and administrators can issue manual subscription entitlements. Checkout, payment-provider ingestion, verified live transactions, paid-access enforcement, creator payouts, account recovery, and email verification are not connected. Manual subscription grants are not payments. Revenue is reported only from successful verified transaction records; views are never used to estimate it.

See [ROADMAP.md](./ROADMAP.md) for remaining launch requirements and [WASM-VISION.md](./WASM-VISION.md) for an ambitious client-heavy architecture proposal focused on reducing origin workload.

## Validation

```sh
bun test
bunx tsc --noEmit
bun run build
```
