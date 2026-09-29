import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DEMO_CREATOR_ID, DEMO_USER_ID } from "./data";

class HttpError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const enumValues = {
  monetization: ["free", "pay_per_view", "subscription", "ad_supported"],
  status: ["draft", "pending", "published", "rejected"]
};
function json(data, status = 200) {
  return Response.json(data, { status });
}
function asText(value) {
  return value === null || value === undefined ? null : String(value);
}
function asNumber(value) {
  return Number(value ?? 0);
}
function asBoolean(value) {
  return Boolean(Number(value));
}
function dateString(value) {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
function requiredId(value, label = "ID") {
  if (!value || !/^[1-9]\d*$/.test(value))
    throw new HttpError(400, `Invalid ${label}`);
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new HttpError(400, `Invalid ${label}`);
  return result;
}
function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "category";
}
function checkString(value, label, options = {}) {
  if (value === undefined && !options.required)
    return;
  if (typeof value !== "string")
    throw new HttpError(400, `${label} must be a string`);
  const result = value.trim();
  if (options.required && !result)
    throw new HttpError(400, `${label} is required`);
  if (result.length > (options.max ?? 4000))
    throw new HttpError(400, `${label} is too long`);
  return result;
}
function checkNumber(value, label, options = {}) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new HttpError(400, `${label} must be a number`);
  if (options.integer && !Number.isInteger(value))
    throw new HttpError(400, `${label} must be an integer`);
  if (options.min !== undefined && value < options.min)
    throw new HttpError(400, `${label} must be at least ${options.min}`);
  if (options.max !== undefined && value > options.max)
    throw new HttpError(400, `${label} must be at most ${options.max}`);
  return value;
}
function checkBoolean(value, label) {
  if (value === undefined)
    return;
  if (typeof value !== "boolean")
    throw new HttpError(400, `${label} must be a boolean`);
  return value;
}
function checkStringArray(value, label) {
  if (value === undefined)
    return;
  if (!Array.isArray(value) || value.length > 50 || value.some((item) => typeof item !== "string" || item.length > 100)) {
    throw new HttpError(400, `${label} must be an array of up to 50 strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}
async function readBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Request body must contain valid JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return body;
}
function queryInt(value, fallback, label, max) {
  if (value === null)
    return fallback;
  if (!/^\d+$/.test(value))
    throw new HttpError(400, `${label} must be a non-negative integer`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > max)
    throw new HttpError(400, `${label} must be at most ${max}`);
  return result;
}
async function dbRows(db, statement, values = []) {
  return await db.unsafe(statement, values);
}
async function one(db, statement, values = []) {
  return (await dbRows(db, statement, values))[0];
}
const filmBaseSql = `SELECT f.*, c.name AS category, u.name AS creator_name, u.avatar_url AS creator_avatar_url
  FROM films f
  LEFT JOIN film_categories fc ON fc.film_id = f.id
  LEFT JOIN categories c ON c.id = fc.category_id
  LEFT JOIN users u ON u.id = f.creator_id`;
async function filmToApi(db, row, detail = false) {
  const tags = await dbRows(db, "SELECT tag FROM film_tags WHERE film_id = ? ORDER BY tag", [row.id]);
  const result = {
    id: asNumber(row.id),
    title: String(row.title),
    description: asText(row.description),
    posterUrl: asText(row.poster_url),
    trailerUrl: asText(row.trailer_url),
    videoUrl: asText(row.video_url),
    duration: row.duration === null ? null : asNumber(row.duration),
    genre: asText(row.genre),
    category: asText(row.category),
    region: asText(row.region),
    language: asText(row.language),
    rating: row.rating === null ? null : asNumber(row.rating),
    reviewCount: asNumber(row.review_count),
    viewCount: asNumber(row.view_count),
    monetization: String(row.monetization),
    price: row.price === null ? null : asNumber(row.price),
    isFestivalWinner: asBoolean(row.is_festival_winner),
    isFeatured: asBoolean(row.is_featured),
    tags: tags.map((tag) => String(tag.tag)),
    creatorId: asNumber(row.creator_id),
    creatorName: asText(row.creator_name) ?? "Unknown Creator",
    creatorAvatarUrl: asText(row.creator_avatar_url),
    status: String(row.status),
    createdAt: dateString(row.created_at)
  };
  if (detail) {
    result.cast = asText(row.cast);
    result.director = asText(row.director);
    const subtitleRows = await dbRows(db, "SELECT language FROM film_subtitles WHERE film_id = ? ORDER BY language", [row.id]);
    result.subtitles = subtitleRows.map((item) => String(item.language));
  }
  return result;
}
async function filmsToApi(db, rows) {
  return Promise.all(rows.map((row) => filmToApi(db, row)));
}
async function getFilm(db, id) {
  return one(db, `${filmBaseSql} WHERE f.id = ?`, [id]);
}
async function ensureCategory(db, value) {
  if (!value)
    return null;
  let row = await one(db, "SELECT id FROM categories WHERE name = ? COLLATE NOCASE", [value]);
  if (!row) {
    let slug = slugify(value);
    if (await one(db, "SELECT id FROM categories WHERE slug = ?", [slug]))
      slug = `${slug}-${Date.now().toString(36)}`;
    await db.unsafe("INSERT INTO categories (name,slug) VALUES (?,?)", [value, slug]);
    row = await one(db, "SELECT id FROM categories WHERE slug = ?", [slug]);
  }
  return asNumber(row?.id);
}
async function replaceValues(db, table, column, filmId, values) {
  await db.unsafe(`DELETE FROM ${table} WHERE film_id = ?`, [filmId]);
  for (const value of values) {
    await db.unsafe(`INSERT OR IGNORE INTO ${table} (film_id,${column}) VALUES (?,?)`, [filmId, value]);
  }
}
function validateFilmInput(body, partial) {
  const result = {};
  if (!partial || body.title !== undefined)
    result.title = checkString(body.title, "title", { required: true, max: 200 });
  for (const key of ["description", "posterUrl", "trailerUrl", "videoUrl", "genre", "category", "region", "language", "cast", "director"]) {
    if (body[key] !== undefined)
      result[key] = checkString(body[key], key, { max: key === "description" ? 8000 : 1000 });
  }
  if (!partial || body.monetization !== undefined) {
    if (!enumValues.monetization.includes(body.monetization)) {
      throw new HttpError(400, "monetization must be free, pay_per_view, subscription, or ad_supported");
    }
    result.monetization = body.monetization;
  }
  if (body.duration !== undefined)
    result.duration = checkNumber(body.duration, "duration", { integer: true, min: 1, max: 1e5 });
  if (body.price !== undefined)
    result.price = checkNumber(body.price, "price", { min: 0, max: 1e7 });
  for (const key of ["isFestivalWinner", "isFeatured"]) {
    const value = checkBoolean(body[key], key);
    if (value !== undefined)
      result[key] = value;
  }
  for (const key of ["tags", "subtitles"]) {
    const value = checkStringArray(body[key], key);
    if (value !== undefined)
      result[key] = value;
  }
  if (body.status !== undefined) {
    if (!enumValues.status.includes(body.status))
      throw new HttpError(400, "Invalid status");
    result.status = body.status;
  }
  if (partial && Object.keys(result).length === 0)
    throw new HttpError(400, "Provide at least one film field to update");
  return result;
}
async function addFilm(db, body) {
  const input = validateFilmInput(body, false);
  const category = await ensureCategory(db, input.category);
  const now = new Date().toISOString();
  const saved = await one(db, `INSERT INTO films (title,description,poster_url,trailer_url,video_url,duration,genre,region,language,
      monetization,price,is_festival_winner,is_featured,creator_id,cast,director,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?,?) RETURNING id`, [
    input.title,
    input.description ?? null,
    input.posterUrl ?? null,
    input.trailerUrl ?? null,
    input.videoUrl ?? null,
    input.duration ?? null,
    input.genre ?? null,
    input.region ?? null,
    input.language ?? null,
    input.monetization,
    input.price ?? null,
    Number(input.isFestivalWinner ?? false),
    Number(input.isFeatured ?? false),
    DEMO_CREATOR_ID,
    input.cast ?? null,
    input.director ?? null,
    now,
    now
  ]);
  const filmId = asNumber(saved?.id);
  if (category !== null)
    await db.unsafe("INSERT INTO film_categories (film_id,category_id) VALUES (?,?)", [filmId, category]);
  await replaceValues(db, "film_tags", "tag", filmId, input.tags ?? []);
  await replaceValues(db, "film_subtitles", "language", filmId, input.subtitles ?? []);
  const result = await getFilm(db, filmId);
  return filmToApi(db, result);
}
function dateOffset(daysAgo) {
  const date = new Date;
  date.setDate(date.getDate() - daysAgo);
  return date;
}
async function dailyActivity(db, days, creatorId) {
  const start = dateOffset(days - 1);
  start.setHours(0, 0, 0, 0);
  const rows = await dbRows(db, `SELECT strftime('%Y-%m-%d', e.started_at) AS day,
      COUNT(*) AS views, SUM(e.seconds_watched) AS seconds_watched
    FROM viewing_events e JOIN films f ON f.id=e.film_id
    WHERE e.started_at >= ? AND f.creator_id=?
    GROUP BY strftime('%Y-%m-%d', e.started_at)`, [start.toISOString(), creatorId]);
  const byDate = new Map(rows.map((row) => [String(row.day), {
    views: asNumber(row.views),
    secondsWatched: asNumber(row.seconds_watched)
  }]));
  return Array.from({ length: days }, (_, index) => {
    const day = dateOffset(days - index - 1).toISOString().slice(0, 10);
    const activity = byDate.get(day) ?? { views: 0, secondsWatched: 0 };
    return { date: day, views: activity.views, secondsWatched: activity.secondsWatched };
  });
}
function emptyResponse(status) {
  return new Response(null, { status });
}
function makeResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export async function uploadedFileResponse(filename, directory = process.env.UPLOAD_DIR ?? "./uploads", rangeHeader = null) {
  if (!/^[\da-f-]{36}\.(?:jpg|png|webp|mp4|webm|mov)$/.test(filename))
    return Response.json({ error: "File not found" }, { status: 404 });
  const file = Bun.file(join(directory, filename));
  if (!await file.exists())
    return Response.json({ error: "File not found" }, { status: 404 });
  const extension = filename.slice(filename.lastIndexOf(".") + 1);
  const contentTypes = {
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime"
  };
  const headers = new Headers({
    "Content-Type": contentTypes[extension],
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes"
  });
  if (!rangeHeader)
    return new Response(file, { headers });
  const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!range || (!range[1] && !range[2]))
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}`, "Accept-Ranges": "bytes" } });
  const start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]));
  const end = range[2] && range[1] ? Math.min(file.size - 1, Number(range[2])) : file.size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size)
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}`, "Accept-Ranges": "bytes" } });
  headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(file.slice(start, end + 1), { status: 206, headers });
}
export function createApiHandler(db, options = {}) {
  const uploadDirectory = options.uploadDirectory ?? process.env.UPLOAD_DIR ?? "./uploads";
  const maxImageBytes = options.maxImageBytes ?? 10 * 1024 * 1024;
  const maxVideoBytes = options.maxVideoBytes ?? 500 * 1024 * 1024;
  return async (request) => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === "OPTIONS")
      return makeResponse(emptyResponse(204));
    if (!url.pathname.startsWith("/api/"))
      return makeResponse(json({ error: "Not found" }, 404));
    const path = url.pathname.slice(4).replace(/\/+$/, "") || "/";
    try {
      if (path === "/healthz" && method === "GET")
        return makeResponse(json({ status: "ok" }));
      if (path === "/uploads" && method === "POST") {
        const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const mediaTypes = {
          "image/jpeg": { extension: "jpg", limit: maxImageBytes, kind: "image" },
          "image/png": { extension: "png", limit: maxImageBytes, kind: "image" },
          "image/webp": { extension: "webp", limit: maxImageBytes, kind: "image" },
          "video/mp4": { extension: "mp4", limit: maxVideoBytes, kind: "video" },
          "video/webm": { extension: "webm", limit: maxVideoBytes, kind: "video" },
          "video/quicktime": { extension: "mov", limit: maxVideoBytes, kind: "video" }
        };
        const media = mediaTypes[contentType];
        if (!media)
          throw new HttpError(415, "Upload a JPEG, PNG, WebP, MP4, WebM, or QuickTime file");
        if (!request.body)
          throw new HttpError(400, "Upload body is empty");
        const declaredLength = request.headers.get("content-length");
        if (declaredLength !== null) {
          const size = Number(declaredLength);
          if (!Number.isSafeInteger(size) || size < 1)
            throw new HttpError(400, "Invalid upload size");
          if (size > media.limit)
            throw new HttpError(413, `Upload exceeds the ${media.kind === "image" ? "10 MB image" : "500 MB video"} limit`);
        }
        const filename = `${randomUUID()}.${media.extension}`;
        const target = join(uploadDirectory, filename);
        let size = 0;
        const boundedBody = request.body.pipeThrough(new TransformStream({
          transform(chunk, controller) {
            size += chunk.byteLength;
            if (size > media.limit) {
              controller.error(new HttpError(413, `Upload exceeds the ${media.kind === "image" ? "10 MB image" : "500 MB video"} limit`));
              return;
            }
            controller.enqueue(chunk);
          }
        }));
        try {
          await mkdir(uploadDirectory, { recursive: true });
          await Bun.write(target, boundedBody);
        } catch (error) {
          await unlink(target).catch(() => {});
          if (error instanceof HttpError)
            throw error;
          throw new HttpError(500, "Could not store the uploaded file");
        }
        return makeResponse(json({ url: `/uploads/${filename}`, type: media.kind, size }));
      }
      if (path === "/films" && method === "GET") {
        const category = url.searchParams.get("category");
        const genre = url.searchParams.get("genre");
        const monetization = url.searchParams.get("monetization");
        const region = url.searchParams.get("region");
        const search = url.searchParams.get("search");
        const sort = url.searchParams.get("sort") ?? "newest";
        if (monetization && !enumValues.monetization.includes(monetization)) {
          throw new HttpError(400, "Invalid monetization filter");
        }
        if (!["newest", "trending", "rating", "views"].includes(sort))
          throw new HttpError(400, "Invalid sort order");
        for (const [label, value] of [["category", category], ["genre", genre], ["region", region], ["search", search]]) {
          if (value && value.length > 200)
            throw new HttpError(400, `${label} filter is too long`);
        }
        const limit = queryInt(url.searchParams.get("limit"), 20, "limit", 100);
        const offset = queryInt(url.searchParams.get("offset"), 0, "offset", 1e6);
        const conditions = ["f.status = 'published'"];
        const args = [];
        if (category) {
          conditions.push("c.name = ? COLLATE NOCASE");
          args.push(category);
        }
        if (genre) {
          conditions.push("f.genre = ? COLLATE NOCASE");
          args.push(genre);
        }
        if (monetization) {
          conditions.push("f.monetization = ?");
          args.push(monetization);
        }
        if (region) {
          conditions.push("f.region = ? COLLATE NOCASE");
          args.push(region);
        }
        if (search) {
          conditions.push("f.title LIKE ? ESCAPE '\\'");
          args.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
        }
        const where = conditions.join(" AND ");
        const order = sort === "views" || sort === "trending" ? "f.view_count DESC" : sort === "rating" ? "f.rating DESC, f.created_at DESC" : "f.created_at DESC";
        const rows = await dbRows(db, `${filmBaseSql} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...args, limit, offset]);
        const count = await one(db, `SELECT COUNT(DISTINCT f.id) AS total FROM films f
          LEFT JOIN film_categories fc ON fc.film_id = f.id LEFT JOIN categories c ON c.id = fc.category_id
          WHERE ${where}`, args);
        return makeResponse(json({ films: await filmsToApi(db, rows), total: asNumber(count?.total) }));
      }
      if (path === "/films" && method === "POST")
        return makeResponse(json(await addFilm(db, await readBody(request)), 201));
      const collections = {
        "/featured": { where: "f.is_featured = 1 AND f.status = 'published'", order: "f.created_at DESC", limit: 6 },
        "/films/featured": { where: "f.is_featured = 1 AND f.status = 'published'", order: "f.created_at DESC", limit: 6 },
        "/trending": { where: "f.status = 'published'", order: "f.view_count DESC", limit: queryInt(url.searchParams.get("limit"), 12, "limit", 100) },
        "/films/trending": { where: "f.status = 'published'", order: "f.view_count DESC", limit: queryInt(url.searchParams.get("limit"), 12, "limit", 100) },
        "/new-releases": { where: "f.status = 'published'", order: "f.created_at DESC", limit: queryInt(url.searchParams.get("limit"), 12, "limit", 100) },
        "/films/new-releases": { where: "f.status = 'published'", order: "f.created_at DESC", limit: queryInt(url.searchParams.get("limit"), 12, "limit", 100) },
        "/festival-winners": { where: "f.is_festival_winner = 1 AND f.status = 'published'", order: "f.view_count DESC", limit: 12 },
        "/films/festival-winners": { where: "f.is_festival_winner = 1 AND f.status = 'published'", order: "f.view_count DESC", limit: 12 },
        "/free-films": { where: "f.monetization = 'free' AND f.status = 'published'", order: "f.view_count DESC", limit: queryInt(url.searchParams.get("limit"), 12, "limit", 100) },
        "/films/free": { where: "f.monetization = 'free' AND f.status = 'published'", order: "f.view_count DESC", limit: queryInt(url.searchParams.get("limit"), 12, "limit", 100) }
      };
      const collection = collections[path];
      if (collection && method === "GET") {
        const rows = await dbRows(db, `${filmBaseSql} WHERE ${collection.where} ORDER BY ${collection.order} LIMIT ?`, [collection.limit]);
        return makeResponse(json(await filmsToApi(db, rows)));
      }
      if (path === "/films/platform-stats" && method === "GET") {
        const stats = await one(db, `SELECT
          (SELECT COUNT(*) FROM films WHERE status='published') AS total_films,
          (SELECT COUNT(*) FROM users WHERE role='creator') AS total_creators,
          (SELECT COALESCE(SUM(view_count),0) FROM films) AS total_views,
          (SELECT COUNT(*) FROM films WHERE status='published' AND monetization='free') AS free_films,
          (SELECT COUNT(*) FROM films WHERE status='published' AND monetization='pay_per_view') AS paid_films`);
        return makeResponse(json({
          totalFilms: asNumber(stats?.total_films),
          totalCreators: asNumber(stats?.total_creators),
          totalViews: asNumber(stats?.total_views),
          totalCountries: 12,
          freeFilms: asNumber(stats?.free_films),
          paidFilms: asNumber(stats?.paid_films)
        }));
      }
      if (path === "/categories" && method === "GET") {
        const categories = await dbRows(db, `SELECT c.id,c.name,c.slug,c.description,c.icon_url,
          COUNT(DISTINCT f.id) AS film_count FROM categories c
          LEFT JOIN film_categories fc ON fc.category_id=c.id LEFT JOIN films f ON f.id=fc.film_id AND f.status='published'
          GROUP BY c.id ORDER BY c.name COLLATE NOCASE`);
        return makeResponse(json(categories.map((row) => ({
          id: asNumber(row.id),
          name: String(row.name),
          slug: String(row.slug),
          description: asText(row.description),
          filmCount: asNumber(row.film_count),
          iconUrl: asText(row.icon_url)
        }))));
      }
      if (path === "/watchlist" && method === "GET") {
        const rows = await dbRows(db, `${filmBaseSql} JOIN watchlist w ON w.film_id=f.id
          WHERE w.user_id=? ORDER BY w.added_at DESC`, [DEMO_USER_ID]);
        return makeResponse(json(await filmsToApi(db, rows)));
      }
      if (path === "/watchlist" && method === "POST") {
        const body = await readBody(request);
        const filmId = checkNumber(body.filmId, "filmId", { integer: true, min: 1 });
        if (!await one(db, "SELECT id FROM films WHERE id = ?", [filmId]))
          throw new HttpError(404, "Film not found");
        await db.unsafe("INSERT OR IGNORE INTO watchlist (user_id,film_id,added_at) VALUES (?,?,?)", [DEMO_USER_ID, filmId, new Date().toISOString()]);
        const entry = await one(db, "SELECT id,user_id,film_id,added_at FROM watchlist WHERE user_id=? AND film_id=?", [DEMO_USER_ID, filmId]);
        return makeResponse(json({ id: asNumber(entry?.id), userId: asNumber(entry?.user_id), filmId: asNumber(entry?.film_id), addedAt: dateString(entry?.added_at) }, 201));
      }
      const watchlistDelete = path.match(/^\/watchlist\/([^/]+)$/);
      if (watchlistDelete && method === "DELETE") {
        const filmId = requiredId(watchlistDelete[1], "film ID");
        await db.unsafe("DELETE FROM watchlist WHERE user_id=? AND film_id=?", [DEMO_USER_ID, filmId]);
        return makeResponse(emptyResponse(204));
      }
      if ((path === "/progress" || path === "/continue-watching") && method === "GET") {
        const rows = await dbRows(db, `SELECT p.*, f.id AS film_id_exists FROM watch_progress p
          JOIN films f ON f.id=p.film_id WHERE p.user_id=? ORDER BY p.updated_at DESC LIMIT 20`, [DEMO_USER_ID]);
        const result = [];
        for (const row of rows) {
          const film = await getFilm(db, asNumber(row.film_id));
          if (!film)
            continue;
          result.push({
            id: asNumber(row.id),
            userId: asNumber(row.user_id),
            filmId: asNumber(row.film_id),
            film: await filmToApi(db, film),
            progressSeconds: asNumber(row.progress_seconds),
            totalSeconds: row.total_seconds === null ? null : asNumber(row.total_seconds),
            percentComplete: asNumber(row.percent_complete),
            updatedAt: dateString(row.updated_at)
          });
        }
        return makeResponse(json(result));
      }
      if ((path === "/progress" || path === "/continue-watching") && method === "POST") {
        const body = await readBody(request);
        const filmId = checkNumber(body.filmId, "filmId", { integer: true, min: 1 });
        const progress = checkNumber(body.progressSeconds, "progressSeconds", { integer: true, min: 0 });
        const total = body.totalSeconds === undefined ? null : checkNumber(body.totalSeconds, "totalSeconds", { integer: true, min: 0 });
        const viewingEventId = body.viewingEventId === undefined ? null : checkNumber(body.viewingEventId, "viewingEventId", { integer: true, min: 1 });
        if (!await one(db, "SELECT id FROM films WHERE id = ?", [filmId]))
          throw new HttpError(404, "Film not found");
        const percent = total && total > 0 ? Math.min(100, progress / total * 100) : 0;
        if (viewingEventId !== null) {
          const event = await one(db, "SELECT id,last_position_seconds FROM viewing_events WHERE id=? AND user_id=? AND film_id=?", [viewingEventId, DEMO_USER_ID, filmId]);
          if (!event)
            throw new HttpError(404, "Viewing session not found");
          const watchedDelta = Math.min(30, Math.max(0, progress - asNumber(event.last_position_seconds)));
          await db.unsafe(`UPDATE viewing_events SET seconds_watched=seconds_watched+?,
            last_position_seconds=?, completed=CASE WHEN ? >= 90 THEN 1 ELSE completed END WHERE id=?`,
          [watchedDelta, progress, percent, viewingEventId]);
        }
        const now = new Date().toISOString();
        const row = await one(db, `INSERT INTO watch_progress (user_id,film_id,progress_seconds,total_seconds,percent_complete,updated_at)
          VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,film_id) DO UPDATE SET
          progress_seconds=excluded.progress_seconds,total_seconds=COALESCE(excluded.total_seconds,watch_progress.total_seconds),
          percent_complete=excluded.percent_complete,updated_at=excluded.updated_at RETURNING *`, [DEMO_USER_ID, filmId, progress, total, percent, now]);
        return makeResponse(json({
          id: asNumber(row?.id),
          userId: asNumber(row?.user_id),
          filmId: asNumber(row?.film_id),
          film: null,
          progressSeconds: asNumber(row?.progress_seconds),
          totalSeconds: row?.total_seconds === null ? null : asNumber(row?.total_seconds),
          percentComplete: asNumber(row?.percent_complete),
          updatedAt: dateString(row?.updated_at)
        }));
      }
      if (path === "/plans" && method === "GET") {
        const plans = await dbRows(db, "SELECT * FROM plans ORDER BY price_monthly");
        const result = [];
        for (const plan of plans) {
          const features = await dbRows(db, "SELECT feature FROM plan_features WHERE plan_id=? ORDER BY rowid", [plan.id]);
          result.push({
            id: asNumber(plan.id),
            name: String(plan.name),
            priceMonthly: asNumber(plan.price_monthly),
            priceAnnual: asNumber(plan.price_annual),
            features: features.map((feature) => String(feature.feature)),
            isPopular: asBoolean(plan.is_popular)
          });
        }
        return makeResponse(json(result));
      }
      if (path === "/creator/films" && method === "GET") {
        const rows = await dbRows(db, `${filmBaseSql} WHERE f.creator_id=? ORDER BY f.created_at DESC`, [DEMO_CREATOR_ID]);
        return makeResponse(json(await filmsToApi(db, rows)));
      }
      if (path === "/creator/dashboard" && method === "GET") {
        const rows = await dbRows(db, `${filmBaseSql} WHERE f.creator_id=?`, [DEMO_CREATOR_ID]);
        const films = await filmsToApi(db, rows);
        const activity = await one(db, `SELECT COUNT(*) AS views FROM viewing_events e
          JOIN films f ON f.id=e.film_id WHERE f.creator_id=?`, [DEMO_CREATOR_ID]);
        const totalViews = asNumber(activity?.views);
        const published = rows.map((row, index) => ({ row, film: films[index] })).filter((item) => item.row.status === "published");
        const viewCounts = await dbRows(db, `SELECT film_id,COUNT(*) AS views FROM viewing_events
          WHERE film_id IN (SELECT id FROM films WHERE creator_id=?) GROUP BY film_id`, [DEMO_CREATOR_ID]);
        const viewsByFilm = new Map(viewCounts.map((item) => [asNumber(item.film_id), asNumber(item.views)]));
        const topFilm = published.reduce((best, item) => {
          const views = viewsByFilm.get(asNumber(item.row.id)) ?? 0;
          return !best || views > best.views ? { film: item.film, views } : best;
        }, null)?.film ?? null;
        const recentViews = (await dailyActivity(db, 7, DEMO_CREATOR_ID)).map(({ date, views }) => ({ date, views }));
        return makeResponse(json({
          totalFilms: rows.length,
          publishedFilms: rows.filter((row) => row.status === "published").length,
          totalViews,
          totalEarnings: null,
          earningsAvailable: false,
          pendingWithdrawal: null,
          topFilm,
          recentViews
        }));
      }
      if (path === "/creator/analytics" && method === "GET") {
        const stats = await one(db, `SELECT COUNT(e.id) AS total_views,
            COALESCE(SUM(e.seconds_watched),0) AS total_watch_time,
            COALESCE(AVG(CASE WHEN f.duration > 0 THEN MIN(100.0,e.seconds_watched * 100.0 / f.duration) END),0) AS completion_rate
          FROM viewing_events e JOIN films f ON f.id=e.film_id WHERE f.creator_id=?`, [DEMO_CREATOR_ID]);
        const rating = await one(db, "SELECT AVG(rating) AS average FROM films WHERE creator_id=? AND rating IS NOT NULL", [DEMO_CREATOR_ID]);
        const viewsByDay = await dailyActivity(db, 30, DEMO_CREATOR_ID);
        return makeResponse(json({
          totalViews: asNumber(stats?.total_views),
          totalWatchTime: Math.floor(asNumber(stats?.total_watch_time) / 60),
          avgRating: Math.round(asNumber(rating?.average) * 10) / 10,
          avgWatchThroughRate: Math.round(asNumber(stats?.completion_rate) * 10) / 10,
          topRegions: [],
          viewsByDay
        }));
      }
      const filmAnalyticsMatch = path.match(/^\/creator\/analytics\/([^/]+)$/);
      if (filmAnalyticsMatch && method === "GET") {
        const filmId = requiredId(filmAnalyticsMatch[1], "film ID");
        const film = await one(db, `${filmBaseSql} WHERE f.id=?`, [filmId]);
        if (!film)
          throw new HttpError(404, "Film not found");
        const activity = await one(db, `SELECT COUNT(*) AS views, COALESCE(SUM(e.seconds_watched),0) AS seconds_watched,
            COALESCE(AVG(CASE WHEN f.duration > 0 THEN MIN(100.0,e.seconds_watched * 100.0 / f.duration) END),0) AS completion_rate
          FROM viewing_events e JOIN films f ON f.id=e.film_id WHERE e.film_id=?`, [filmId]);
        const views = asNumber(activity?.views);
        return makeResponse(json({
          filmId,
          views,
          uniqueViewers: views,
          watchTime: Math.floor(asNumber(activity?.seconds_watched) / 60),
          avgWatchThrough: Math.round(asNumber(activity?.completion_rate) * 10) / 10,
          rating: asNumber(film.rating),
          ppvSales: null,
          ppvRevenue: null,
          topRegions: [],
          viewsByDay: await dailyActivity(db, 30, DEMO_CREATOR_ID)
        }));
      }
      if (path === "/creator/earnings" && method === "GET") {
        const rows = await dbRows(db, "SELECT * FROM withdrawals WHERE creator_id=? ORDER BY requested_at DESC", [DEMO_CREATOR_ID]);
        return makeResponse(json({
          available: false,
          message: "Revenue and payouts are unavailable until payment settlements are connected.",
          totalEarned: null,
          availableBalance: null,
          pendingBalance: null,
          currency: "KES",
          subscriptionRevenue: null,
          ppvRevenue: null,
          adRevenue: null,
          withdrawals: rows.map((row) => ({
            id: asNumber(row.id),
            amount: asNumber(row.amount),
            method: String(row.method),
            status: String(row.status),
            createdAt: dateString(row.requested_at)
          }))
        }));
      }
      if (path === "/creator/withdrawals" && method === "GET") {
        const rows = await dbRows(db, "SELECT * FROM withdrawals WHERE creator_id=? ORDER BY requested_at DESC", [DEMO_CREATOR_ID]);
        return makeResponse(json(rows.map((row) => ({
          id: asNumber(row.id),
          amount: asNumber(row.amount),
          currency: String(row.currency),
          method: String(row.method),
          accountDetails: String(row.account_details),
          status: String(row.status),
          requestedAt: dateString(row.requested_at),
          completedAt: row.completed_at ? dateString(row.completed_at) : null
        }))));
      }
      if (path === "/creator/withdrawals" && method === "POST") {
        return makeResponse(json({ error: "Payout requests are disabled until a payment settlement provider is connected" }, 503));
      }
      const filmReviews = path.match(/^\/films\/([^/]+)\/reviews$/);
      if (filmReviews) {
        const filmId = requiredId(filmReviews[1], "film ID");
        if (method === "GET") {
          const rows = await dbRows(db, `SELECT r.*,u.name AS user_name FROM reviews r
            LEFT JOIN users u ON u.id=r.user_id WHERE r.film_id=? ORDER BY r.created_at DESC`, [filmId]);
          return makeResponse(json(rows.map((row) => ({
            id: asNumber(row.id),
            filmId: asNumber(row.film_id),
            userId: asNumber(row.user_id),
            userName: asText(row.user_name) ?? "Anonymous",
            rating: asNumber(row.rating),
            comment: asText(row.comment),
            createdAt: dateString(row.created_at)
          }))));
        }
        if (method === "POST") {
          const body = await readBody(request);
          const rating = checkNumber(body.rating, "rating", { integer: true, min: 1, max: 5 });
          const comment = checkString(body.comment, "comment", { max: 2000 });
          if (!await one(db, "SELECT id FROM films WHERE id=?", [filmId]))
            throw new HttpError(404, "Film not found");
          const saved = await one(db, `INSERT INTO reviews (film_id,user_id,rating,comment,created_at)
            VALUES (?,?,?,?,?) RETURNING *`, [filmId, DEMO_USER_ID, rating, comment ?? null, new Date().toISOString()]);
          const aggregate = await one(db, "SELECT COUNT(*) AS count,AVG(rating) AS rating FROM reviews WHERE film_id=?", [filmId]);
          await db.unsafe("UPDATE films SET review_count=?,rating=? WHERE id=?", [
            asNumber(aggregate?.count),
            Math.round(asNumber(aggregate?.rating) * 10) / 10,
            filmId
          ]);
          return makeResponse(json({
            id: asNumber(saved?.id),
            filmId,
            userId: DEMO_USER_ID,
            userName: "Amara Okafor",
            rating,
            comment: comment ?? null,
            createdAt: dateString(saved?.created_at)
          }, 201));
        }
      }
      const startViewing = path.match(/^\/films\/([^/]+)\/view$/);
      if (startViewing && method === "POST") {
        const filmId = requiredId(startViewing[1], "film ID");
        const film = await one(db, "SELECT id FROM films WHERE id=? AND status='published'", [filmId]);
        if (!film)
          throw new HttpError(404, "Film not found");
        const event = await one(db, "INSERT INTO viewing_events (user_id,film_id,started_at) VALUES (?,?,?) RETURNING id", [DEMO_USER_ID, filmId, new Date().toISOString()]);
        await db.unsafe("UPDATE films SET view_count=view_count+1 WHERE id=?", [filmId]);
        return makeResponse(json({ viewingEventId: asNumber(event?.id) }, 201));
      }
      const filmPath = path.match(/^\/films\/([^/]+)(?:\/(related))?$/);
      if (filmPath) {
        const filmId = requiredId(filmPath[1], "film ID");
        if (filmPath[2] === "related" && method === "GET") {
          const base = await one(db, "SELECT genre FROM films WHERE id=?", [filmId]);
          if (!base)
            return makeResponse(json([]));
          const related = await dbRows(db, `${filmBaseSql} WHERE f.status='published' AND f.genre IS ?
            AND f.id<>? ORDER BY f.view_count DESC LIMIT 6`, [base.genre ?? null, filmId]);
          return makeResponse(json(await filmsToApi(db, related)));
        }
        if (!filmPath[2] && method === "GET") {
          const film = await getFilm(db, filmId);
          if (!film)
            throw new HttpError(404, "Film not found");
          const detail = await filmToApi(db, film, true);
          const inWatchlist = await one(db, "SELECT id FROM watchlist WHERE user_id=? AND film_id=?", [DEMO_USER_ID, filmId]);
          const progress = await one(db, "SELECT progress_seconds FROM watch_progress WHERE user_id=? AND film_id=?", [DEMO_USER_ID, filmId]);
          detail.isInWatchlist = Boolean(inWatchlist);
          detail.watchProgress = progress ? asNumber(progress.progress_seconds) : null;
          return makeResponse(json(detail));
        }
        if (!filmPath[2] && method === "PATCH") {
          const input = validateFilmInput(await readBody(request), true);
          const categoryProvided = Object.hasOwn(input, "category");
          const categoryId = categoryProvided ? await ensureCategory(db, input.category) : undefined;
          const columns = {
            title: "title",
            description: "description",
            posterUrl: "poster_url",
            trailerUrl: "trailer_url",
            videoUrl: "video_url",
            duration: "duration",
            genre: "genre",
            region: "region",
            language: "language",
            monetization: "monetization",
            price: "price",
            isFestivalWinner: "is_festival_winner",
            isFeatured: "is_featured",
            cast: "cast",
            director: "director",
            status: "status"
          };
          const sets = [];
          const values = [];
          for (const [key, column] of Object.entries(columns)) {
            if (Object.hasOwn(input, key)) {
              sets.push(`${column}=?`);
              const value = input[key];
              values.push(typeof value === "boolean" ? Number(value) : value);
            }
          }
          sets.push("updated_at=?");
          values.push(new Date().toISOString(), filmId);
          const updated = await one(db, `UPDATE films SET ${sets.join(",")} WHERE id=? RETURNING id`, values);
          if (!updated)
            throw new HttpError(404, "Film not found");
          if (categoryProvided) {
            await db.unsafe("DELETE FROM film_categories WHERE film_id=?", [filmId]);
            if (categoryId !== null)
              await db.unsafe("INSERT INTO film_categories (film_id,category_id) VALUES (?,?)", [filmId, categoryId]);
          }
          if (input.tags)
            await replaceValues(db, "film_tags", "tag", filmId, input.tags);
          if (input.subtitles)
            await replaceValues(db, "film_subtitles", "language", filmId, input.subtitles);
          return makeResponse(json(await filmToApi(db, await getFilm(db, filmId))));
        }
        if (!filmPath[2] && method === "DELETE") {
          await db.unsafe("DELETE FROM films WHERE id=?", [filmId]);
          return makeResponse(emptyResponse(204));
        }
      }
      throw new HttpError(404, "Not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500)
        console.error("API request failed", error);
      const message = error instanceof HttpError ? error.message : "Internal server error";
      return makeResponse(json({ error: message }, status));
    }
  };
}
