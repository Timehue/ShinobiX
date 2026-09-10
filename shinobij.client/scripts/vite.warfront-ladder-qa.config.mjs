import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";

const clientRoot = fileURLToPath(new URL("../", import.meta.url));
export default defineConfig({
    root: clientRoot,
    plugins: [react(), {
        name: "ladder-qa-shipped-public-assets",
        configurePreviewServer(server) {
            server.middlewares.use((request, response, next) => {
                const publicRoot = resolve(clientRoot, "public");
                const relative = decodeURIComponent((request.url ?? "").split("?")[0]).replace(/^\/+/, "");
                const path = resolve(publicRoot, relative);
                if (!path.startsWith(publicRoot + sep) || !existsSync(path) || !statSync(path).isFile()) return next();
                response.setHeader("Content-Type", path.endsWith(".webp") ? "image/webp" : path.endsWith(".png") ? "image/png" : "application/octet-stream");
                createReadStream(path).pipe(response);
            });
        },
    }],
    cacheDir: "node_modules/.vite-warfront-ladder-qa",
    optimizeDeps: { entries: ["warfront-ladder-qa.html"] },
    server: { host: "127.0.0.1", port: 5179, strictPort: true },
    preview: { host: "127.0.0.1", port: 5179, strictPort: true },
    build: { outDir: ".playwright-dist-warfront-ladder-qa", copyPublicDir: false, rollupOptions: { input: resolve(clientRoot, "warfront-ladder-qa.html") } },
});
