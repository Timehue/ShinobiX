import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

test('fingerprint releases its temporary GPU context without changing its result or cache', async t => {
    for (const mode of ['success', 'read-failure', 'cleanup-failure', 'no-extension'] as const) {
        await t.test(mode, async () => {
            let lost = 0;
            let probes = 0;
            const canvases: { width: number; height: number }[] = [];
            const gl = {
                getExtension(name: string) {
                    if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_VENDOR_WEBGL: 1, UNMASKED_RENDERER_WEBGL: 2 };
                    if (mode === 'no-extension') return null;
                    return { loseContext() { lost++; if (mode === 'cleanup-failure') throw new Error('driver cleanup unavailable'); } };
                },
                getParameter(id: number) {
                    if (mode === 'read-failure') throw new Error('renderer read unavailable');
                    return id === 1 ? 'test-vendor' : 'test-renderer';
                },
            };
            const globals = {
                document: { createElement() {
                    const canvas = { width: 300, height: 150, getContext(kind: string) {
                        if (kind === '2d') return null;
                        probes++;
                        return gl;
                    } };
                    canvases.push(canvas);
                    return canvas;
                } },
                sessionStorage: { getItem: () => null, setItem: () => {} },
                screen: { width: 1366, height: 768, colorDepth: 24 },
                devicePixelRatio: 1,
                navigator: { languages: ['en-US'], language: 'en-US', hardwareConcurrency: 8, platform: 'test', userAgent: 'test-browser' },
            };
            const originals = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
            try {
                for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
                const { getFingerprint } = await import(`./fingerprint.ts?cleanup-test=${mode}`);
                const fp = await getFingerprint();
                const parts = ['', mode === 'read-failure' ? '' : 'test-vendor|test-renderer', 1366, 768, 24, 1,
                    Intl.DateTimeFormat().resolvedOptions().timeZone, 'en-US', 8, 'test', 'test-browser'];
                assert.equal(fp, createHash('sha256').update(parts.join('::')).digest('hex').slice(0, 32));
                assert.equal(await getFingerprint(), fp);
                assert.equal(probes, 1, 'the cached fingerprint must not allocate another context');
                assert.equal(lost, mode === 'no-extension' ? 0 : 1);
                assert.equal(canvases[1].width, 1);
                assert.equal(canvases[1].height, 1);
            } finally {
                for (const [key, descriptor] of originals) {
                    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
                    else Reflect.deleteProperty(globalThis, key);
                }
            }
        });
    }
});
