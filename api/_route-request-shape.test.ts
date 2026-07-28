import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

/*
 * The Express route() wrapper must hand handlers a request that still behaves like a
 * Node IncomingMessage.
 *
 * It used to build `{ ...req, query, headers, method, body, rawBody }`. Object spread
 * copies own enumerable properties ONLY, so every prototype method was dropped:
 * `{...req}.on` is `undefined`. api/pvp/stream.ts is the one handler that uses request
 * stream methods — it calls `req.on('close')` to notice a disconnect — and that threw
 * AFTER the SSE headers and first event had been written. The client saw the stream
 * open, marked itself "connected", then got nothing more, and because the connection
 * was never actually closed it never fired `onerror` and never fell back to polling:
 * a PvP board frozen on stale state. The response was also never ended, so the socket
 * was held and a Sentry exception was logged on every connect.
 */

const serverSource = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');

describe('route() request augmentation', () => {
    it('passes the real request through instead of a spread copy', () => {
        assert.match(serverSource, /await handler\(req, res\);/, 'handlers must receive the real req');
        assert.doesNotMatch(
            serverSource,
            /const augmented = \{\s*\.\.\.req,/,
            'spreading req drops prototype methods (req.on) and breaks SSE',
        );
    });

    it('still merges route params into query for bracketed handlers', () => {
        // api/save/[name].ts and friends read the route segment off req.query.name.
        assert.match(serverSource, /value: \{ \.\.\.req\.query, \.\.\.req\.params \}/);
    });

    it('defines query as an own property rather than assigning it', () => {
        // `query` is a getter with no setter on the Express 5 request prototype, so
        // plain assignment throws in strict mode.
        assert.match(serverSource, /Object\.defineProperty\(req, 'query', \{/);
    });
});

describe('the augmented request behaves like an IncomingMessage', () => {
    /** Replicates exactly what route() does to the request, then reports what a handler sees. */
    async function inspectHandlerRequest(): Promise<{
        onType: string;
        closeFired: boolean;
        query: Record<string, unknown>;
        method: string | undefined;
        threw: string | null;
    }> {
        const app = express();
        let closeFired = false;
        const seen: {
            onType: string; query: Record<string, unknown>; method: string | undefined; threw: string | null;
        } = { onType: 'missing', query: {}, method: undefined, threw: null };

        app.all('/probe/:name', (req, res) => {
            // ── the exact route() augmentation ──
            Object.defineProperty(req, 'query', {
                value: { ...req.query, ...req.params },
                writable: true,
                enumerable: true,
                configurable: true,
            });
            // ── what a Vercel-style handler then does ──
            seen.onType = typeof (req as unknown as { on?: unknown }).on;
            seen.query = req.query as Record<string, unknown>;
            seen.method = req.method;
            try {
                req.on('close', () => { closeFired = true; });
            } catch (error) {
                seen.threw = (error as Error).message;
            }
            res.end('ok');
        });

        const server = app.listen(0);
        await new Promise((resolve) => server.once('listening', resolve));
        const { port } = server.address() as AddressInfo;
        await fetch(`http://127.0.0.1:${port}/probe/Rill?combatOnly=1`);
        // Let the socket close so the 'close' listener can run.
        await new Promise((resolve) => setTimeout(resolve, 80));
        await new Promise((resolve) => server.close(resolve));

        return { ...seen, closeFired };
    }

    it('keeps req.on callable and firing, and merges params over query', async () => {
        const seen = await inspectHandlerRequest();

        assert.equal(seen.threw, null, 'req.on must not throw — this is what broke api/pvp/stream.ts');
        assert.equal(seen.onType, 'function', 'req.on must survive the augmentation');
        assert.equal(seen.closeFired, true, 'the close listener must actually fire on disconnect');
        assert.deepEqual(seen.query, { combatOnly: '1', name: 'Rill' }, 'route params merge over query');
        assert.equal(seen.method, 'GET', 'method is still readable');
    });

    it('proves a spread copy would have lost req.on', async () => {
        // Guards the reasoning above, so nobody "simplifies" this back to a spread.
        const app = express();
        let spreadOnType = 'unchecked';
        app.all('/spread', (req, res) => {
            spreadOnType = typeof ({ ...req } as { on?: unknown }).on;
            res.end('ok');
        });
        const server = app.listen(0);
        await new Promise((resolve) => server.once('listening', resolve));
        const { port } = server.address() as AddressInfo;
        await fetch(`http://127.0.0.1:${port}/spread`);
        await new Promise((resolve) => server.close(resolve));

        assert.equal(spreadOnType, 'undefined', 'object spread does not copy prototype methods');
    });
});
