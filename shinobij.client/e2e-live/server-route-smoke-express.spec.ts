import { expect, test } from '@playwright/test';

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
