// Dev server and build. The relay (@kindling/net) is mounted on the dev / preview server by its Vite plugin, so
// online play works on the same port as the game: rooms at /net/ws, the room list at /net/info.
import { defineConfig } from "vite";
import { createRelay } from "@kindling/net/relay";

export default defineConfig({
  base: "./",
  plugins: [createRelay({ kinds: ["brawl"] }).vitePlugin()],
  server: { host: true },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});
