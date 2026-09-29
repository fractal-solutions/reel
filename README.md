# FilamuReel

A lean, single-process African cinema app built with Bun, React, and SQLite. Bun serves the UI and JSON API; the API uses Bun's built-in SQL interface. No separate API server, PostgreSQL service, or workspace setup is required.

## Requirements

- Bun 1.4 or newer

## Run locally

```sh
bun install
bun dev
```

The server prints its local URL on startup. SQLite is initialized automatically on first run. Set `PORT` to use another port (default `3000`).

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

## Accounts and roles

- Audience and creator users can register, sign in, and sign out. Personal progress and watchlists are account-scoped.
- Creators can manage their own films and view account-based playback analytics.
- Administrators can manage real accounts, films, reviews, subscriptions, and plans; view platform analytics and the admin audit log.
- Local demo accounts are excluded from platform analytics.
- Production startup requires `ADMIN_PASSWORD` with at least 12 characters. Set `ADMIN_EMAIL` to change the bootstrap administrator email (default `admin@filamureel.local`). Configure these in the deployment environment, not in source control.

## Media, payments, and analytics

Playback supports play/pause, seeking, resume/start over, saved progress, trailer tracking, custom FilamuReel loading/buffering UI, and a three-hour viewing prompt. Creator Studio accepts local JPEG, PNG, and WebP poster uploads up to 10 MB and MP4, WebM, and QuickTime video uploads up to 500 MB. Files are stored in `uploads/` (override with `UPLOAD_DIR`) and served by the same Bun server.

Seeded films have no playable video sources; upload or configure media before end-to-end playback can be tested. Production media hosting, delivery, and transcoding are not configured.

Plans are informational, and administrators can issue manual subscription entitlements. Checkout, payment-provider ingestion, verified live transactions, paid-access enforcement, creator payouts, account recovery, and email verification are not connected. Manual subscription grants are not payments. Revenue is reported only from successful verified transaction records; views are never used to estimate it.

See [ROADMAP.md](./ROADMAP.md) for remaining launch requirements.

## Validation

```sh
bun test
bunx tsc --noEmit
bun run build
```
