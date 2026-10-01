import { mergeConfig } from "vite";
import appConfig from "./vite.config";

/** Narrow dev-only config for the source-backed Pet Gauntlet browser regression. */
export default mergeConfig(appConfig, {
    server: {
        watch: { ignored: ["**/.playwright-dist-*", "**/test-results/**", "**/playwright-report/**"] },
    },
    optimizeDeps: {
        entries: ["petvfx.html"],
        noDiscovery: true,
        include: ["react", "react-dom/client", "@react-three/fiber", "@react-three/drei", "@react-three/postprocessing", "three", "three-stdlib", "suspend-react", "use-sync-external-store"],
    },
});
