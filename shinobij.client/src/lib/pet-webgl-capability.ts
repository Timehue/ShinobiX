/** Check the WebGL version required by the pet arena before mounting its Canvas.
 * This is a capability probe, not recovery from a later renderer failure. */
export function supportsPetWebGl2(
    createCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): boolean {
    let canvas: HTMLCanvasElement | null = null;
    let context: WebGL2RenderingContext | null = null;
    try {
        canvas = createCanvas();
        context = canvas.getContext("webgl2", {
            alpha: true,
            antialias: true,
            powerPreference: "high-performance",
        });
        return context !== null;
    } catch {
        return false;
    } finally {
        // A probe must not consume one of the device's limited live contexts.
        try { context?.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* cleanup is best effort */ }
        if (canvas) {
            try { canvas.width = 1; canvas.height = 1; } catch { /* detached probe can be discarded */ }
        }
    }
}
