import { defineConfig } from "vite";
import base from "./vite.world-map-qa.config.mjs";

export default defineConfig({
    ...base,
    server: { ...base.server, watch: null },
    optimizeDeps: { ...base.optimizeDeps, entries: ["combat-grid-qa.html"] },
});
