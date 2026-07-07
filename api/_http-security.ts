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
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        "font-src 'self' data:",
        `connect-src 'self' https: wss: ws:${extraConnect.length ? ` ${extraConnect.join(' ')}` : ''}`,
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
