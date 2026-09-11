import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = resolve(root, "public");

// Render the real game entry and public assets. Playwright owns all API routes,
// so the full development backend and unrelated HTML workbenches are unnecessary.
export default defineConfig({
    root,
    publicDir: false,
    plugins: [react(), {
        name: "world-map-qa-public-assets",
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const relative = decodeURIComponent((request.url ?? "").split("?")[0]).replace(/^\/+/, "");
                const path = resolve(publicRoot, relative);
                if (!path.startsWith(publicRoot + sep) || !existsSync(path) || !statSync(path).isFile()) return next();
                const mime = path.endsWith(".webp") ? "image/webp" : path.endsWith(".png") ? "image/png"
                    : path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".json") ? "application/json"
                        : path.endsWith(".woff2") ? "font/woff2" : path.endsWith(".mp3") ? "audio/mpeg" : "application/octet-stream";
                response.setHeader("Content-Type", mime);
                createReadStream(path).pipe(response);
            });
        },
    }],
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
    optimizeDeps: {
        noDiscovery: true,
        include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    server: { watch: null },
});
