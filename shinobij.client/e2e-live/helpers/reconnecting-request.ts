import { test as base, type APIRequestContext } from '@playwright/test';

// Playwright's API client pools keep-alive sockets with no idle limit: its Node
// agent sets no timeout, so it never acts on the `Keep-Alive: timeout=5` hint
// Express sends. Express keeps Node's default 5s keepAliveTimeout, and on Node
// 22.23 the server closed an idle socket 6.03-6.08s after its last response. A
// request that picks up a pooled socket at that instant fails with ECONNRESET
// ("read ECONNRESET" or "socket hang up") before the server reads it: 9 of 38
// requests sent after 5.95-6.05s idle failed that way, and 0 of 38 with one
// retry. A live spec's API calls often follow browser-only work of arbitrary
// length, so every call gets Playwright's own reconnect: `maxRetries` retries
// ECONNRESET alone, after 250ms. An HTTP error response or a refused connection
// (a crashed server) still fails at once.
//
// Import `test` from here instead of '@playwright/test' and the `request`
// fixture reconnects. `page.request` and `route.fetch` use the same pooled
// sockets but are not that fixture: pass them `maxRetries: API_CONNECTION_RETRIES`.
export const API_CONNECTION_RETRIES = 1;
const RETRYING_API_METHODS = new Set(['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head']);

function withConnectionResetRetry(context: APIRequestContext): APIRequestContext {
    return new Proxy(context, {
        get(target, property) {
            const value: unknown = Reflect.get(target, property);
            if (typeof value !== 'function') return value;
            if (typeof property === 'string' && RETRYING_API_METHODS.has(property)) {
                return (urlOrRequest: unknown, options?: object) =>
                    value.call(target, urlOrRequest, { maxRetries: API_CONNECTION_RETRIES, ...options });
            }
            return value.bind(target);
        },
    });
}

export const test = base.extend({
    // Playwright's fixture callback, named `provide` so the React `use` hook
    // lint rule does not mistake it for one.
    request: async ({ request }, provide) => {
        await provide(withConnectionResetRetry(request));
    },
});
