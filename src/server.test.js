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
async function call(path, method = "GET", body) {
  return api(new Request(`http://localhost/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
}
async function data(response) {
  return await response.json();
}
beforeAll(async () => {
  db = new SQL(":memory:");
  await initializeDatabase(db);
  uploadDirectory = await mkdtemp(join(tmpdir(), "filamureel-test-"));
  api = createApiHandler(db, { uploadDirectory, maxImageBytes: 8, maxVideoBytes: 16 });
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
    expect((await data(await call("/progress")))[0]?.film.id).toBe(1);
    expect((await call("/progress", "POST", { filmId: 1, progressSeconds: -1 })).status).toBe(400);
  });
  test("counts actual play sessions and derives analytics from playback events", async () => {
    const before = await data(await call("/creator/analytics"));
    expect(before.totalViews).toBe(0);
    const started = await data(await call("/films/1/view", "POST"));
    expect(started.viewingEventId).toBeGreaterThan(0);
    expect((await data(await call("/creator/dashboard"))).totalViews).toBe(1);
    await call("/progress", "POST", {
      filmId: 1,
      progressSeconds: 30,
      totalSeconds: 100,
      viewingEventId: started.viewingEventId
    });
    const analytics = await data(await call("/creator/analytics"));
    expect(analytics.totalViews).toBe(1);
    expect(analytics.viewsByDay.reduce((sum, day) => sum + day.views, 0)).toBe(1);
    expect(analytics.viewsByDay.reduce((sum, day) => sum + day.secondsWatched, 0)).toBe(30);
    expect(analytics.avgWatchThroughRate).toBe(0.5);
    expect((await call("/progress", "POST", {
      filmId: 2,
      progressSeconds: 15,
      viewingEventId: started.viewingEventId
    })).status).toBe(404);
  });
  test("uploads bounded local media and serves safe byte ranges", async () => {
    const tooLarge = await api(new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(9)
    }));
    expect(tooLarge.status).toBe(413);
    const unsupported = await api(new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "text/html" },
      body: new Uint8Array([1])
    }));
    expect(unsupported.status).toBe(415);
    const upload = await api(new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
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
    expect((await uploadedFileResponse("../not-a-file.png", uploadDirectory)).status).toBe(404);
  });
  test("creates reviews and recalculates film score", async () => {
    const response = await call("/films/3/reviews", "POST", { rating: 4, comment: "Lovely" });
    expect(response.status).toBe(201);
    const reviews = await data(await call("/films/3/reviews"));
    expect(reviews[0]?.rating).toBe(4);
    const film = await data(await call("/films/3"));
    expect(film.rating).toBe(4);
    expect(film.reviewCount).toBe(1);
    expect((await call("/films/3/reviews", "POST", { rating: 6 })).status).toBe(400);
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
});
