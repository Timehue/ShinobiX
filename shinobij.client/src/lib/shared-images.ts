/*
 * Shared-image upload / compression / publish helpers.
 *
 * Pure browser-side utilities for turning a user-picked file into a (optionally
 * compressed) data URL and publishing an assigned image to the shared KV store
 * via /api/images. None of these depend on App component state.
 *
 *   • compressDataUrl     — downscale + re-encode (WebP, JPEG fallback)
 *   • isAnimatedImageFile — GIF / APNG / animated-WebP detection
 *   • readImageFile       — file → data URL, skipping compression for animated
 *   • publishSharedImage  — POST an image to /api/images + bust the session cache
 *
 * Extracted from App.tsx. compressDataUrl + publishSharedImage are re-exported
 * from App.tsx for the existing "../App" import sites (components/AiImagePrompt,
 * components/KenneyAtlasPicker).
 */

import { ANIMATED_MAX_MB } from "../constants/game";

export function compressDataUrl(dataUrl: string, maxPx = 512, quality = 0.82): Promise<string> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
            // Prefer WebP (~30% smaller than JPEG at same quality); fall back to JPEG
            const webp = canvas.toDataURL("image/webp", quality);
            resolve(webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

// Module-level — callable from any component without prop drilling
// Mirror of api/images.ts KNOWN_PREFIXES so the client can figure out which
// category an image lives in without a round-trip. Used for sessionStorage
// cache invalidation on publish.
const CLIENT_KNOWN_PREFIXES: Record<string, string> = {
    avatar: 'avatar', pet: 'pet', jutsu: 'jutsu', item: 'item',
    card: 'card', event: 'event', bloodline: 'bloodline',
    vn: 'event', ai: 'ai', shrine: 'shrine', landmark: 'landmark',
};
function categoryFromImageKey(id: string): string {
    const prefix = id.split(':')[0];
    return CLIENT_KNOWN_PREFIXES[prefix] ?? 'misc';
}

export async function publishSharedImage(id: string, img: string): Promise<boolean> {
    if (!id) return false;
    // Phase 2 (image-as-files): a "/api/img" value is the per-image REFERENCE URL
    // the client now hydrates into image fields — not image content. Some flows
    // (e.g. bloodline / event re-save) pass a field value straight back here; for
    // a hydrated URL that's a no-op (the image is already stored), and POSTing the
    // URL as content would just earn a 400. Treat it as an already-published
    // success and skip the round-trip.
    if (img && img.startsWith('/api/img')) return true;
    try {
        const res = await fetch('/api/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, image: img }),
        });
        if (!res.ok) throw new Error(`Image publish failed: ${res.status}`);
        // Bust the per-category sessionStorage cache so a page reload fetches
        // fresh from KV instead of hydrating the pre-publish snapshot. Without
        // this, the 10-minute IMG_CACHE_TTL would mask new assignments for
        // up to 10 minutes after a publish.
        try {
            const cat = categoryFromImageKey(id);
            sessionStorage.removeItem(`imgcat:${cat}`);
        } catch { /* sessionStorage unavailable — ignore */ }
        return true;
    } catch (error) {
        console.warn(`Could not save shared image ${id}:`, error);
        return false;
    }
}

// Cap animated uploads tighter than still uploads — canvas compression
// doesn't apply, so the raw bytes hit storage as-is. The server-side
// validator in /api/images caps the data URL at 3,000,000 chars
// (≈ 2.15 MB raw after base64 overhead), so picking 2 MB here gives a
// friendly client-side error before the upload, instead of a silent
// HTTP 400 from the server. ANIMATED_MAX_MB lives in ./constants/game.

/**
 * Detect whether an upload contains animation. Canvas re-encoding flattens
 * everything to a single frame, so we skip compressDataUrl for these formats
 * and pass the original bytes through to preserve movement.
 *
 * Detection is by MIME, file extension, AND file signature/chunk inspection,
 * because MIME alone is unreliable:
 *   GIF   → any GIF (signature "GIF8"); animated is the common case and a
 *           still GIF renders fine raw.
 *   APNG  → browsers report APNG as "image/png", so MIME never says "apng".
 *           Animated PNGs carry an "acTL" chunk before the first IDAT — scan
 *           for it (a plain still PNG has none).
 *   WebP  → animated WebP has an "ANIM" chunk and/or a "VP8X" chunk whose flags
 *           byte sets the animation bit (0x02).
 * The animation markers sit near the file start but a leading EXIF/ICCP/text
 * chunk can push them past 1 KB, so scan a generous 64 KB window.
 */
export async function isAnimatedImageFile(file: File): Promise<boolean> {
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";

    // GIF: treat any GIF as animated (still GIFs render fine raw).
    if (type === "image/gif" || ext === "gif") return true;

    let bytes: Uint8Array;
    try {
        bytes = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
    } catch {
        // Can't read bytes — fall back to MIME/extension hints only.
        return type === "image/apng" || ext === "apng";
    }

    // ASCII match at a fixed offset (out-of-range bytes compare false).
    const at = (i: number, s: string): boolean =>
        [...s].every((ch, k) => bytes[i + k] === ch.charCodeAt(0));
    // Scan for an ASCII marker anywhere in the window.
    const has = (marker: string): boolean => {
        for (let i = 0; i + marker.length <= bytes.length; i++) if (at(i, marker)) return true;
        return false;
    };

    if (at(0, "GIF8")) return true;

    // PNG / APNG.
    const isPng = bytes[0] === 0x89 && at(1, "PNG");
    if (isPng || type === "image/apng" || type === "image/png" || ext === "png" || ext === "apng") {
        if (has("acTL")) return true;          // animation-control chunk → APNG
        if (isPng) return false;               // confirmed still PNG
    }

    // WebP.
    const isWebp = at(0, "RIFF") && at(8, "WEBP");
    if (isWebp || type === "image/webp" || ext === "webp") {
        if (has("ANIM")) return true;
        for (let i = 0; i + 9 <= bytes.length; i++) {
            if (at(i, "VP8X")) {
                // VP8X marker, 4-byte chunk size, then flags byte; bit 1 = anim.
                if ((bytes[i + 8] & 0x02) !== 0) return true;
                break;
            }
        }
    }

    return false;
}

export function readImageFile(file: File, onLoad: (image: string) => void, maxSizeMb = 100) {
    if (!file.type.startsWith("image/")) return alert("Please upload an image file.");
    void (async () => {
        const animated = await isAnimatedImageFile(file);
        const effectiveCap = animated ? ANIMATED_MAX_MB : maxSizeMb;
        if (file.size > effectiveCap * 1024 * 1024) {
            return alert(animated
                ? `Animated images must be under ${ANIMATED_MAX_MB} MB so animation is preserved (we can't compress without flattening it). Yours is ${(file.size / 1024 / 1024).toFixed(1)} MB.`
                : `Please upload an image under ${maxSizeMb} MB.`);
        }
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = String(reader.result);
            if (animated) {
                // Pass the original bytes through — canvas compression would
                // strip every frame after the first.
                onLoad(dataUrl);
            } else {
                compressDataUrl(dataUrl).then(onLoad);
            }
        };
        reader.readAsDataURL(file);
    })();
}
