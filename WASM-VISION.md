# FilamuReel: A Client-Heavy WebAssembly Vision

> **The big idea:** let the server be the trusted keeper of accounts, records, and permissions—not the place where every device must ask permission to sort a shelf, prepare a thumbnail, calculate a chart, or remember where playback stopped.

This is an intentionally ambitious architecture pitch for moving as much *safe, repeatable work* as practical to the browser using WebAssembly (Wasm), Web Workers, browser storage, and static hosting. It is not a claim that Wasm replaces the backend, a proposal to put private data in the browser, or a promise of a particular bill reduction. It describes a direction to measure and pursue.

## The pitch

FilamuReel already has a browser application and an integrated Bun API backed by SQLite. The ambitious end state separates those jobs:

```text
Browser / installed PWA
  React UI + TypeScript
  Web Workers + small, versioned Wasm modules
  IndexedDB for explicitly cacheable public data and offline work
  ├── static UI, icons, and Wasm files  ──> CDN / static host
  └── authenticated reads and writes  ──> Caddy ──> Bun API ──> SQLite
```

The static app can be distributed from a cacheable edge or static host. A user's device can perform suitable computation locally. The Bun service remains the authority for identity, permissions, canonical data, moderation, and durable writes. Caddy can continue to provide HTTPS and route API calls to Bun.

This is a **client-heavy app with a small trusted core**, not a backend-free app.

## What “offload” really means

WebAssembly does not make a request disappear just because code was compiled to Wasm. It reduces server work only when the browser can do work that would otherwise have been done on the server, or avoid a request by using valid local data.

| Work moved or avoided | Potential server-side effect | Important limitation |
| --- | --- | --- |
| Filter, sort, and search a catalog snapshot already downloaded to the device | Fewer repeated catalog queries and smaller interaction latency | A new device still needs the snapshot; data must be refreshed and public |
| Derive charts from already-fetched, authorized analytics events | Less repeated aggregation CPU | Authorization and source records remain server-side; do not download another user's raw records |
| Queue progress, watchlist, and reaction changes while offline, then sync | Fewer fragile retries and better connectivity behavior; possibly fewer round trips when writes are safely batched | Server must validate every operation and resolve conflicts |
| Resize, inspect, and validate creator media before upload | Fewer rejected uploads and less inbound bandwidth for images when compression is useful | The server must re-validate; encoding large video in Wasm can drain battery and stall low-end phones |
| Compute recommendations or local ranking from public catalog data | Less repeated ranking work on the API | A client-only ranking is not authoritative and may have limited data |
| Prepare media manifests, subtitle previews, and local metadata | Less repeated formatting work | Never treat browser output as trusted moderation or billing evidence |

The largest predictable cost opportunity is usually **delivery and caching**, not Wasm by itself. Static files can be cached at the edge; large films should eventually use object storage and a video delivery network rather than the Bun process. Browser compute can also reduce API reads and server CPU, but its value depends on what the server currently spends time doing.

## A plausible FilamuReel offload portfolio

### Tier 1: Browser-native work first

Before writing Wasm, use efficient browser features and ordinary TypeScript where they are the simpler solution:

- Filter and sort data already in memory.
- Use IndexedDB for carefully scoped public catalog snapshots and queued offline changes.
- Use Web Workers for expensive work so scrolling and playback stay responsive.
- Use browser image APIs for ordinary image preview and resizing where device support is adequate.
- Cache the app shell and immutable static assets with the service worker.

These often provide most of the product value without adding a Wasm runtime, module toolchain, or separate language.

### Tier 2: Wasm where profiling finds a hot loop

Consider a small Wasm module only after profiling identifies CPU-bound work that is portable and deterministic, such as:

- Large local catalog filtering and ranking.
- Aggregation of already-authorized, already-downloaded event data.
- CPU-heavy media inspection or image transforms, if tests show Wasm beats browser-native APIs on target devices.
- A compact, shared parsing or scoring core that needs identical behavior across browser and server environments.

Keep Wasm modules small, versioned, independently testable, and callable from a Web Worker. Run a TypeScript fallback for unsupported browsers, module download failures, or devices where native code is faster.

### Keep trusted work on the server

These are not client-offload candidates:

- Password verification, session issuance, role checks, and account suspension.
- Ownership checks and admin authorization.
- Canonical film, review, subscription, transaction, and withdrawal records.
- Payment verification, revenue reporting, and creator payout calculations.
- Moderation decisions, audit logging, rate limits, and abuse prevention.
- Validation that decides whether an uploaded film or Reel item is accepted.
- Database writes and conflict resolution.

Client code can be inspected, altered, replayed, or bypassed. A client may improve an experience; it cannot enforce a business rule.

## What this could mean for server load

There is no honest percentage to promise before measuring production traffic. WebAssembly can reduce CPU for selected calculations; it does not reduce the bandwidth for a film a viewer streams, and the first visit still needs to download the app and any data it uses.

Use these measurements to establish a baseline:

1. API requests per session, by route and status.
2. Bun CPU time and SQLite query time per route.
3. Response bytes per route, excluding uploaded and streamed media.
4. Static asset cache hit ratio and transfer bytes.
5. Upload rejection rate and average accepted image/video size.
6. Client compute time, memory, battery impact, and Wasm download size on low-, mid-, and high-tier phones.

Then estimate impact with measured route shares:

```text
avoidable API requests =
  baseline requests for eligible read routes
  × eligible fraction served from a valid local snapshot

estimated API CPU saved =
  baseline API CPU for eligible routes
  × fraction of eligible work actually avoided

estimated origin bandwidth saved =
  bytes for responses no longer fetched
  − bytes added for snapshots, sync, and Wasm modules
```

For intuition only, suppose a future release measures 1,000,000 monthly API requests, of which 35% are repeat reads of public catalog data. If a correctly versioned local cache serves half of those eligible reads, that is **175,000 fewer origin requests per month**. It is not a 17.5% CPU saving unless those routes also account for exactly 17.5% of measured API CPU. If catalog queries consume 8% of API CPU, the rough upper bound is 4% CPU saved under that example—and the real result may be lower after cache validation and sync costs.

In other words: reduce repeated work, measure the bill, and only then claim the saving.

## Example target directory layout

This is a possible future layout, not a description of files that exist today:

```text
reel/
├── client/
│   ├── src/                         # React app, routing, API client
│   ├── workers/
│   │   ├── catalog.worker.ts        # Filtering, ranking, local aggregation
│   │   └── media.worker.ts          # Optional media preflight
│   ├── wasm/
│   │   ├── loader.ts                # Version checks, fallback, worker bridge
│   │   └── generated/               # Build output only; do not hand-edit
│   └── offline/
│       ├── catalog-cache.ts         # IndexedDB public snapshot cache
│       └── mutation-queue.ts        # Offline writes awaiting server validation
├── wasm/
│   ├── catalog-core/                # Source for measured CPU-hot algorithms
│   │   ├── src/
│   │   ├── tests/
│   │   └── README.md
│   └── media-preflight/             # Only if browser-native APIs are insufficient
├── src/
│   ├── server.js                    # Trusted Bun HTTP/API process
│   ├── data.js                      # SQLite schema and migrations
│   └── ...                          # Existing API modules
├── dist/                            # Built static application and versioned Wasm
└── deploy/
    ├── Caddyfile.example            # Static frontend + /api and /uploads routing
    └── cache-headers.example        # Immutable hashed assets; revalidated shell
```

The current app keeps its frontend under `src/`; this tree illustrates separation of concerns, not a required immediate restructure. Generated Wasm binaries should be reproducible from source in CI. Do not commit compiler caches or make checked-in binary files the only source of truth.

## Deployment can stay simple

The smallest production deployment can still be one Bun backend and Caddy:

1. CI builds the React app and any Wasm modules into `dist/`.
2. Caddy serves the static build and immutable, content-hashed assets.
3. Caddy sends `/api/*` and `/uploads/*` to the Bun process.
4. Bun validates requests and owns SQLite, authentication, and writes.
5. A release publishes the static build and restarts the backend only when backend code or schema changes.

The frontend can later move to static hosting/CDN without changing the authoritative API. Hashed JS, CSS, and Wasm can use long-lived immutable caching; the HTML shell, manifest, and service worker should be revalidated so users can discover releases. The service worker should continue bypassing API responses and uploads unless a specific offline contract is designed and tested.

Illustrative Caddy routing (adapt paths, ports, and upload handling to the actual server):

```caddyfile
filamureel.example {
    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }

    handle /uploads/* {
        reverse_proxy 127.0.0.1:3000
    }

    handle {
        root * /srv/filamureel/dist
        try_files {path} /index.html
        file_server
    }
}
```

This is an architecture sketch, not a drop-in production configuration. Confirm Bun's static routes, SPA fallback, upload limits, database backup, and cache headers before switching the live host to static frontend serving.

## Data and offline boundaries

An offline-first client should have explicit data rules:

- Public film metadata can be cached with a server-provided version or ETag and a clear expiry policy.
- Private watchlists, progress, and creator analytics must be namespaced by authenticated account and cleared on sign-out or account change.
- Queued writes should have unique operation IDs, timestamps, and bounded retries. The API must make retries idempotent where needed.
- The server remains canonical. A rejected or conflicting write must be shown to the user; do not silently display success-shaped state.
- Never place password hashes, session tokens, admin-only records, payment secrets, or another user's private data in a Wasm module or public cache.
- Avoid caching responses that contain `Set-Cookie`, private data, or financial information.

## The bargain: benefits and costs

**What we gain**

- More responsive browsing and analytics on capable devices.
- Fewer repeat reads when local cache is valid.
- A frontend that can be distributed cheaply and close to users.
- Better offline tolerance for browsing and queued low-risk actions.
- A path to scale static delivery separately from the trusted API.

**What we take on**

- More client code, compatibility work, and cache-invalidation rules.
- Wasm binary build, versioning, debugging, and observability.
- Device CPU, memory, battery, storage, and mobile-data use.
- Sync conflicts and more complex user-visible failure states.
- The need to test multiple execution paths (Wasm, TypeScript fallback, offline, stale data).

Wasm is a power tool, not a free optimization. A module that saves a few milliseconds on the server but costs a phone several megabytes of download and sustained CPU is a bad trade.

## A sensible route to the wild version

This is a staged engineering approach, not a feature roadmap:

1. **Measure.** Add route-level timings and request/response-size metrics; capture a representative baseline.
2. **Move static delivery.** Serve the production frontend from `dist/` through Caddy or a CDN while keeping API requests on Bun.
3. **Cache public reads.** Add versioned public catalog caching and validate offline behavior and cache invalidation.
4. **Move safe derived work.** Calculate charts and local ranking from data the user is already authorized to see; compare browser cost to the server baseline.
5. **Add a worker.** Keep CPU-heavy browser tasks off the UI thread and provide a tested fallback.
6. **Introduce Wasm selectively.** Implement only a profiled hot path, publish reproducible artifacts, and benchmark on real low-end phones.
7. **Prove the economics.** Compare origin request count, SQLite time, Bun CPU, CDN bytes, and user-device cost against baseline before expanding.

Every stage should be independently releasable and reversible. If a Wasm module fails to load, FilamuReel should remain usable through a smaller TypeScript fallback or a server calculation—not strand users on a blank screen.

## Success criteria

Call this successful only if a measured release demonstrates all of the following:

- Lower API CPU or request volume for the targeted workload, with the before/after methodology documented.
- No increase in incorrect authorization, stale private data, or lost writes.
- Improved or unchanged interaction latency on representative low-end mobile devices.
- Acceptable first-load transfer size and client memory/battery use.
- A working non-Wasm fallback and an easy rollback path.
- A deployment that can publish static assets without coupling every frontend change to a database migration.

The far-out ambition is real: let every audience member's phone do useful work, let the CDN carry the pixels, and reserve the origin for what only the origin can be trusted to decide.
