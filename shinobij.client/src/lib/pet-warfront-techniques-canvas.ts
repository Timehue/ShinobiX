import { warfrontElementSignature } from "./pet-warfront-spectacle";
import { warfrontTechniqueProgress, type WarfrontTechnique } from "./pet-warfront-techniques";
import fireArt from "../assets/fx/epic/firewall.webp";
import waterArt from "../assets/fx/epic/tsunami.webp";
import windArt from "../assets/fx/epic/tornado.webp";
import earthArt from "../assets/fx/epic/quake.webp";
import lightningArt from "../assets/fx/epic/stormbolt.webp";

export const WARFRONT_TECHNIQUE_ART = { Fire: fireArt, Water: waterArt, Wind: windArt, Earth: earthArt, Lightning: lightningArt };

const softArt = new WeakMap<HTMLImageElement, CanvasImageSource>();

/** Cache the feathered silhouette once, not on every animation frame. The
 * painted floor edges must dissolve into the court rather than form a card. */
function techniqueSurface(image: HTMLImageElement): CanvasImageSource {
    const cached = softArt.get(image);
    if (cached) return cached;
    const surface = document.createElement("canvas");
    surface.width = 512;
    surface.height = 512;
    const paint = surface.getContext("2d");
    if (!paint) return image;
    paint.drawImage(image, 0, 0, 512, 512);
    paint.globalCompositeOperation = "destination-in";
    for (const [endX, endY, start, end] of [[512, 0, 0.12, 0.88], [0, 512, 0.08, 0.68]]) {
        const mask = paint.createLinearGradient(0, 0, endX, endY);
        mask.addColorStop(0, "transparent");
        mask.addColorStop(start, "black");
        mask.addColorStop(end, "black");
        mask.addColorStop(1, "transparent");
        paint.fillStyle = mask;
        paint.fillRect(0, 0, 512, 512);
    }
    softArt.set(image, surface);
    return surface;
}

/** Prepare immutable art behind the formation curtain. Allocating
 * masked canvases on the first impact can miss consecutive phone frames. */
export async function warmWarfrontTechniqueArt(image: HTMLImageElement): Promise<void> {
    const surface = techniqueSurface(image);
    if (typeof createImageBitmap !== "function" || !(surface instanceof HTMLCanvasElement)) return;
    try { softArt.set(image, await createImageBitmap(surface)); }
    catch { /* The already prepared canvas remains a valid fallback. */ }
}

/** Painted Colosseum set pieces keep the same elemental silhouettes on the
 * phone fallback. Paint behind the actors so their bodies and HP stay legible. */
export function drawWarfrontTechnique(
    context: CanvasRenderingContext2D, technique: WarfrontTechnique, image: HTMLImageElement,
    tick: number, x: number, y: number, petSize: number, reducedMotion: boolean,
): void {
    const t = warfrontTechniqueProgress(technique, tick);
    if (t < 0 || t >= 1) return;
    const dimensions: Record<string, readonly [number, number]> = {
        Fire: [2.8, 2.7], Water: [3.7, 2.1], Wind: [1.8, 3.5], Earth: [3, 2.2], Lightning: [1.8, 4.1],
    };
    const [width, height] = dimensions[technique.element] ?? [2, 2];
    const signature = warfrontElementSignature(technique.element);
    const envelope = Math.min(1, t / 0.1, (1 - t) / 0.3);
    const growth = reducedMotion ? 1 : 0.72 + Math.min(1, t * 4) * 0.28;
    const size = petSize * 0.72 * (technique.signature ? 1.25 : 1) * growth;
    context.save();
    context.globalAlpha = envelope * 0.22;
    context.fillStyle = signature.primary;
    context.beginPath(); context.ellipse(x, y, size * width * 0.36, size * 0.14, 0, 0, Math.PI * 2); context.fill();
    context.globalAlpha = envelope * 0.9;
    // Wind leans; water rolls along the ground; rock erupts vertically. Keep
    // lightning steady instead of adding a full-screen flashing treatment.
    const sway = !reducedMotion && technique.element === "Wind" ? Math.sin(t * 8) * size * 0.06 : 0;
    context.translate(x, y);
    if (technique.element === "Water" && Math.sin(technique.heading) < 0) context.scale(-1, 1);
    context.drawImage(techniqueSurface(image), -size * width / 2 + sway, -size * height * 0.88, size * width, size * height);
    context.restore();
}
