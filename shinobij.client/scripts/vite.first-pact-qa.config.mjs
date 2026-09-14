import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Build-only configuration for the development First Pact visual harness.
 * It produces an optimized artifact without the production dev server's API
 * middleware, TLS certificate, or whole-app dependency scan. The harness
 * supplies its own deterministic network facade.
 */
export default defineConfig({
    root: projectRoot,
    plugins: [react()],
    publicDir: false,
    build: {
        outDir: resolve(projectRoot, "output", "first-pact-preview-dist"),
        emptyOutDir: true,
        copyPublicDir: false,
        rollupOptions: {
            input: resolve(projectRoot, "firstpactpreview.html"),
        },
    },
});
