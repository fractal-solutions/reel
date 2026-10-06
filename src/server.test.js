import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase } from "./data";
import { createApiHandler, uploadedFileResponse } from "./server";
let db;
let api;
let uploadDirectory;
let creatorCookie;
let audienceCookie;
let adminCookie;
async function call(path, method = "GET", body, cookie = creatorCookie, extraHeaders = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  for (const [name, value] of Object.entries(extraHeaders))
    headers.set(name, value);
  return api(new Request(`http://localhost/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
}
async function cookieFrom(response) {
  return response.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}
async function data(response) {
  return await response.json();
}
beforeAll(async () => {
  db = new SQL(":memory:");
  await initializeDatabase(db);
  uploadDirectory = await mkdtemp(join(tmpdir(), "filamureel-test-"));
  api = createApiHandler(db, { uploadDirectory, maxImageBytes: 8, maxVideoBytes: 16, maxAudioBytes: 8 });
  creatorCookie = await cookieFrom(await call("/auth/login", "POST", {
    email: "creator@filamureel.local", password: "ReelCreator2026!"
  }, null));
  adminCookie = await cookieFrom(await call("/auth/login", "POST", {
    email: "admin@filamureel.local", password: "ReelAdmin2026!"
  }, null));
  audienceCookie = await cookieFrom(await call("/auth/register", "POST", {
    name: "Real Audience", email: "real-audience@example.test",
    password: "RealAudience2026!", role: "audience"
  }, null));
});
afterAll(async () => {
  await db.close();
  await rm(uploadDirectory, { recursive: true, force: true });
});
describe("Reel Africa API", () => {
  test("seeds catalog, category counts, plans, and health", async () => {
    expect(await data(await call("/healthz"))).toEqual({ status: "ok" });
    const catalog = await data(await call("/films"));
    expect(catalog.total).toBe(8);
    expect(catalog.films[0]?.creatorName).toBe("Amara Okafor");
    expect((await data(await call("/categories"))).reduce((n, item) => n + item.filmCount, 0)).toBe(8);
    expect((await data(await call("/plans"))).length).toBe(3);
    expect(await data(await call("/films/platform-stats"))).not.toHaveProperty("totalCountries");
  });
  test("registers accounts, issues secure role-bound sessions, and protects private APIs", async () => {
    expect(creatorCookie).toMatch(/^filamureel_session=/);
    expect((await call("/progress", "GET", undefined, null)).status).toBe(401);
    expect((await call("/admin/overview", "GET", undefined, creatorCookie)).status).toBe(403);
    expect((await call("/creator/dashboard", "GET", undefined, audienceCookie)).status).toBe(403);
    expect((await call("/films", "POST", { title: "Audience Upload", monetization: "free" }, audienceCookie)).status).toBe(403);
    expect((await data(await call("/auth/me", "GET", undefined, audienceCookie))).user.role).toBe("audience");
    expect((await call("/auth/login", "POST", { email: "real-audience@example.test", password: "wrong-password" }, null)).status).toBe(401);
    expect((await call("/auth/register", "POST", {
      name: "Invalid Admin", email: "attacker@example.test", password: "LongEnoughPassword!", role: "admin"
    }, null)).status).toBe(400);
    expect((await call("/auth/register", "POST", {
      name: "Duplicate", email: "REAL-AUDIENCE@example.test", password: "LongEnoughPassword!", role: "audience"
    }, null)).status).toBe(409);
    expect((await call("/auth/logout", "POST", undefined, null, {
      Host: "192.168.100.81:3000", Origin: "http://192.168.100.81:3000"
    })).status).toBe(204);
    expect((await call("/auth/logout", "POST", undefined, null, {
      Host: "192.168.100.81:3000", Origin: "http://attacker.example"
    })).status).toBe(403);
    const logoutCookie = await cookieFrom(await call("/auth/register", "POST", {
      name: "Logout Test", email: "logout@example.test", password: "LogoutPassword123!", role: "audience"
    }, null));
    expect((await call("/auth/logout", "POST", undefined, logoutCookie)).status).toBe(204);
    expect((await data(await call("/auth/me", "GET", undefined, logoutCookie))).user).toBeNull();
  });
  test("filters catalog safely and reports malformed filters", async () => {
    const filtered = await data(await call("/films?genre=Drama&search=Baobab"));
    expect(filtered.total).toBe(1);
    expect(filtered.films.length).toBe(1);
    expect((await call("/films?sort=DROP%20TABLE%20films")).status).toBe(400);
    expect((await call("/films?search=%25%27%20OR%201%3D1%20--")).status).toBe(200);
  });

  test("supports straightforward discovery and continue-watching route aliases", async () => {
    for (const [path, maxLength] of [
      ["/featured", 6],
      ["/trending", 2],
      ["/new-releases", 2],
      ["/festival-winners", 12],
      ["/free-films", 2],
    ]) {
      const response = await call(`${path}?limit=2`);
      expect(response.status).toBe(200);
      expect((await data(response)).length).toBeLessThanOrEqual(maxLength);
    }
    expect(await data(await call("/featured"))).toEqual(await data(await call("/films/featured")));
    expect(await data(await call("/trending?limit=3"))).toEqual(await data(await call("/films/trending?limit=3")));
    expect(await data(await call("/free-films?limit=3"))).toEqual(await data(await call("/films/free?limit=3")));
    await call("/progress", "POST", { filmId: 1, progressSeconds: 42 });
    expect(await data(await call("/continue-watching"))).toEqual(await data(await call("/progress")));
    expect((await call("/continue-watching", "POST", { filmId: 2, progressSeconds: 10 })).status).toBe(200);
  });
  test("serves film details, counts views, and finds related films", async () => {
    const before = await data(await call("/films/1"));
    const detail = await data(await call("/films/1"));
    expect(detail.cast).toContain("Amina");
    expect(detail.subtitles).toContain("English");
    expect(detail.isInWatchlist).toBe(false);
    expect((await data(await call("/films/1/related"))).length).toBeGreaterThan(0);
    expect((await data(await call("/films/1"))).viewCount).toBe(before.viewCount);
    expect((await call("/films/nope")).status).toBe(400);
    expect((await call("/films/9999")).status).toBe(404);
  });
  test("supports watchlist and watch-progress create, idempotency, and validation", async () => {
    const added = await data(await call("/watchlist", "POST", { filmId: 1 }));
    expect(added.filmId).toBe(1);
    expect((await call("/watchlist", "POST", { filmId: 1 })).status).toBe(201);
    expect((await data(await call("/watchlist"))).length).toBe(1);
    expect((await call("/watchlist/1", "DELETE")).status).toBe(204);
    expect((await call("/watchlist/1", "DELETE")).status).toBe(204);
    const progress = await data(await call("/progress", "POST", { filmId: 1, progressSeconds: 120, totalSeconds: 100 }));
    expect(progress.percentComplete).toBe(100);
    expect(progress.film).toBeNull();
    expect(progress.progressSeconds).toBe(100);
    await call("/progress", "POST", { filmId: 2, progressSeconds: 40, totalSeconds: 100 });
    expect((await data(await call("/progress"))).map((item) => item.film.id)).toEqual([2]);
    await call("/progress", "POST", { filmId: 1, progressSeconds: 0, totalSeconds: 100 });
    expect((await data(await call("/progress"))).map((item) => item.film.id)).toContain(1);
    expect((await data(await call("/films/1"))).watchProgress).toBe(0);
    expect((await call("/progress", "POST", { filmId: 1, progressSeconds: -1 })).status).toBe(400);
  });
  test("counts actual play sessions and derives analytics from playback events", async () => {
    const before = await data(await call("/creator/analytics"));
    expect(before.totalViews).toBe(0);
    const started = await data(await call("/films/1/view", "POST", undefined, audienceCookie));
    expect(started.viewingEventId).toBeGreaterThan(0);
    expect((await data(await call("/creator/dashboard"))).totalViews).toBe(1);
    await call("/progress", "POST", {
      filmId: 1,
      progressSeconds: 30,
      totalSeconds: 100,
      watchedSecondsDelta: 18,
      viewingEventId: started.viewingEventId
    }, audienceCookie);
    const analytics = await data(await call("/creator/analytics"));
    expect(analytics.totalViews).toBe(1);
    expect(analytics.viewsByDay.reduce((sum, day) => sum + day.views, 0)).toBe(1);
    expect(analytics.viewsByDay.reduce((sum, day) => sum + day.secondsWatched, 0)).toBe(18);
    expect(analytics.avgWatchThroughRate).toBe(0.3);
    const trailer = await data(await call("/films/1/view", "POST", { mediaType: "trailer" }, audienceCookie));
    expect(trailer.viewingEventId).toBeGreaterThan(started.viewingEventId);
    expect((await data(await call("/films/1"))).viewCount).toBe(1);
    expect((await data(await call("/creator/analytics"))).totalViews).toBe(1);
    const filmAnalytics = await data(await call("/creator/analytics/1"));
    expect(filmAnalytics.uniqueViewers).toBe(1);
    expect((await call("/films/1/view", "POST", { mediaType: "invalid" }, audienceCookie)).status).toBe(400);
    expect((await call("/progress", "POST", {
      filmId: 1,
      progressSeconds: 45,
      viewingEventId: started.viewingEventId,
      watchedSecondsDelta: 31
    }, audienceCookie)).status).toBe(400);
    expect((await call("/progress", "POST", {
      filmId: 2,
      progressSeconds: 15,
      viewingEventId: started.viewingEventId
    }, audienceCookie)).status).toBe(404);
  });
  test("uploads bounded local media and serves safe byte ranges", async () => {
    const tooLarge = await api(new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "image/png", Cookie: creatorCookie },
      body: new Uint8Array(9)
    }));
    expect(tooLarge.status).toBe(413);
    const unsupported = await api(new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "text/html", Cookie: creatorCookie },
      body: new Uint8Array([1])
    }));
    expect(unsupported.status).toBe(415);
    const upload = await api(new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "image/png", Cookie: creatorCookie },
      body: new Uint8Array([1, 2, 3, 4, 5, 6])
    }));
    expect(upload.status).toBe(200);
    const { url } = await data(upload);
    const filename = url.split("/").at(-1);
    expect(filename).toMatch(/^[\da-f-]{36}\.png$/);
    const served = await uploadedFileResponse(filename, uploadDirectory);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/png");
    const partial = await uploadedFileResponse(filename, uploadDirectory, "bytes=1-3");
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Range")).toBe("bytes 1-3/6");
    expect([...new Uint8Array(await partial.arrayBuffer())]).toEqual([2, 3, 4]);
    const audioUpload = await api(new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "audio/mpeg", Cookie: creatorCookie },
      body: new Uint8Array([1, 2, 3, 4, 5, 6])
    }));
    expect(audioUpload.status).toBe(200);
    const audioFile = (await data(audioUpload)).url.split("/").at(-1);
    expect(audioFile).toMatch(/^[\da-f-]{36}\.mp3$/);
    expect((await uploadedFileResponse(audioFile, uploadDirectory)).headers.get("Content-Type")).toBe("audio/mpeg");
    const oversizedAudio = await api(new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "audio/mpeg", Cookie: creatorCookie },
      body: new Uint8Array(9)
    }));
    expect(oversizedAudio.status).toBe(413);
    expect((await uploadedFileResponse("../not-a-file.png", uploadDirectory)).status).toBe(404);
  });
  test("creates reviews and recalculates film score", async () => {
    const response = await call("/films/3/reviews", "POST", { rating: 4, comment: "Lovely" }, audienceCookie);
    expect(response.status).toBe(201);
    const reviews = await data(await call("/films/3/reviews"));
    expect(reviews[0]?.rating).toBe(4);
    const film = await data(await call("/films/3"));
    expect(film.rating).toBe(4);
    expect(film.reviewCount).toBe(1);
    expect((await call("/films/3/reviews", "POST", { rating: 6 })).status).toBe(400);
    expect((await call("/films/3/reviews", "POST", { rating: 4 }, audienceCookie)).status).toBe(409);
  });
  test("creates, updates, and deletes a normalized film record", async () => {
    const created = await data(await call("/films", "POST", {
      title: "Test Film",
      monetization: "free",
      category: "Test Category",
      tags: ["community"],
      subtitles: ["English"],
      director: "Test Director"
    }));
    expect(created.title).toBe("Test Film");
    expect(created.tags).toEqual(["community"]);
    expect((await data(await call(`/films/${created.id}`))).subtitles).toEqual(["English"]);
    const updated = await data(await call(`/films/${created.id}`, "PATCH", { category: "Drama", status: "draft" }));
    expect(updated.category).toBe("Drama");
    expect(updated.status).toBe("draft");
    expect((await call(`/films/${created.id}`, "DELETE")).status).toBe(204);
    expect((await call(`/films/${created.id}`)).status).toBe(404);
  });
  test("submits creator trailers for moderation and persists audience reactions and ratings", async () => {
    const film = await data(await call("/films", "POST", {
      title: "Reel Workflow Test",
      monetization: "free",
      trailerUrl: "https://media.example.test/reel-workflow.mp4",
      posterUrl: "https://media.example.test/reel-workflow.jpg"
    }));
    const submitted = await call("/creator/reel-submissions", "POST", { filmId: film.id });
    expect(submitted.status).toBe(201);
    const submission = await data(submitted);
    expect(submission.status).toBe("pending");
    expect((await data(await call("/reel-items"))).some((item) => item.id === submission.id)).toBe(false);
    expect((await data(await call("/creator/reel-submissions"))).some((item) => item.id === submission.id)).toBe(true);
    expect((await call("/reel-items/999999/reaction", "PUT", { reaction: "like" }, audienceCookie)).status).toBe(404);
    expect((await call("/admin/reel-items", "GET", undefined, creatorCookie)).status).toBe(403);
    const reviewList = await data(await call("/admin/reel-items", "GET", undefined, adminCookie));
    expect(reviewList.find((item) => item.id === submission.id)?.status).toBe("pending");
    expect((await call(`/admin/reel-items/${submission.id}`, "PATCH", { status: "published" }, adminCookie)).status).toBe(200);
    expect((await data(await call("/reel-items?category=clips"))).some((item) => item.id === submission.id)).toBe(true);
    expect((await call(`/reel-items/${submission.id}/reaction`, "PUT", { reaction: "bogus" }, audienceCookie)).status).toBe(400);
    expect((await call(`/reel-items/${submission.id}/rating`, "PUT", { rating: 6 }, audienceCookie)).status).toBe(400);
    expect((await call(`/reel-items/${submission.id}/reaction`, "PUT", { reaction: "love" }, null)).status).toBe(401);
    expect((await call(`/reel-items/${submission.id}/reaction`, "PUT", { reaction: "love" }, audienceCookie)).status).toBe(200);
    expect((await call(`/reel-items/${submission.id}/reaction`, "PUT", { reaction: "fire" }, audienceCookie)).status).toBe(200);
    expect((await call(`/reel-items/${submission.id}/rating`, "PUT", { rating: 4 }, audienceCookie)).status).toBe(200);
    expect((await call(`/reel-items/${submission.id}/rating`, "PUT", { rating: 5 }, audienceCookie)).status).toBe(200);
    const published = (await data(await call("/reel-items", "GET", undefined, audienceCookie))).find((item) => item.id === submission.id);
    expect(published?.reactionCount).toBe(1);
    expect(published?.myReaction).toBe("fire");
    expect(published?.ratingCount).toBe(1);
    expect(published?.averageRating).toBe(5);
    expect((await call(`/reel-items/${submission.id}/reaction`, "DELETE", undefined, audienceCookie)).status).toBe(204);
    expect((await call(`/reel-items/${submission.id}/rating`, "DELETE", undefined, audienceCookie)).status).toBe(204);
    expect((await call(`/admin/reel-items/${submission.id}`, "PATCH", { status: "hidden" }, adminCookie)).status).toBe(200);
    expect((await data(await call("/reel-items"))).some((item) => item.id === submission.id)).toBe(false);
    expect((await call(`/admin/reel-items/${submission.id}`, "PATCH", { status: "rejected" }, adminCookie)).status).toBe(200);
    expect((await call("/creator/reel-submissions", "POST", { filmId: film.id })).status).toBe(200);
    expect((await data(await call("/creator/reel-submissions"))).find((item) => item.id === submission.id)?.status).toBe("pending");
    expect((await call(`/films/${film.id}`, "DELETE")).status).toBe(204);
  });
  test("submits standalone Reel media to the creator-selected section", async () => {
    const submitted = await call("/creator/reel-submissions", "POST", {
      category: "podcasts",
      mediaType: "audio",
      title: "Stories Behind the Screen",
      description: "A conversation with emerging filmmakers.",
      videoUrl: "/uploads/filmmaker-podcast.mp4",
      posterUrl: "/uploads/podcast-cover.webp"
    });
    expect(submitted.status).toBe(201);
    const { id } = await data(submitted);
    expect((await call("/creator/reel-submissions", "POST", {
      category: "unexpected", title: "Invalid", videoUrl: "/uploads/invalid.mp4"
    })).status).toBe(400);
    expect((await call("/creator/reel-submissions", "POST", {
      category: "interviews", title: "Missing media"
    })).status).toBe(400);
    expect((await call(`/admin/reel-items/${id}`, "PATCH", { status: "published" }, adminCookie)).status).toBe(200);
    const podcasts = await data(await call("/reel-items?category=podcasts"));
    expect(podcasts.some((item) => item.id === id && item.filmId === null && item.filmTitle === null && item.mediaType === "audio")).toBe(true);
    expect((await data(await call("/reel-items?category=interviews"))).some((item) => item.id === id)).toBe(false);
    expect((await call(`/reel-items/${id}/reaction`, "PUT", { reaction: "love" }, audienceCookie)).status).toBe(200);
    expect((await call("/creator/reel-submissions", "POST", {
      category: "interviews", mediaType: "audio", title: "Bad format", videoUrl: "/uploads/bad.mp3"
    })).status).toBe(400);
    const linked = await data(await call("/creator/reel-submissions", "POST", {
      category: "interviews", title: "Cast conversation", videoUrl: "/uploads/interview.mp4", filmId: 1
    }));
    expect(linked.status).toBe("pending");
    expect((await data(await call("/creator/reel-submissions"))).find((item) => item.id === linked.id)).toMatchObject({
      category: "interviews", filmId: 1, filmTitle: "The Last Baobab"
    });
  });
  test("keeps creator endpoints on the seeded identity and validates withdrawals", async () => {
    const creatorFilms = await data(await call("/creator/films"));
    expect(creatorFilms.every((film) => film.creatorId === 1)).toBe(true);
    expect((await data(await call("/creator/dashboard"))).totalFilms).toBe(8);
    expect((await data(await call("/creator/analytics"))).viewsByDay).toHaveLength(30);
    const earnings = await data(await call("/creator/earnings"));
    expect(earnings.available).toBe(false);
    expect(earnings.totalEarned).toBeNull();
    const withdrawal = await call("/creator/withdrawals", "POST", {
      amount: 10,
      method: "mpesa",
      accountDetails: "0700000000"
    });
    expect(withdrawal.status).toBe(503);
  });
  test("admin dashboard uses real accounts and verified payments and manages platform records", async () => {
    expect((await call("/admin/overview", "GET", undefined, null)).status).toBe(401);
    const adminUsers = await data(await call("/admin/users?search=", "GET", undefined, adminCookie));
    expect(Array.isArray(adminUsers.users)).toBe(true);
    expect(adminUsers.total).toBeGreaterThan(0);
    const user = await data(await call("/auth/me", "GET", undefined, audienceCookie));
    const userId = user.user.id;
    const overviewBefore = await data(await call("/admin/overview", "GET", undefined, adminCookie));
    expect(overviewBefore.users).toBe(2);
    expect(overviewBefore.filmPlays).toBe(1);
    expect(overviewBefore.uniqueViewers).toBe(1);
    expect(overviewBefore.revenueAvailable).toBe(false);
    expect(overviewBefore.paymentIntegrationAvailable).toBe(false);
    await db.unsafe(`INSERT INTO transactions (user_id,provider,provider_reference,transaction_type,
      amount_cents,currency,status,verified_at,created_at) VALUES (?,'test','verified-test-1','subscription',1250,'KES','succeeded',?,?)`,
    [userId, new Date().toISOString(), new Date().toISOString()]);
    const overviewAfter = await data(await call("/admin/overview", "GET", undefined, adminCookie));
    expect(overviewAfter.revenueAvailable).toBe(true);
    expect(overviewAfter.revenue).toEqual([{ currency: "KES", netAmount: 12.5, verifiedTransactions: 1 }]);
    expect((await data(await call("/admin/transactions", "GET", undefined, adminCookie))).length).toBe(1);
    const subscription = await data(await call("/admin/subscriptions", "POST", { userId, planId: 1 }, adminCookie));
    expect(subscription.provider).toBe("admin");
    expect((await data(await call("/admin/subscriptions", "GET", undefined, adminCookie)))[0].status).toBe("active");
    expect((await call(`/admin/subscriptions/${subscription.id}`, "PATCH", { status: "canceled" }, adminCookie)).status).toBe(200);
    expect((await call(`/admin/reviews/1`, "PATCH", { status: "hidden" }, adminCookie)).status).toBe(200);
    expect((await call("/films/1/reviews")).status).toBe(200);
    expect((await call("/admin/audit", "GET", undefined, adminCookie)).status).toBe(200);
    const plans = await data(await call("/admin/plans", "GET", undefined, adminCookie));
    expect(plans).toHaveLength(3);
    const plan = await data(await call("/admin/plans", "POST", {
      name: "Temporary Plan", priceMonthly: 149, priceAnnual: 1490, features: ["One screen"], isPopular: false
    }, adminCookie));
    expect((await call(`/admin/plans/${plan.id}`, "PATCH", {
      name: "Edited Plan", priceMonthly: 199, features: ["Two screens", "HD"], isPopular: true
    }, adminCookie)).status).toBe(200);
    expect((await data(await call("/admin/plans", "GET", undefined, adminCookie))).some((item) =>
      item.id === plan.id && item.name === "Edited Plan" && item.isPopular && item.features.length === 2)).toBe(true);
    expect((await call(`/admin/plans/${plan.id}`, "DELETE", undefined, adminCookie)).status).toBe(204);
    expect((await call("/admin/films", "GET", undefined, adminCookie)).status).toBe(200);
  });
  test("requires a production admin password before database initialization", async () => {
    const isolatedDb = new SQL(":memory:");
    try {
      await expect(initializeDatabase(isolatedDb, { isProduction: true })).rejects.toThrow("ADMIN_PASSWORD is required");
    } finally {
      await isolatedDb.close();
    }
  });
  test("admin suspensions revoke all account sessions", async () => {
    const registration = await call("/auth/register", "POST", {
      name: "Suspension Test", email: "suspension@example.test",
      password: "LongEnoughPassword123!", role: "audience"
    }, null);
    const accountCookie = await cookieFrom(registration);
    const account = await data(registration);
    expect(account.user.role).toBe("audience");
    expect((await call("/admin/users", "PATCH", { userId: account.user.id, status: "suspended" }, adminCookie)).status).toBe(200);
    expect((await call("/watchlist", "GET", undefined, accountCookie)).status).toBe(401);
    expect((await call("/auth/login", "POST", { email: "suspension@example.test", password: "LongEnoughPassword123!" }, null)).status).toBe(403);
  });
  test("migrates existing viewing events with the legacy schema", async () => {
    const legacyDb = new SQL(":memory:");
    await legacyDb.unsafe(`CREATE TABLE viewing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, film_id INTEGER NOT NULL,
      started_at TEXT NOT NULL, seconds_watched INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0
    )`);
    await legacyDb.unsafe("INSERT INTO viewing_events (user_id,film_id,started_at) VALUES (1,1,?)", [new Date().toISOString()]);
    try {
      await initializeDatabase(legacyDb);
      await initializeDatabase(legacyDb);
      const columns = await legacyDb.unsafe("PRAGMA table_info(viewing_events)");
      expect(columns.map((column) => column.name)).toContain("last_position_seconds");
      expect(columns.map((column) => column.name)).toContain("media_type");
      const [film] = await legacyDb.unsafe("SELECT view_count FROM films WHERE id=1");
      expect(film.view_count).toBe(0);
    } finally {
      await legacyDb.close();
    }
  });
  test("migrates linked Reel trailers to optional film associations without losing engagement", async () => {
    const legacyDb = new SQL(":memory:");
    try {
      await initializeDatabase(legacyDb);
      await legacyDb.unsafe("PRAGMA foreign_keys = OFF");
      await legacyDb.unsafe("DROP TABLE reel_ratings");
      await legacyDb.unsafe("DROP TABLE reel_reactions");
      await legacyDb.unsafe("DROP TABLE reel_items");
      await legacyDb.unsafe(`CREATE TABLE reel_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, film_id INTEGER NOT NULL UNIQUE REFERENCES films(id) ON DELETE CASCADE,
        creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT 'clips' CHECK (category IN ('clips','interviews','podcasts','marketing')),
        title TEXT NOT NULL, description TEXT, video_url TEXT NOT NULL, poster_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','hidden','rejected')),
        is_featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`);
      const now = new Date().toISOString();
      const [item] = await legacyDb.unsafe(`INSERT INTO reel_items (film_id,creator_id,title,video_url,status,created_at,updated_at)
        VALUES (1,1,'Legacy trailer','/uploads/legacy.mp4','published',?,?) RETURNING id`, [now, now]);
      await legacyDb.unsafe(`CREATE TABLE reel_reactions (
        reel_item_id INTEGER NOT NULL REFERENCES reel_items(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reaction TEXT NOT NULL CHECK (reaction IN ('like','love','fire','wow')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        PRIMARY KEY (reel_item_id,user_id))`);
      await legacyDb.unsafe(`CREATE TABLE reel_ratings (
        reel_item_id INTEGER NOT NULL REFERENCES reel_items(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        PRIMARY KEY (reel_item_id,user_id))`);
      await legacyDb.unsafe("INSERT INTO reel_reactions VALUES (?,2,'love',?,?)", [item.id, now, now]);
      await legacyDb.unsafe("INSERT INTO reel_ratings VALUES (?,2,5,?,?)", [item.id, now, now]);
      await legacyDb.unsafe("PRAGMA foreign_keys = ON");
      await initializeDatabase(legacyDb);
      const columns = await legacyDb.unsafe("PRAGMA table_info(reel_items)");
      expect(columns.find((column) => column.name === "film_id")?.notnull).toBe(0);
      expect((await legacyDb.unsafe("SELECT reaction FROM reel_reactions WHERE reel_item_id=?", [item.id]))[0]?.reaction).toBe("love");
      expect((await legacyDb.unsafe("SELECT rating FROM reel_ratings WHERE reel_item_id=?", [item.id]))[0]?.rating).toBe(5);
      expect(await legacyDb.unsafe("PRAGMA foreign_key_check")).toEqual([]);
      await legacyDb.unsafe(`INSERT INTO reel_items (creator_id,category,title,video_url,status,created_at,updated_at)
        VALUES (1,'interviews','Standalone','/uploads/interview.mp4','pending',?,?)`, [now, now]);
      await initializeDatabase(legacyDb);
    } finally {
      await legacyDb.close();
    }
  });
});
