"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTERNAL_SERVER_ERROR_CODE = void 0;
exports.isProductionEnv = isProductionEnv;
exports.publicErrorPayload = publicErrorPayload;
exports.contentSecurityPolicy = contentSecurityPolicy;
exports.securityHeaders = securityHeaders;
exports.INTERNAL_SERVER_ERROR_CODE = 'internal_server_error';
function isProductionEnv(env = process.env) {
    return env.NODE_ENV === 'production';
}
function publicErrorPayload(err, requestId, env = process.env) {
    if (isProductionEnv(env)) {
        return { error: exports.INTERNAL_SERVER_ERROR_CODE, requestId };
    }
    return {
        error: exports.INTERNAL_SERVER_ERROR_CODE,
        requestId,
        detail: String(err),
    };
}
function contentSecurityPolicy(env = process.env) {
    const extraConnect = String(env.CSP_CONNECT_SRC_EXTRA ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    const directives = [
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
function securityHeaders(env = process.env) {
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
