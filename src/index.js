import { createDatabase, initializeDatabase } from "./data";
import { createApiHandler, uploadedFileResponse } from "./server";
import { join } from "node:path";
import index from "./index.html";

const database = createDatabase();
await initializeDatabase(database);
const api = createApiHandler(database);
const asset = (file, contentType, cacheControl = "public, max-age=3600") => () => new Response(
  Bun.file(join(import.meta.dir, file)),
  { headers: { "Content-Type": contentType, "Cache-Control": cacheControl } }
);
const server = Bun.serve({
  hostname: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 4751),
  routes: {
    "/api/*": api,
    "/uploads/:filename": (request) => uploadedFileResponse(request.params.filename, undefined, request.headers.get("range")),
    "/manifest.webmanifest": asset("manifest.webmanifest", "application/manifest+json", "no-cache"),
    "/sw.js": asset("sw.js", "text/javascript; charset=utf-8", "no-cache"),
    "/offline.html": asset("offline.html", "text/html; charset=utf-8", "no-cache"),
    "/icons/reel.svg": asset("icons/reel.svg", "image/svg+xml"),
    "/icons/reel-192.png": asset("icons/reel-192.png", "image/png", "public, max-age=31536000, immutable"),
    "/icons/reel-512.png": asset("icons/reel-512.png", "image/png", "public, max-age=31536000, immutable"),
    "/icons/reel-maskable-512.png": asset("icons/reel-maskable-512.png", "image/png", "public, max-age=31536000, immutable"),
    "/*": index
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true
  }
});
console.log(`Reel Africa API and app running at ${server.url}`);
