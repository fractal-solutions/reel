# FilamuReel Roadmap

**Reviewed:** 29 September 2026

## Implemented

- Bun server, React UI, and SQLite via Bun SQL.
- Audience and creator registration, sign-in/out, cookie sessions, account roles, and account-scoped data.
- Creator film ownership checks and admin access controls.
- Admin dashboards for accounts, films, reviews, subscriptions, plans, transactions, analytics, and audit history.
- Analytics use persisted account, playback, review, and subscription data. Demo activity is excluded; revenue counts only verified successful transactions.
- Film playback controls, resume/start over, progress saves, trailer tracking, branded loading/buffering state, and the three-hour viewing prompt.
- Local media uploads.

## Remaining priorities

### P0 — Configure real media

- [ ] Upload rights-cleared films and trailers; current seeded films do not have playable media.
- [ ] Test playback, resume, and progress saves across supported browsers and devices.
- [ ] Choose production media storage and delivery; add transcoding/CDN if needed.
- [ ] Validate uploaded file contents, size limits, cleanup, and storage permissions.

### P1 — Production accounts and operations

- [ ] Add account recovery and email verification.
- [ ] Decide whether creator accounts need admin approval.
- [ ] Add rate limits, account/data deletion, backup/restore tests, monitoring, and incident procedures.
- [ ] Define rights, takedown, moderation, age-rating, privacy, and retention policies.
- [ ] Test admin/creator workflows and cross-account access end to end.

### P1 — Payments and entitlements

- [ ] Choose payment provider(s), launch countries, currencies, refund rules, and creator revenue share.
- [ ] Connect verified checkout/webhook processing before reporting revenue or enabling paid access.
- [ ] Define subscription expiry, access, cancellation, and payout rules.
- [ ] Keep revenue and payouts unavailable until transactions are verified and payout handling is implemented.

### P2 — Playback and accessibility

- [ ] Add captions and complete keyboard/screen-reader support.
- [ ] Decide on autoplay-next and adaptive streaming.
- [ ] Harden playback analytics against client-side manipulation; define active-user periods and any regional analytics with a privacy purpose.

## Launch blockers

- [ ] Rights-cleared, playable media and production storage are in place.
- [ ] Production admin is bootstrapped with a strong environment-configured password; never deploy the demo credentials.
- [ ] Backups, monitoring, account recovery, and support procedures are tested.
- [ ] Payment features remain disabled until real provider events and payout rules are verified.
