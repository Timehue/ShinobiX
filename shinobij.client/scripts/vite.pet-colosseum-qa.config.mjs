import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Build the development-only production Showdown harness into the already-created
 * production dist directory. This avoids Vite's large dev dependency scan and
 * verifies the exact optimized renderer while retaining the production model
 * subset copied by the main build.
 */
export default defineConfig({
    root: projectRoot,
    publicDir: false,
    plugins: [react()],
    build: {
        outDir: resolve(projectRoot, "dist"),
        emptyOutDir: false,
        copyPublicDir: false,
        rollupOptions: {
            input: resolve(projectRoot, "showdownpreview.html"),
        },
    },
});
