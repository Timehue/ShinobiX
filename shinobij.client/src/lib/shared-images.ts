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
 * everything to a single frame, so we want to skip compressDataUrl for these
 * formats and pass the original bytes through to preserve movement.
 *
 *   GIF, APNG          → assumed animated by MIME alone (single-frame GIFs are
 *                        rare in practice and still render fine raw)
 *   WebP               → may or may not be animated. Animated WebP files
 *                        contain an "ANIM" chunk in the RIFF container — we
 *                        scan the first 1 KB for that marker.
 */
export async function isAnimatedImageFile(file: File): Promise<boolean> {
    if (file.type === "image/gif" || file.type === "image/apng") return true;
    if (file.type === "image/webp") {
        try {
            const header = await file.slice(0, 1024).arrayBuffer();
            const bytes = new Uint8Array(header);
            // Look for the literal ASCII "ANIM" chunk header.
            for (let i = 0; i < bytes.length - 4; i++) {
                if (bytes[i] === 0x41 && bytes[i + 1] === 0x4E && bytes[i + 2] === 0x49 && bytes[i + 3] === 0x4D) {
                    return true;
                }
            }
        } catch { /* fall through to non-animated */ }
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
