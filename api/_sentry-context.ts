import type { Request } from 'express';
import { invokeSafeCapture } from '../shared/observability-sanitize.js';

type RequestWithId = Request & { id?: string };

type ScopeLike = {
    setTag(name: string, value: string): void;
    setTransactionName(name: string): void;
};

type SentryLike = {
    withScope(callback: (scope: ScopeLike) => void): void;
    captureException(error: unknown): unknown;
};

export type SafeRequestErrorContext = {
    requestId: string;
    method: string;
    route: string;
    subsystem: string;
};

function cleanTag(value: unknown, fallback: string, maxLength = 120): string {
    const text = String(value ?? '').trim().slice(0, maxLength);
    return /^[A-Za-z0-9_./:*-]+$/.test(text) ? text : fallback;
}

export function safeRequestErrorContext(req: RequestWithId): SafeRequestErrorContext {
    const routePath = typeof req.route?.path === 'string' ? req.route.path : '';
    const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
    const route = routePath ? cleanTag(`${base}${routePath}`, 'unmatched') : 'unmatched';
    const firstSegment = route.split('/').filter(Boolean)[0] ?? 'server';
    return {
        requestId: cleanTag(req.id, 'missing', 64),
        method: cleanTag(req.method, 'UNKNOWN', 16).toUpperCase(),
        route,
        subsystem: cleanTag(firstSegment, 'server', 48),
    };
}

export function captureExpressException(sentry: SentryLike, req: RequestWithId, error: unknown): boolean {
    try {
        const context = safeRequestErrorContext(req);
        sentry.withScope((scope) => {
            scope.setTransactionName(`${context.method} ${context.route}`);
            scope.setTag('request_id', context.requestId);
            scope.setTag('route_template', context.route);
            scope.setTag('gameplay_subsystem', context.subsystem);
            invokeSafeCapture((caught) => sentry.captureException(caught), error);
        });
        return true;
    } catch {
        return false;
    }
}
