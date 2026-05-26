/**
 * Browser fingerprinting for sock-puppet detection.
 *
 * We can't read MAC addresses from the browser (impossible — they're layer-2
 * and never leave the LAN). We CAN combine a handful of browser-exposed
 * signals into a stable hash that survives IP changes, VPNs, cookie clears,
 * and incognito sessions. The same machine + browser will produce the same
 * fingerprint regardless of how the user routes their traffic.
 *
 * Signals used:
 *   • Canvas 2D rendering (anti-aliasing + font hinting differ per GPU)
 *   • WebGL renderer string (GPU vendor + model)
 *   • Screen resolution + color depth + device pixel ratio
 *   • Time zone + language list
 *   • CPU core count (navigator.hardwareConcurrency)
 *   • OS platform + truncated user agent
 *
 * What this catches:
 *   ✓ A banned user making a new account on the same browser
 *   ✓ Two accounts sharing one VPN exit (IP matches AND fingerprint matches
 *     = almost certainly the same person; just IP could be a coincidence)
 *   ✓ Someone clearing cookies / using incognito
 *
 * What this misses:
 *   ✗ Tor Browser (intentionally produces a generic fingerprint)
 *   ✗ Firefox with `privacy.resistFingerprinting=true` enabled
 *   ✗ Different physical machine (the whole point of fingerprinting is to
 *     identify devices — new device = new identity, which is fair)
 *
 * The hash is computed ONCE per session and cached in sessionStorage so the
 * canvas-render cost (~5 ms) is paid once per tab, not per request.
 */

const STORAGE_KEY = 'shinobix:fp';
let _cachedFp: string | null = null;
let _computePromise: Promise<string> | null = null;

function safeGet(fn: () => string | number | undefined | null): string {
    try {
        const v = fn();
        return v == null ? '' : String(v);
    } catch {
        return '';
    }
}

function canvasSample(): string {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 60;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';
        // Render text + shapes that exercise text rendering, anti-aliasing,
        // and curve drawing — three signals that vary per GPU/driver/OS.
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#f60';
        ctx.fillRect(120, 8, 80, 40);
        ctx.fillStyle = '#069';
        ctx.font = '13px "Arial"';
        ctx.fillText('NinjaK \u{1F375} fp', 4, 17);
        ctx.fillStyle = 'rgba(102, 200, 0, 0.7)';
        ctx.font = '15px "Times New Roman"';
        ctx.fillText('NinjaK \u{1F375} fp', 4, 42);
        ctx.strokeStyle = 'rgba(255, 0, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(60, 30, 14, 0, Math.PI * 2);
        ctx.stroke();
        // Use the LAST 64 chars of the data URL — captures the actual pixel
        // payload (the header is identical across machines).
        return canvas.toDataURL().slice(-64);
    } catch {
        return '';
    }
}

function webglSample(): string {
    try {
        const canvas = document.createElement('canvas');
        const gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
        if (!gl) return '';
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = debugInfo
            ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
            : gl.getParameter(gl.VENDOR);
        const renderer = debugInfo
            ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER);
        return `${String(vendor)}|${String(renderer)}`;
    } catch {
        return '';
    }
}

async function sha256Hex(input: string): Promise<string> {
    // Prefer SubtleCrypto (available everywhere modern). If unavailable
    // (e.g. running in a sandbox without crypto), fall back to a simple
    // 32-bit hash — still useful as a coarse fingerprint signal.
    try {
        if (globalThis.crypto?.subtle?.digest) {
            const enc = new TextEncoder().encode(input);
            const buf = await globalThis.crypto.subtle.digest('SHA-256', enc);
            return Array.from(new Uint8Array(buf))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        }
    } catch {
        // fall through to weak fallback
    }
    let h = 5381;
    for (let i = 0; i < input.length; i++) {
        h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

/**
 * Compute (or return cached) the browser fingerprint. The first call does the
 * canvas render + hash (~5 ms total); subsequent calls return the cached
 * value instantly.
 */
export async function getFingerprint(): Promise<string> {
    if (_cachedFp) return _cachedFp;
    if (_computePromise) return _computePromise;

    _computePromise = (async () => {
        // Session cache check — survives navigations but not tab close.
        try {
            const stored = sessionStorage.getItem(STORAGE_KEY);
            if (stored && /^[0-9a-f]{16,64}$/.test(stored)) {
                _cachedFp = stored;
                return stored;
            }
        } catch {
            // sessionStorage unavailable — proceed with full compute
        }

        const parts: string[] = [
            canvasSample(),
            webglSample(),
            safeGet(() => globalThis.screen?.width),
            safeGet(() => globalThis.screen?.height),
            safeGet(() => globalThis.screen?.colorDepth),
            safeGet(() => globalThis.devicePixelRatio),
            safeGet(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
            safeGet(() => (navigator.languages ?? [navigator.language]).join(',')),
            safeGet(() => navigator.hardwareConcurrency),
            // Older browsers expose navigator.platform; modern ones return ''
            // for it but it's still a stable signal where available.
            safeGet(() => (navigator as { platform?: string }).platform ?? ''),
            // Truncated UA — full UA changes on every browser update, but
            // the first 100 chars are stable enough for our needs.
            safeGet(() => navigator.userAgent.slice(0, 100)),
        ];
        const raw = parts.join('::');
        const hex = await sha256Hex(raw);
        // 16 bytes = 32 hex chars is plenty of fingerprint entropy and small
        // enough to pass cleanly through HTTP headers.
        const fp = hex.slice(0, 32);
        _cachedFp = fp;
        try { sessionStorage.setItem(STORAGE_KEY, fp); } catch { /* ignore */ }
        return fp;
    })();
    return _computePromise;
}

/**
 * Synchronous read of the cached fingerprint. Returns null until the first
 * getFingerprint() resolves. Used by the fetch interceptor — first request
 * may not have the header, subsequent ones will (and we don't want to make
 * the interceptor async).
 */
export function getFingerprintSync(): string | null {
    return _cachedFp;
}

/**
 * Trigger fingerprint computation in the background. Safe to call at app boot
 * — won't block startup.
 */
export function primeFingerprint(): void {
    void getFingerprint().catch(() => { /* swallow */ });
}
