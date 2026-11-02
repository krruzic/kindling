// @kindling/server: production static server (precompressed files, cache headers, SPA routes) with an injected
// relay on the same port, and the precompress step. Docker / compose / deploy templates are in templates/.
export * from "./mime.ts";
export * from "./static.ts";
export * from "./server.ts";
export * from "./precompress.ts";
