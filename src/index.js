import { createDatabase, initializeDatabase } from "./data";
import { createApiHandler, uploadedFileResponse } from "./server";
import index from "./index.html";

const database = createDatabase();
await initializeDatabase(database);
const api = createApiHandler(database);
const server = Bun.serve({
  port: Number(process.env.PORT || 3000),
  routes: {
    "/api/*": api,
    "/uploads/:filename": (request) => uploadedFileResponse(request.params.filename, undefined, request.headers.get("range")),
    "/*": index
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true
  }
});
console.log(`Reel Africa API and app running at ${server.url}`);
