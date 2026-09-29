# FilamuReel Roadmap

**Reviewed:** 29 September 2026

## Current status

- Bun serves the React app and API; Bun SQL uses local SQLite.
- Core viewer pages and creator screens are present.
- Catalog, users, reviews, and plans are demo data.
- Authentication, payments, subscriptions, and payouts are not implemented.
- Local uploads and basic playback work; this is not production-ready.

## Priorities

### P0 — Decide launch scope

- [ ] Choose demo, invite-only pilot, or public launch.
- [ ] Choose launch countries, supported devices, and target audience.
- [ ] Set rules for film rights, content review, age ratings, privacy, and data retention.
- [ ] Confirm monetization model and creator revenue rules before building payment flows.

### P1 — Secure accounts and creator actions

**Now:** No sign-in or sessions. Viewer and creator actions use demo user ID `1`. API write routes do not check identity, roles, or ownership.

- [ ] Choose sign-in method and creator verification requirements.
- [ ] Add sign-in/out, account recovery, and secure session handling.
- [ ] Require authentication for personal and creator data.
- [ ] Enforce viewer, creator, and admin roles; verify film ownership on every creator action.
- [ ] Add rate limits and tests for anonymous access and cross-account access.

### P1 — Complete playback and progress

**Now:** Native controls support play/pause, seek, volume, and fullscreen. Progress saves about every 15 seconds and when playback ends.

**Gaps:** Saved progress does not resume playback. There is no “Are you still watching?” prompt, captions, retry experience, or autoplay-next. A play is counted before media starts. Trailer playback can count as a film view. “Unique viewers” currently means total play events.

- [ ] Resume from saved position and offer **Resume** or **Start over**.
- [ ] Save progress on pause and exit; retry failed updates.
- [ ] Define view counting and separate trailer plays from full-film plays.
- [ ] Make watch-time and viewer counts reliable; test player behavior across browsers and devices.
- [ ] Decide whether native controls are sufficient; plan captions and accessibility support.

### P1 — Protect and improve uploads

**Now:** Uploads accept posters up to 10 MB and videos up to 500 MB. Files are stored locally; new films publish immediately.

- [ ] Require an authenticated creator and validate actual file contents, not only declared MIME type.
- [ ] Add upload limits, progress, cancellation, and cleanup for unused files.
- [ ] Add draft, review, edit, and publish steps.
- [ ] Choose production media storage and delivery; add transcoding/CDN if required.

### P2 — Add payments only after business rules

**Now:** Plans are informational. Checkout and access restrictions are absent. Earnings are unavailable and payouts are disabled.

- [ ] Choose payment providers, countries, currencies, prices, and refund rules.
- [ ] Define plan/title access and subscription expiry behavior.
- [ ] Build verified payment handling, an auditable revenue ledger, and creator payouts.
- [ ] Keep checkout and payout controls disabled until the full flow is tested.

### P2 — Prepare for launch

- [ ] Replace demo catalog, reviews, and editorial cards with approved content.
- [ ] Improve search (currently title-only) and add review moderation.
- [ ] Set up backups, restore tests, database migrations, monitoring, and incident procedures.
- [ ] Complete accessibility, localization, privacy, and end-to-end testing.
- [ ] Document rights, takedown, content moderation, support, and account/data deletion procedures.

## Do not launch publicly until

- [ ] Authentication and server-side authorization protect all private and creator actions.
- [ ] Uploaded and streamed media has verified rights and access rules.
- [ ] Backups, recovery, monitoring, and support processes are in place.
- [ ] Payment and payout features are either fully verified or remain unavailable.
