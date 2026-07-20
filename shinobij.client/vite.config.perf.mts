// TEMP config for PERFORMANCE MEASUREMENT ONLY (not the real build): adds the
// dev-only petvfx harness as a build input and writes to dist-perf so the
// production dist and its size budgets are untouched. Safe to delete.
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

export default mergeConfig(base, defineConfig({
    build: {
        outDir: "dist-perf",
        rollupOptions: {
            input: {
                main: "index.html",
                petvfx: "petvfx.html",
            },
        },
    },
}));
