import { expect } from '@playwright/test';
import { test } from './helpers/reconnecting-request';

test('built Express serves the beacon CSP on HTML, assets and API responses', async ({ request }) => {
    const landing = await request.get('/');
    expect(landing.status()).toBe(200);
    const html = await landing.text();
    const entry = html.match(/<script\b[^>]*\bsrc="(\/assets\/[^" ]+\.js)"/i)?.[1];
    expect(entry, 'the built landing page must reference its real application entry').toBeTruthy();
    const policy = landing.headers()['content-security-policy'];
    expect(policy).toBeTruthy();
    const scripts = policy.split(';').map(value => value.trim()).find(value => value.startsWith('script-src '));
    expect(scripts?.split(/\s+/).slice(1)).toEqual([
        "'self'", "'wasm-unsafe-eval'",
        'https://static.cloudflareinsights.com/beacon.min.js',
        'https://static.cloudflareinsights.com/beacon.min.js/',
    ]);
    // Cover each response path: static index, prerendered legal page, SPA deep
    // link, immutable Vite entry, API alias, and JSON/static error handlers.
    for (const [path, status, type] of [
        ['/', 200, 'text/html'],
        ['/privacy', 200, 'text/html'],
        ['/sector/12', 200, 'text/html'],
        [entry!, 200, 'javascript'],
        ['/player/capabilities', 200, 'application/json'],
        ['/api/player/capabilities', 200, 'application/json'],
        ['/api/csp-route-that-does-not-exist', 404, 'application/json'],
        ['/assets/csp-missing-entry.js', 404, 'text/plain'],
    ] as const) {
        const response = await request.get(path);
        expect(response.status(), path).toBe(status);
        expect(response.headers()['content-type'], path).toContain(type);
        expect(response.headers()['content-security-policy'], path).toBe(policy);
        expect(response.headers()['x-content-type-options'], path).toBe('nosniff');
    }
});

test('Express preserves API aliases, CORS preflight and JSON failures', async ({ request }) => {
    const health = await request.get('/health');
    expect(health.status()).toBe(200);
    expect(health.headers()['content-type']).toContain('application/json');

    const bare = await request.get('/player/capabilities');
    const prefixed = await request.get('/api/player/capabilities');
    expect(bare.status()).toBe(200);
    expect(prefixed.status()).toBe(bare.status());
    expect(await prefixed.json()).toEqual(await bare.json());

    for (const path of ['/save/route-smoke', '/api/save/route-smoke']) {
        const preflight = await request.fetch(path, {
            method: 'OPTIONS',
            headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-player-token' },
        });
        expect([200, 204]).toContain(preflight.status());
        expect(preflight.headers()['access-control-allow-origin']).toBe('http://localhost:5173');
        expect(preflight.headers()['access-control-allow-methods']).toContain('POST');
    }

    const missing = await request.get('/api/refactor-route-that-does-not-exist');
    expect(missing.status()).toBe(404);
    expect(missing.headers()['cache-control']).toBe('no-store');
    expect(missing.headers()['content-type']).toContain('application/json');
    expect(await missing.json()).toMatchObject({ error: 'API route not found.' });
});
