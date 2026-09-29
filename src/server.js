import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
const SESSION_COOKIE = "filamureel_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 14;
const authRoles = ["audience", "creator", "admin"];
function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
function parseCookies(request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return new Map(cookieHeader.split(";").map((part) => {
    const separator = part.indexOf("=");
    return separator < 0 ? [part.trim(), ""] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }));
}
function setSessionCookie(response, token, expiresAt) {
  const headers = new Headers(response.headers);
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  headers.append("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function clearSessionCookie(response) {
  const headers = new Headers(response.headers);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function publicUser(row) {
  return {
    id: asNumber(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role),
    region: asText(row.region),
    status: String(row.account_status),
    isDemo: asBoolean(row.is_demo),
    createdAt: dateString(row.created_at)
  };
}
function publicRoute(path, method) {
  if (method === "GET" && (path === "/healthz" || path === "/films" || path === "/films/platform-stats" ||
    path === "/categories" || path === "/plans" || ["/featured", "/films/featured", "/trending", "/films/trending",
      "/new-releases", "/films/new-releases", "/festival-winners", "/films/festival-winners",
      "/free-films", "/films/free"].includes(path)))
    return true;
  if (method === "GET" && /^\/films\/\d+(?:\/(?:related|reviews))?$/.test(path))
    return true;
  return false;
}

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
async function addFilm(db, body, creatorId) {
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
    creatorId,
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
    FROM viewing_events e JOIN films f ON f.id=e.film_id JOIN users u ON u.id=e.user_id
    WHERE e.started_at >= ? AND f.creator_id=? AND e.media_type='film' AND u.is_demo=0
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
  const authAttempts = new Map();
  const checkAuthRate = (request, path) => {
    const operation = path === "/auth/login" ? "login" : "register";
    const key = `${request.headers.get("x-real-ip") ?? "direct"}:${operation}`;
    const cutoff = Date.now() - 60_000;
    const attempts = (authAttempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    const limit = operation === "login" ? 10 : 5;
    if (attempts.length >= limit)
      throw new HttpError(429, "Too many attempts. Try again in a minute.");
    attempts.push(Date.now());
    authAttempts.set(key, attempts);
  };
  const createSession = async (userId) => {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await db.unsafe("INSERT INTO sessions (user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?)",
      [userId, hashSessionToken(token), expiresAt.toISOString(), new Date().toISOString()]);
    return { token, expiresAt };
  };
  const recordAdminAction = async (adminId, action, entityType, entityId = null, queryDb = db) => {
    await queryDb.unsafe("INSERT INTO admin_audit_log (admin_user_id,action,entity_type,entity_id,created_at) VALUES (?,?,?,?,?)",
      [adminId, action, entityType, entityId, new Date().toISOString()]);
  };
  return async (request) => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === "OPTIONS")
      return makeResponse(emptyResponse(204));
    if (!url.pathname.startsWith("/api/"))
      return makeResponse(json({ error: "Not found" }, 404));
    const path = url.pathname.slice(4).replace(/\/+$/, "") || "/";
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        const origin = request.headers.get("origin");
        if (origin && origin !== url.origin)
          throw new HttpError(403, "Cross-origin requests are not allowed");
      }
      if (path === "/auth/register" && method === "POST") {
        checkAuthRate(request, path);
        const body = await readBody(request);
        const name = checkString(body.name, "name", { required: true, max: 100 });
        const email = checkString(body.email, "email", { required: true, max: 254 }).toLowerCase();
        const password = checkString(body.password, "password", { required: true, max: 128 });
        const role = body.role;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw new HttpError(400, "Enter a valid email address");
        if (password.length < 12)
          throw new HttpError(400, "Password must be at least 12 characters");
        if (!["audience", "creator"].includes(role))
          throw new HttpError(400, "Choose an audience or creator account");
        if (await one(db, "SELECT id FROM users WHERE email=? COLLATE NOCASE", [email]))
          throw new HttpError(409, "An account with that email already exists");
        const now = new Date().toISOString();
        const passwordHash = await Bun.password.hash(password);
        let user;
        try {
          user = await one(db, `INSERT INTO users (name,email,role,password_hash,account_status,is_demo,is_verified,created_at,updated_at)
            VALUES (?,?,?,?,'active',0,0,?,?) RETURNING *`, [name, email, role, passwordHash, now, now]);
        } catch (error) {
          if (error instanceof Error && /unique constraint/i.test(error.message))
            throw new HttpError(409, "An account with that email already exists");
          throw error;
        }
        const session = await createSession(asNumber(user?.id));
        return makeResponse(setSessionCookie(json({ user: publicUser(user) }, 201), session.token, session.expiresAt));
      }
      if (path === "/auth/login" && method === "POST") {
        checkAuthRate(request, path);
        const body = await readBody(request);
        const email = checkString(body.email, "email", { required: true, max: 254 }).toLowerCase();
        const password = checkString(body.password, "password", { required: true, max: 128 });
        const user = await one(db, "SELECT * FROM users WHERE email=? COLLATE NOCASE", [email]);
        if (!user?.password_hash || !await Bun.password.verify(password, String(user.password_hash)))
          throw new HttpError(401, "Email or password is incorrect");
        if (user.account_status !== "active")
          throw new HttpError(403, "This account is suspended");
        const session = await createSession(asNumber(user.id));
        return makeResponse(setSessionCookie(json({ user: publicUser(user) }), session.token, session.expiresAt));
      }
      if (path === "/auth/me" && method === "GET") {
        const token = parseCookies(request).get(SESSION_COOKIE);
        const session = token ? await one(db, `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.token_hash=? AND s.expires_at>? AND u.account_status='active'`, [hashSessionToken(token), new Date().toISOString()]) : null;
        return makeResponse(json({ user: session ? publicUser(session) : null }));
      }
      if (path === "/auth/logout" && method === "POST") {
        const token = parseCookies(request).get(SESSION_COOKIE);
        if (token)
          await db.unsafe("DELETE FROM sessions WHERE token_hash=?", [hashSessionToken(token)]);
        return makeResponse(clearSessionCookie(emptyResponse(204)));
      }
      if (path === "/healthz" && method === "GET")
        return makeResponse(json({ status: "ok" }));
      const sessionToken = parseCookies(request).get(SESSION_COOKIE);
      const currentUser = sessionToken ? await one(db, `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>? AND u.account_status='active'`,
      [hashSessionToken(sessionToken), new Date().toISOString()]) : null;
      if (!currentUser && !publicRoute(path, method))
        throw new HttpError(401, "Sign in to continue");
      if (path.startsWith("/admin/") && currentUser?.role !== "admin")
        throw new HttpError(403, "Administrator access required");
      if (path.startsWith("/creator/") && currentUser?.role !== "creator")
        throw new HttpError(403, "Creator account required");
      if (path === "/uploads" && method === "POST" && !["creator", "admin"].includes(currentUser?.role))
        throw new HttpError(403, "Creator account required to upload media");
      if (path === "/films" && method === "POST" && currentUser?.role !== "creator")
        throw new HttpError(403, "Creator account required to publish films");
      const userId = asNumber(currentUser?.id);
      const creatorId = userId;
      if (path === "/account/subscription" && method === "GET") {
        const subscription = await one(db, `SELECT s.id,s.status,s.starts_at,s.ends_at,p.name AS plan_name,
          p.price_monthly,p.price_annual FROM subscriptions s JOIN plans p ON p.id=s.plan_id
          WHERE s.user_id=? ORDER BY s.created_at DESC LIMIT 1`, [userId]);
        return makeResponse(json(subscription ? {
          id: asNumber(subscription.id), status: String(subscription.status), planName: String(subscription.plan_name),
          priceMonthly: asNumber(subscription.price_monthly), priceAnnual: asNumber(subscription.price_annual),
          startsAt: dateString(subscription.starts_at), endsAt: subscription.ends_at ? dateString(subscription.ends_at) : null
        } : null));
      }
      if (path === "/admin/overview" && method === "GET") {
        const overview = await one(db, `SELECT
          (SELECT COUNT(*) FROM users WHERE is_demo=0) AS users,
          (SELECT COUNT(*) FROM users WHERE is_demo=0 AND account_status='active') AS active_users,
          (SELECT COUNT(*) FROM users WHERE is_demo=0 AND role='audience') AS audience_accounts,
          (SELECT COUNT(*) FROM users WHERE is_demo=0 AND role='creator') AS creator_accounts,
          (SELECT COUNT(*) FROM users WHERE is_demo=0 AND created_at>=?) AS new_users_30d,
          (SELECT COUNT(*) FROM films f JOIN users u ON u.id=f.creator_id WHERE u.is_demo=0) AS films,
          (SELECT COUNT(*) FROM films f JOIN users u ON u.id=f.creator_id WHERE u.is_demo=0 AND f.status='published') AS published_films,
          (SELECT COUNT(*) FROM films f JOIN users u ON u.id=f.creator_id WHERE u.is_demo=0 AND f.status='pending') AS pending_films,
          (SELECT COUNT(*) FROM viewing_events e JOIN users u ON u.id=e.user_id WHERE u.is_demo=0 AND e.media_type='film') AS film_plays,
          (SELECT COUNT(DISTINCT e.user_id) FROM viewing_events e JOIN users u ON u.id=e.user_id WHERE u.is_demo=0 AND e.media_type='film') AS unique_viewers,
          (SELECT COALESCE(SUM(e.seconds_watched),0) FROM viewing_events e JOIN users u ON u.id=e.user_id WHERE u.is_demo=0 AND e.media_type='film') AS seconds_watched,
          (SELECT COUNT(*) FROM reviews WHERE is_demo=0) AS reviews,
          (SELECT COUNT(*) FROM reviews WHERE is_demo=0 AND status='hidden') AS hidden_reviews,
          (SELECT COUNT(*) FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE u.is_demo=0 AND s.status='active') AS active_subscriptions,
          (SELECT COUNT(*) FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.is_demo=0 AND u.account_status='active' AND s.expires_at>?) AS active_sessions`,
        [new Date(Date.now() - 30 * 86400000).toISOString(), new Date().toISOString()]);
        const revenueRows = await dbRows(db, `SELECT currency,
          SUM(CASE WHEN transaction_type='refund' THEN -amount_cents ELSE amount_cents END) AS net_cents,
          COUNT(*) AS transactions FROM transactions t JOIN users u ON u.id=t.user_id
          WHERE u.is_demo=0 AND t.status='succeeded' AND t.verified_at IS NOT NULL GROUP BY currency ORDER BY currency`);
        const dailyViews = await dbRows(db, `SELECT strftime('%Y-%m-%d',e.started_at) AS day,COUNT(*) AS plays
          FROM viewing_events e JOIN users u ON u.id=e.user_id WHERE u.is_demo=0 AND e.media_type='film'
          AND e.started_at>=? GROUP BY day ORDER BY day`, [new Date(Date.now() - 29 * 86400000).toISOString()]);
        const recentReviews = await dbRows(db, `SELECT r.id,r.rating,r.comment,r.status,r.created_at,f.title AS film_title,u.name AS user_name
          FROM reviews r JOIN films f ON f.id=r.film_id JOIN users u ON u.id=r.user_id
          WHERE r.is_demo=0 ORDER BY r.created_at DESC LIMIT 8`);
        return makeResponse(json({
          users: asNumber(overview?.users),
          activeUsers: asNumber(overview?.active_users),
          audienceAccounts: asNumber(overview?.audience_accounts),
          creatorAccounts: asNumber(overview?.creator_accounts),
          newUsers30d: asNumber(overview?.new_users_30d),
          films: asNumber(overview?.films),
          publishedFilms: asNumber(overview?.published_films),
          pendingFilms: asNumber(overview?.pending_films),
          filmPlays: asNumber(overview?.film_plays),
          uniqueViewers: asNumber(overview?.unique_viewers),
          watchTimeSeconds: asNumber(overview?.seconds_watched),
          reviews: asNumber(overview?.reviews),
          hiddenReviews: asNumber(overview?.hidden_reviews),
          activeSubscriptions: asNumber(overview?.active_subscriptions),
          activeSessions: asNumber(overview?.active_sessions),
          revenue: revenueRows.map((row) => ({
            currency: String(row.currency),
            netAmount: asNumber(row.net_cents) / 100,
            verifiedTransactions: asNumber(row.transactions)
          })),
          revenueAvailable: revenueRows.length > 0,
          paymentIntegrationAvailable: false,
          playsByDay: dailyViews.map((row) => ({ date: String(row.day), plays: asNumber(row.plays) })),
          recentReviews: recentReviews.map((row) => ({
            id: asNumber(row.id), rating: asNumber(row.rating), comment: asText(row.comment),
            status: String(row.status), filmTitle: String(row.film_title), userName: String(row.user_name),
            createdAt: dateString(row.created_at)
          }))
        }));
      }
      if (path === "/admin/users" && method === "GET") {
        const search = url.searchParams.get("search")?.trim() ?? "";
        if (search.length > 200)
          throw new HttpError(400, "Search text is too long");
        const limit = queryInt(url.searchParams.get("limit"), 50, "limit", 100);
        const offset = queryInt(url.searchParams.get("offset"), 0, "offset", 1e6);
        const filter = search ? "WHERE u.is_demo=0 AND (u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')" : "WHERE u.is_demo=0";
        const args = search ? [`%${search.replace(/[\\%_]/g, "\\$&")}%`, `%${search.replace(/[\\%_]/g, "\\$&")}%`] : [];
        const users = await dbRows(db, `SELECT u.id,u.name,u.email,u.role,u.account_status,u.created_at,
          COUNT(DISTINCT s.id) AS active_subscriptions FROM users u
          LEFT JOIN subscriptions s ON s.user_id=u.id AND s.status='active'
          ${filter} GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
        const count = await one(db, `SELECT COUNT(*) AS total FROM users u ${filter}`, args);
        return makeResponse(json({
          users: users.map((row) => ({
            id: asNumber(row.id), name: String(row.name), email: String(row.email), role: String(row.role),
            status: String(row.account_status), activeSubscriptions: asNumber(row.active_subscriptions),
            createdAt: dateString(row.created_at)
          })),
          total: asNumber(count?.total)
        }));
      }
      if (path === "/admin/users" && method === "PATCH") {
        const body = await readBody(request);
        const targetId = checkNumber(body.userId, "userId", { integer: true, min: 1 });
        const role = body.role;
        const status = body.status;
        if (role !== undefined && !["audience", "creator"].includes(role))
          throw new HttpError(400, "Role must be audience or creator");
        if (status !== undefined && !["active", "suspended"].includes(status))
          throw new HttpError(400, "Status must be active or suspended");
        if (role === undefined && status === undefined)
          throw new HttpError(400, "Provide a role or account status");
        const target = await one(db, "SELECT id,role,is_demo FROM users WHERE id=?", [targetId]);
        if (!target || asBoolean(target.is_demo))
          throw new HttpError(404, "Account not found");
        if (target.role === "admin")
          throw new HttpError(403, "Administrator accounts cannot be modified here");
        if (targetId === userId && status === "suspended")
          throw new HttpError(409, "You cannot suspend your own administrator account");
        const update = [];
        const values = [];
        if (role !== undefined) { update.push("role=?"); values.push(role); }
        if (status !== undefined) { update.push("account_status=?"); values.push(status); }
        update.push("updated_at=?");
        values.push(new Date().toISOString(), targetId);
        await db.unsafe(`UPDATE users SET ${update.join(",")} WHERE id=?`, values);
        if (status === "suspended")
          await db.unsafe("DELETE FROM sessions WHERE user_id=?", [targetId]);
        await recordAdminAction(userId, `user.updated:${role ?? ""}:${status ?? ""}`, "user", targetId);
        return makeResponse(json({ userId: targetId, role: role ?? String(target.role), status: status ?? "unchanged" }));
      }
      if (path === "/admin/reviews" && method === "GET") {
        const reviews = await dbRows(db, `SELECT r.id,r.film_id,r.user_id,r.rating,r.comment,r.status,r.created_at,
          f.title AS film_title,u.name AS user_name FROM reviews r JOIN films f ON f.id=r.film_id
          JOIN users u ON u.id=r.user_id WHERE r.is_demo=0 ORDER BY r.created_at DESC LIMIT 200`);
        return makeResponse(json(reviews.map((row) => ({
          id: asNumber(row.id), filmId: asNumber(row.film_id), userId: asNumber(row.user_id),
          rating: asNumber(row.rating), comment: asText(row.comment), status: String(row.status),
          filmTitle: String(row.film_title), userName: String(row.user_name), createdAt: dateString(row.created_at)
        }))));
      }
      if (path === "/admin/films" && method === "GET") {
        const rows = await dbRows(db, `${filmBaseSql} JOIN users owner ON owner.id=f.creator_id
          WHERE owner.is_demo=0 ORDER BY CASE f.status WHEN 'pending' THEN 0 ELSE 1 END,f.created_at DESC LIMIT 300`);
        return makeResponse(json(await filmsToApi(db, rows)));
      }
      const adminFilm = path.match(/^\/admin\/films\/([1-9]\d*)$/);
      if (adminFilm && method === "PATCH") {
        const filmId = requiredId(adminFilm[1], "film ID");
        const body = await readBody(request);
        const updates = [];
        const values = [];
        if (body.status !== undefined) {
          if (!enumValues.status.includes(body.status))
            throw new HttpError(400, "Invalid film status");
          updates.push("status=?");
          values.push(body.status);
        }
        for (const [key, column] of [["isFeatured", "is_featured"], ["isFestivalWinner", "is_festival_winner"]]) {
          const value = checkBoolean(body[key], key);
          if (value !== undefined) {
            updates.push(`${column}=?`);
            values.push(Number(value));
          }
        }
        if (!updates.length)
          throw new HttpError(400, "Provide a status or editorial flag");
        updates.push("updated_at=?");
        values.push(new Date().toISOString(), filmId);
        const film = await one(db, `UPDATE films SET ${updates.join(",")} WHERE id=?
          AND creator_id IN (SELECT id FROM users WHERE is_demo=0) RETURNING id`, values);
        if (!film)
          throw new HttpError(404, "Film not found");
        await recordAdminAction(userId, `film.updated:${body.status ?? "editorial"}`, "film", filmId);
        return makeResponse(json({ id: filmId, updated: true }));
      }
      const adminReview = path.match(/^\/admin\/reviews\/([1-9]\d*)$/);
      if (adminReview && method === "PATCH") {
        const reviewId = requiredId(adminReview[1], "review ID");
        const body = await readBody(request);
        if (!["published", "hidden"].includes(body.status))
          throw new HttpError(400, "Review status must be published or hidden");
        const review = await one(db, "UPDATE reviews SET status=? WHERE id=? AND is_demo=0 RETURNING film_id", [body.status, reviewId]);
        if (!review)
          throw new HttpError(404, "Review not found");
        await one(db, `UPDATE films SET review_count=(
          SELECT COUNT(*) FROM reviews WHERE film_id=? AND is_demo=0 AND status='published'
        ),rating=(
          SELECT AVG(rating) FROM reviews WHERE film_id=? AND is_demo=0 AND status='published'
        ) WHERE id=? RETURNING id`, [review.film_id, review.film_id, review.film_id]);
        await recordAdminAction(userId, `review.${body.status}`, "review", reviewId);
        return makeResponse(json({ id: reviewId, status: body.status }));
      }
      if (path === "/admin/subscriptions" && method === "GET") {
        const rows = await dbRows(db, `SELECT s.id,s.user_id,s.plan_id,s.status,s.provider,s.provider_reference,s.starts_at,s.ends_at,
          u.name AS user_name,u.email,p.name AS plan_name FROM subscriptions s JOIN users u ON u.id=s.user_id
          JOIN plans p ON p.id=s.plan_id WHERE u.is_demo=0 ORDER BY s.created_at DESC LIMIT 200`);
        return makeResponse(json(rows.map((row) => ({
          id: asNumber(row.id), userId: asNumber(row.user_id), planId: asNumber(row.plan_id),
          userName: String(row.user_name), email: String(row.email), planName: String(row.plan_name),
          status: String(row.status), provider: asText(row.provider) ?? "admin",
          providerReference: asText(row.provider_reference), startsAt: dateString(row.starts_at),
          endsAt: row.ends_at ? dateString(row.ends_at) : null
        }))));
      }
      if (path === "/admin/subscriptions" && method === "POST") {
        const body = await readBody(request);
        const targetUserId = checkNumber(body.userId, "userId", { integer: true, min: 1 });
        const planId = checkNumber(body.planId, "planId", { integer: true, min: 1 });
        const status = body.status ?? "active";
        if (!["active", "canceled", "expired", "past_due"].includes(status))
          throw new HttpError(400, "Invalid subscription status");
        const target = await one(db, "SELECT id FROM users WHERE id=? AND is_demo=0 AND account_status='active'", [targetUserId]);
        if (!target)
          throw new HttpError(404, "Active account not found");
        if (!await one(db, "SELECT id FROM plans WHERE id=?", [planId]))
          throw new HttpError(404, "Plan not found");
        const now = new Date().toISOString();
        const subscription = await one(db, `INSERT INTO subscriptions (user_id,plan_id,status,provider,starts_at,created_at,updated_at)
          VALUES (?,?,?,'admin',?,?,?) RETURNING id`, [targetUserId, planId, status, now, now, now]);
        await recordAdminAction(userId, `subscription.created:${status}`, "subscription", asNumber(subscription?.id));
        return makeResponse(json({ id: asNumber(subscription?.id), userId: targetUserId, planId, status, provider: "admin" }, 201));
      }
      const adminSubscription = path.match(/^\/admin\/subscriptions\/([1-9]\d*)$/);
      if (adminSubscription && method === "PATCH") {
        const subscriptionId = requiredId(adminSubscription[1], "subscription ID");
        const body = await readBody(request);
        if (!["active", "canceled", "expired", "past_due"].includes(body.status))
          throw new HttpError(400, "Invalid subscription status");
        const now = new Date().toISOString();
        const subscription = await one(db, `UPDATE subscriptions SET status=?,updated_at=? WHERE id=?
          AND user_id IN (SELECT id FROM users WHERE is_demo=0) RETURNING id`, [body.status, now, subscriptionId]);
        if (!subscription)
          throw new HttpError(404, "Subscription not found");
        await recordAdminAction(userId, `subscription.updated:${body.status}`, "subscription", subscriptionId);
        return makeResponse(json({ id: subscriptionId, status: body.status }));
      }
      if (path === "/admin/transactions" && method === "GET") {
        const rows = await dbRows(db, `SELECT t.id,t.user_id,t.subscription_id,t.film_id,t.creator_id,t.provider,
          t.provider_reference,t.transaction_type,t.amount_cents,t.currency,t.status,t.verified_at,t.created_at,
          u.name AS user_name FROM transactions t LEFT JOIN users u ON u.id=t.user_id
          WHERE COALESCE(u.is_demo,0)=0 ORDER BY t.created_at DESC LIMIT 200`);
        return makeResponse(json(rows.map((row) => ({
          id: asNumber(row.id), userId: row.user_id === null ? null : asNumber(row.user_id),
          userName: asText(row.user_name), subscriptionId: row.subscription_id === null ? null : asNumber(row.subscription_id),
          filmId: row.film_id === null ? null : asNumber(row.film_id), creatorId: row.creator_id === null ? null : asNumber(row.creator_id),
          provider: String(row.provider), providerReference: String(row.provider_reference),
          type: String(row.transaction_type), amount: asNumber(row.amount_cents) / 100, currency: String(row.currency),
          status: String(row.status), verifiedAt: row.verified_at ? dateString(row.verified_at) : null,
          createdAt: dateString(row.created_at)
        }))));
      }
      if (path === "/admin/plans" && method === "GET") {
        const plans = await dbRows(db, "SELECT * FROM plans ORDER BY price_monthly");
        const result = [];
        for (const plan of plans) {
          const features = await dbRows(db, "SELECT feature FROM plan_features WHERE plan_id=? ORDER BY feature", [plan.id]);
          result.push({ id: asNumber(plan.id), name: String(plan.name), priceMonthly: asNumber(plan.price_monthly),
            priceAnnual: asNumber(plan.price_annual), isPopular: asBoolean(plan.is_popular),
            features: features.map((feature) => String(feature.feature)) });
        }
        return makeResponse(json(result));
      }
      if (path === "/admin/plans" && method === "POST") {
        const body = await readBody(request);
        const name = checkString(body.name, "name", { required: true, max: 100 });
        const monthly = checkNumber(body.priceMonthly, "priceMonthly", { min: 0, max: 1e7 });
        const annual = checkNumber(body.priceAnnual, "priceAnnual", { min: 0, max: 1e8 });
        const features = checkStringArray(body.features ?? [], "features");
        const isPopular = checkBoolean(body.isPopular, "isPopular");
        if (await one(db, "SELECT id FROM plans WHERE name=? COLLATE NOCASE", [name]))
          throw new HttpError(409, "A plan with this name already exists");
        let plan;
        await db.begin(async (tx) => {
          plan = await one(tx, "INSERT INTO plans (name,price_monthly,price_annual,is_popular) VALUES (?,?,?,?) RETURNING id",
            [name, monthly, annual, Number(isPopular ?? false)]);
          for (const feature of features)
            await tx.unsafe("INSERT INTO plan_features (plan_id,feature) VALUES (?,?)", [plan?.id, feature]);
          await recordAdminAction(userId, "plan.created", "plan", asNumber(plan?.id), tx);
        });
        return makeResponse(json({ id: asNumber(plan?.id), name, priceMonthly: monthly, priceAnnual: annual, features }, 201));
      }
      const adminPlan = path.match(/^\/admin\/plans\/([1-9]\d*)$/);
      if (adminPlan && method === "PATCH") {
        const planId = requiredId(adminPlan[1], "plan ID");
        if (!await one(db, "SELECT id FROM plans WHERE id=?", [planId]))
          throw new HttpError(404, "Plan not found");
        const body = await readBody(request);
        const normalizedPlanName = body.name === undefined ? undefined : checkString(body.name, "name", { required: true, max: 100 });
        if (normalizedPlanName && await one(db, "SELECT id FROM plans WHERE name=? COLLATE NOCASE AND id<>?", [normalizedPlanName, planId]))
          throw new HttpError(409, "A plan with this name already exists");
        const updates = [];
        const values = [];
        const features = body.features === undefined ? undefined : checkStringArray(body.features, "features");
        for (const [key, column, label, max] of [
          ["name", "name", "name", 100],
          ["priceMonthly", "price_monthly", "priceMonthly", 1e7],
          ["priceAnnual", "price_annual", "priceAnnual", 1e8]
        ]) {
          if (body[key] !== undefined) {
            updates.push(`${column}=?`);
            values.push(key === "name" ? normalizedPlanName : checkNumber(body[key], label, { min: 0, max }));
          }
        }
        if (body.isPopular !== undefined) {
          if (typeof body.isPopular !== "boolean")
            throw new HttpError(400, "isPopular must be a boolean");
          updates.push("is_popular=?");
          values.push(Number(body.isPopular));
        }
        await db.begin(async (tx) => {
          if (updates.length) {
            const changed = await one(tx, `UPDATE plans SET ${updates.join(",")} WHERE id=? RETURNING id`, [...values, planId]);
            if (!changed)
              throw new HttpError(404, "Plan not found");
          }
          if (features !== undefined) {
            await tx.unsafe("DELETE FROM plan_features WHERE plan_id=?", [planId]);
            for (const feature of features)
              await tx.unsafe("INSERT INTO plan_features (plan_id,feature) VALUES (?,?)", [planId, feature]);
          }
          await recordAdminAction(userId, "plan.updated", "plan", planId, tx);
        });
        return makeResponse(json({ id: planId, updated: true }));
      }
      if (adminPlan && method === "DELETE") {
        const planId = requiredId(adminPlan[1], "plan ID");
        await db.begin(async (tx) => {
          if (await one(tx, "SELECT id FROM subscriptions WHERE plan_id=?", [planId]))
            throw new HttpError(409, "A plan with subscription history cannot be deleted");
          const removed = await one(tx, "DELETE FROM plans WHERE id=? RETURNING id", [planId]);
          if (!removed)
            throw new HttpError(404, "Plan not found");
          await recordAdminAction(userId, "plan.deleted", "plan", planId, tx);
        });
        return makeResponse(emptyResponse(204));
      }
      if (path === "/admin/audit" && method === "GET") {
        const rows = await dbRows(db, `SELECT a.id,a.action,a.entity_type,a.entity_id,a.created_at,u.name AS admin_name
          FROM admin_audit_log a LEFT JOIN users u ON u.id=a.admin_user_id ORDER BY a.created_at DESC LIMIT 100`);
        return makeResponse(json(rows.map((row) => ({ id: asNumber(row.id), action: String(row.action),
          entityType: String(row.entity_type), entityId: row.entity_id === null ? null : asNumber(row.entity_id),
          adminName: asText(row.admin_name) ?? "Deleted admin", createdAt: dateString(row.created_at) }))));
      }
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
        return makeResponse(json(await addFilm(db, await readBody(request), creatorId), 201));
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
          (SELECT COUNT(*) FROM films f JOIN users u ON u.id=f.creator_id WHERE f.status='published' AND u.is_demo=0) AS total_films,
          (SELECT COUNT(*) FROM users WHERE role='creator' AND is_demo=0 AND account_status='active') AS total_creators,
          (SELECT COUNT(*) FROM viewing_events e JOIN users u ON u.id=e.user_id WHERE e.media_type='film' AND u.is_demo=0) AS total_views,
          (SELECT COUNT(*) FROM films f JOIN users u ON u.id=f.creator_id WHERE f.status='published' AND f.monetization='free' AND u.is_demo=0) AS free_films,
          (SELECT COUNT(*) FROM films f JOIN users u ON u.id=f.creator_id WHERE f.status='published' AND f.monetization='pay_per_view' AND u.is_demo=0) AS paid_films`);
        return makeResponse(json({
          totalFilms: asNumber(stats?.total_films),
          totalCreators: asNumber(stats?.total_creators),
          totalViews: asNumber(stats?.total_views),
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
          WHERE w.user_id=? ORDER BY w.added_at DESC`, [userId]);
        return makeResponse(json(await filmsToApi(db, rows)));
      }
      if (path === "/watchlist" && method === "POST") {
        const body = await readBody(request);
        const filmId = checkNumber(body.filmId, "filmId", { integer: true, min: 1 });
        if (!await one(db, "SELECT id FROM films WHERE id = ?", [filmId]))
          throw new HttpError(404, "Film not found");
        await db.unsafe("INSERT OR IGNORE INTO watchlist (user_id,film_id,added_at) VALUES (?,?,?)", [userId, filmId, new Date().toISOString()]);
        const entry = await one(db, "SELECT id,user_id,film_id,added_at FROM watchlist WHERE user_id=? AND film_id=?", [userId, filmId]);
        return makeResponse(json({ id: asNumber(entry?.id), userId: asNumber(entry?.user_id), filmId: asNumber(entry?.film_id), addedAt: dateString(entry?.added_at) }, 201));
      }
      const watchlistDelete = path.match(/^\/watchlist\/([^/]+)$/);
      if (watchlistDelete && method === "DELETE") {
        const filmId = requiredId(watchlistDelete[1], "film ID");
        await db.unsafe("DELETE FROM watchlist WHERE user_id=? AND film_id=?", [userId, filmId]);
        return makeResponse(emptyResponse(204));
      }
      if ((path === "/progress" || path === "/continue-watching") && method === "GET") {
        const rows = await dbRows(db, `SELECT p.*, f.id AS film_id_exists FROM watch_progress p
          JOIN films f ON f.id=p.film_id WHERE p.user_id=? AND p.percent_complete < 95
          ORDER BY p.updated_at DESC LIMIT 20`, [userId]);
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
        const requestedProgress = checkNumber(body.progressSeconds, "progressSeconds", { integer: true, min: 0 });
        const total = body.totalSeconds === undefined ? null : checkNumber(body.totalSeconds, "totalSeconds", { integer: true, min: 0 });
        const progress = total && total > 0 ? Math.min(requestedProgress, total) : requestedProgress;
        const viewingEventId = body.viewingEventId === undefined ? null : checkNumber(body.viewingEventId, "viewingEventId", { integer: true, min: 1 });
        const watchedSecondsDelta = body.watchedSecondsDelta === undefined
          ? null
          : checkNumber(body.watchedSecondsDelta, "watchedSecondsDelta", { integer: true, min: 0, max: 30 });
        if (!await one(db, "SELECT id FROM films WHERE id = ?", [filmId]))
          throw new HttpError(404, "Film not found");
        const percent = total && total > 0 ? Math.min(100, progress / total * 100) : 0;
        if (viewingEventId !== null) {
          const event = await one(db, "SELECT id,last_position_seconds FROM viewing_events WHERE id=? AND user_id=? AND film_id=?", [viewingEventId, userId, filmId]);
          if (!event)
            throw new HttpError(404, "Viewing session not found");
          const watchedDelta = watchedSecondsDelta ?? Math.min(30, Math.max(0, progress - asNumber(event.last_position_seconds)));
          await db.unsafe(`UPDATE viewing_events SET seconds_watched=seconds_watched+?,
            last_position_seconds=?, completed=CASE WHEN ? >= 90 THEN 1 ELSE completed END WHERE id=?`,
          [watchedDelta, progress, percent, viewingEventId]);
        }
        const now = new Date().toISOString();
        const row = await one(db, `INSERT INTO watch_progress (user_id,film_id,progress_seconds,total_seconds,percent_complete,updated_at)
          VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,film_id) DO UPDATE SET
          progress_seconds=excluded.progress_seconds,total_seconds=COALESCE(excluded.total_seconds,watch_progress.total_seconds),
          percent_complete=excluded.percent_complete,updated_at=excluded.updated_at RETURNING *`, [userId, filmId, progress, total, percent, now]);
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
        const rows = await dbRows(db, `${filmBaseSql} WHERE f.creator_id=? ORDER BY f.created_at DESC`, [creatorId]);
        return makeResponse(json(await filmsToApi(db, rows)));
      }
      if (path === "/creator/dashboard" && method === "GET") {
        const rows = await dbRows(db, `${filmBaseSql} WHERE f.creator_id=?`, [creatorId]);
        const films = await filmsToApi(db, rows);
        const activity = await one(db, `SELECT COUNT(*) AS views FROM viewing_events e
          JOIN films f ON f.id=e.film_id JOIN users u ON u.id=e.user_id
          WHERE f.creator_id=? AND e.media_type='film' AND u.is_demo=0`, [creatorId]);
        const totalViews = asNumber(activity?.views);
        const published = rows.map((row, index) => ({ row, film: films[index] })).filter((item) => item.row.status === "published");
        const viewCounts = await dbRows(db, `SELECT e.film_id,COUNT(*) AS views FROM viewing_events e
          JOIN users u ON u.id=e.user_id WHERE e.media_type='film' AND u.is_demo=0
          AND e.film_id IN (SELECT id FROM films WHERE creator_id=?) GROUP BY e.film_id`, [creatorId]);
        const viewsByFilm = new Map(viewCounts.map((item) => [asNumber(item.film_id), asNumber(item.views)]));
        const topFilm = published.reduce((best, item) => {
          const views = viewsByFilm.get(asNumber(item.row.id)) ?? 0;
          return views > 0 && (!best || views > best.views) ? { film: item.film, views } : best;
        }, null)?.film ?? null;
        const recentViews = (await dailyActivity(db, 7, creatorId)).map(({ date, views }) => ({ date, views }));
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
          FROM viewing_events e JOIN films f ON f.id=e.film_id JOIN users u ON u.id=e.user_id
          WHERE f.creator_id=? AND e.media_type='film' AND u.is_demo=0`, [creatorId]);
        const rating = await one(db, `SELECT AVG(r.rating) AS average FROM reviews r
          JOIN films f ON f.id=r.film_id WHERE f.creator_id=? AND r.status='published' AND r.is_demo=0`, [creatorId]);
        const viewers = await one(db, `SELECT COUNT(DISTINCT e.user_id) AS viewers FROM viewing_events e
          JOIN films f ON f.id=e.film_id JOIN users u ON u.id=e.user_id
          WHERE f.creator_id=? AND e.media_type='film' AND u.is_demo=0`, [creatorId]);
        const viewsByDay = await dailyActivity(db, 30, creatorId);
        return makeResponse(json({
          totalViews: asNumber(stats?.total_views),
          totalWatchTime: Math.floor(asNumber(stats?.total_watch_time) / 60),
          avgRating: rating?.average === null || rating?.average === undefined ? null : Math.round(asNumber(rating.average) * 10) / 10,
          avgWatchThroughRate: Math.round(asNumber(stats?.completion_rate) * 10) / 10,
          uniqueViewers: asNumber(viewers?.viewers),
          viewsByDay
        }));
      }
      const filmAnalyticsMatch = path.match(/^\/creator\/analytics\/([^/]+)$/);
      if (filmAnalyticsMatch && method === "GET") {
        const filmId = requiredId(filmAnalyticsMatch[1], "film ID");
        const film = await one(db, `${filmBaseSql} WHERE f.id=? AND f.creator_id=?`, [filmId, creatorId]);
        if (!film)
          throw new HttpError(404, "Film not found");
        const activity = await one(db, `SELECT COUNT(*) AS views, COALESCE(SUM(e.seconds_watched),0) AS seconds_watched,
            COALESCE(AVG(CASE WHEN f.duration > 0 THEN MIN(100.0,e.seconds_watched * 100.0 / f.duration) END),0) AS completion_rate
          FROM viewing_events e JOIN films f ON f.id=e.film_id JOIN users u ON u.id=e.user_id
          WHERE e.film_id=? AND e.media_type='film' AND u.is_demo=0`, [filmId]);
        const views = asNumber(activity?.views);
        const uniqueViewers = await one(db, `SELECT COUNT(DISTINCT e.user_id) AS viewers FROM viewing_events e
          JOIN users u ON u.id=e.user_id WHERE e.film_id=? AND e.media_type='film' AND u.is_demo=0`, [filmId]);
        const filmRating = await one(db, `SELECT AVG(r.rating) AS average FROM reviews r
          WHERE r.film_id=? AND r.is_demo=0 AND r.status='published'`, [filmId]);
        return makeResponse(json({
          filmId,
          views,
          uniqueViewers: asNumber(uniqueViewers?.viewers),
          watchTime: Math.floor(asNumber(activity?.seconds_watched) / 60),
          avgWatchThrough: Math.round(asNumber(activity?.completion_rate) * 10) / 10,
          rating: filmRating?.average === null || filmRating?.average === undefined ? null : Math.round(asNumber(filmRating.average) * 10) / 10,
          ppvSales: null,
          ppvRevenue: null,
          viewsByDay: await dailyActivity(db, 30, creatorId)
        }));
      }
      if (path === "/creator/earnings" && method === "GET") {
        const rows = await dbRows(db, "SELECT * FROM withdrawals WHERE creator_id=? ORDER BY requested_at DESC", [creatorId]);
        const revenueRows = await dbRows(db, `SELECT currency,
          SUM(CASE WHEN transaction_type='refund' THEN -amount_cents ELSE amount_cents END) AS net_cents,
          COUNT(*) AS transactions FROM transactions WHERE creator_id=? AND status='succeeded'
          AND verified_at IS NOT NULL GROUP BY currency`, [creatorId]);
        return makeResponse(json({
          available: revenueRows.length > 0,
          message: revenueRows.length ? "Revenue includes verified transactions only. Payout processing is not connected." : "Revenue and payouts are unavailable until verified payment transactions are connected.",
          totalEarned: revenueRows.length === 1 ? asNumber(revenueRows[0].net_cents) / 100 : null,
          availableBalance: null,
          pendingBalance: null,
          currency: revenueRows.length === 1 ? String(revenueRows[0].currency) : null,
          revenueByCurrency: revenueRows.map((row) => ({
            currency: String(row.currency), total: asNumber(row.net_cents) / 100,
            verifiedTransactions: asNumber(row.transactions)
          })),
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
        const rows = await dbRows(db, "SELECT * FROM withdrawals WHERE creator_id=? ORDER BY requested_at DESC", [creatorId]);
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
      const userReview = path.match(/^\/reviews\/([1-9]\d*)$/);
      if (userReview) {
        const reviewId = requiredId(userReview[1], "review ID");
        const review = await one(db, "SELECT id,film_id FROM reviews WHERE id=? AND user_id=? AND is_demo=0", [reviewId, userId]);
        if (!review)
          throw new HttpError(404, "Review not found");
        if (method === "PATCH") {
          const body = await readBody(request);
          const updates = [];
          const values = [];
          if (body.rating !== undefined) {
            updates.push("rating=?");
            values.push(checkNumber(body.rating, "rating", { integer: true, min: 1, max: 5 }));
          }
          if (body.comment !== undefined) {
            updates.push("comment=?");
            values.push(checkString(body.comment, "comment", { max: 2000 }) || null);
          }
          if (!updates.length)
            throw new HttpError(400, "Provide a rating or comment");
          values.push(reviewId);
          await db.unsafe(`UPDATE reviews SET ${updates.join(",")} WHERE id=?`, values);
        } else if (method === "DELETE") {
          await db.unsafe("DELETE FROM reviews WHERE id=?", [reviewId]);
        } else {
          throw new HttpError(405, "Method not allowed");
        }
        const aggregate = await one(db, `SELECT COUNT(*) AS count,AVG(rating) AS rating FROM reviews
          WHERE film_id=? AND is_demo=0 AND status='published'`, [review.film_id]);
        await db.unsafe("UPDATE films SET review_count=?,rating=? WHERE id=?",
          [asNumber(aggregate?.count), aggregate?.rating ?? null, review.film_id]);
        return makeResponse(method === "DELETE" ? emptyResponse(204) : json({ id: reviewId, updated: true }));
      }
      const filmReviews = path.match(/^\/films\/([^/]+)\/reviews$/);
      if (filmReviews) {
        const filmId = requiredId(filmReviews[1], "film ID");
        if (method === "GET") {
          const rows = await dbRows(db, `SELECT r.*,u.name AS user_name FROM reviews r
            LEFT JOIN users u ON u.id=r.user_id WHERE r.film_id=? AND r.status='published' AND r.is_demo=0 ORDER BY r.created_at DESC`, [filmId]);
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
          const existingReview = await one(db, "SELECT id FROM reviews WHERE film_id=? AND user_id=?", [filmId, userId]);
          if (existingReview)
            throw new HttpError(409, "You have already reviewed this film");
          const saved = await one(db, `INSERT INTO reviews (film_id,user_id,rating,comment,is_demo,created_at)
            VALUES (?,?,?,?,?,?) RETURNING *`, [filmId, userId, rating, comment ?? null, asNumber(currentUser.is_demo), new Date().toISOString()]);
          const aggregate = await one(db, "SELECT COUNT(*) AS count,AVG(rating) AS rating FROM reviews WHERE film_id=? AND is_demo=0 AND status='published'", [filmId]);
          await db.unsafe("UPDATE films SET review_count=?,rating=? WHERE id=?", [
            asNumber(aggregate?.count),
            Math.round(asNumber(aggregate?.rating) * 10) / 10,
            filmId
          ]);
          return makeResponse(json({
            id: asNumber(saved?.id),
            filmId,
            userId,
            userName: String(currentUser.name),
            rating,
            comment: comment ?? null,
            createdAt: dateString(saved?.created_at)
          }, 201));
        }
      }
      const startViewing = path.match(/^\/films\/([^/]+)\/view$/);
      if (startViewing && method === "POST") {
        const filmId = requiredId(startViewing[1], "film ID");
        let mediaType = "film";
        if (request.headers.get("content-type")?.includes("application/json")) {
          const body = await readBody(request);
          if (body.mediaType !== undefined && body.mediaType !== "film" && body.mediaType !== "trailer")
            throw new HttpError(400, "mediaType must be film or trailer");
          mediaType = body.mediaType ?? "film";
        }
        const film = await one(db, "SELECT id FROM films WHERE id=? AND status='published'", [filmId]);
        if (!film)
          throw new HttpError(404, "Film not found");
        const event = await one(db, "INSERT INTO viewing_events (user_id,film_id,media_type,started_at) VALUES (?,?,?,?) RETURNING id", [userId, filmId, mediaType, new Date().toISOString()]);
        if (mediaType === "film")
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
          const inWatchlist = await one(db, "SELECT id FROM watchlist WHERE user_id=? AND film_id=?", [userId, filmId]);
          const progress = await one(db, "SELECT progress_seconds FROM watch_progress WHERE user_id=? AND film_id=?", [userId, filmId]);
          detail.isInWatchlist = Boolean(inWatchlist);
          detail.watchProgress = progress ? asNumber(progress.progress_seconds) : null;
          return makeResponse(json(detail));
        }
        if (!filmPath[2] && method === "PATCH") {
          const owned = await one(db, "SELECT creator_id FROM films WHERE id=?", [filmId]);
          if (!owned)
            throw new HttpError(404, "Film not found");
          if (currentUser.role !== "admin" && asNumber(owned.creator_id) !== userId)
            throw new HttpError(404, "Film not found");
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
          const owned = await one(db, "DELETE FROM films WHERE id=? AND (creator_id=? OR ?='admin') RETURNING id", [filmId, userId, currentUser.role]);
          if (!owned)
            throw new HttpError(404, "Film not found");
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
