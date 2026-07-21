export type PublicErrorPayload = {
    error: string;
    requestId: string;
    detail?: string;
};

export const INTERNAL_SERVER_ERROR_CODE = 'internal_server_error';

export function isProductionEnv(env: { NODE_ENV?: string } = process.env): boolean {
    return env.NODE_ENV === 'production';
}

export function publicErrorPayload(
    err: unknown,
    requestId: string,
    env: { NODE_ENV?: string } = process.env,
): PublicErrorPayload {
    if (isProductionEnv(env)) {
        return { error: INTERNAL_SERVER_ERROR_CODE, requestId };
    }
    return {
        error: INTERNAL_SERVER_ERROR_CODE,
        requestId,
        detail: String(err),
    };
}

export function contentSecurityPolicy(env: NodeJS.ProcessEnv = process.env): string {
    const extraConnect = String(env.CSP_CONNECT_SRC_EXTRA ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    const directives: string[] = [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        // 'wasm-unsafe-eval' lets three.js/@react-three-drei compile the meshopt +
        // Draco WASM decoders it configures for GLB models. Without it the browser
        // throws "WebAssembly.instantiate() … 'unsafe-eval' is not an allowed source"
        // and any compressed pet model fails to decode. It permits ONLY WebAssembly
        // compilation — NOT JS eval() (that would need the far broader 'unsafe-eval').
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        "font-src 'self' data:",
        // `blob:` is required by three.js's GLTFLoader: it extracts embedded GLB
        // textures to same-origin blob: URLs and fetches them via ImageBitmapLoader
        // (governed by connect-src, not img-src). Without it, every pet-model texture
        // is "Refused to connect", cascading to WebGLRenderer context-loss — the crash
        // that broke the Hollow Warfront / 3D pet stages in prod. Blob URLs are
        // app-created and same-origin, so this adds negligible surface (connect-src
        // already allows the far broader https:/wss:).
        `connect-src 'self' https: wss: ws: blob:${extraConnect.length ? ` ${extraConnect.join(' ')}` : ''}`,
        "worker-src 'self' blob:",
    ];
    return directives.join('; ');
}

export function securityHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
    return {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': [
            'accelerometer=()',
            'camera=()',
            'geolocation=()',
            'gyroscope=()',
            'magnetometer=()',
            'microphone=()',
            'payment=()',
            'usb=()',
        ].join(', '),
        'Content-Security-Policy': contentSecurityPolicy(env),
    };
}
