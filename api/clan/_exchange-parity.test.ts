import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLAN_EXCHANGE_ITEMS } from './_exchange.js';

// Guards the server catalog against its hardcoded client mirror
// (shinobij.client/src/components/ClanExchange.tsx). The client duplicates the
// item defs verbatim so the shop renders without a round-trip; merge 7e9b71a79
// once silently reverted the client half of the hall re-gating (82e99dedc) and
// nothing caught it — players saw enabled buy buttons the server refused with
// `level-locked`. This test fails on ANY drift, either direction. No eval:
// the server items are rendered into the client's single-line literal format
// and compared as strings, so a mismatch prints the exact offending line.
const CLIENT_PATH = 'shinobij.client/src/components/ClanExchange.tsx';

function clientSource(): string {
    return readFileSync(CLIENT_PATH, 'utf8').split('\r\n').join('\n');
}

// Render a value the way the client component writes it: double-quoted strings,
// unquoted keys in the object's own key order, plain digits (no 50_000).
function literal(value: unknown): string {
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') return String(value);
    if (value !== null && typeof value === 'object') {
        const body = Object.entries(value).map(([k, v]) => `${k}: ${literal(v)}`).join(', ');
        return `{ ${body} }`;
    }
    throw new Error(`unexpected value in catalog: ${String(value)}`);
}

function clientItemLines(): string[] {
    const arrayText = clientSource().match(/const EXCHANGE_ITEMS[^=]*= \[([\s\S]*?)\n\];/)?.[1];
    assert.ok(arrayText, 'EXCHANGE_ITEMS array not found in the client component');
    const lines = arrayText.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('{ id:'));
    assert.ok(lines.length >= 10, `client item parse broke (found ${lines.length} literals)`);
    return lines.map((line) => line.replace(/,$/, ''));
}

describe('clan exchange client mirror', () => {
    it('matches the server catalog exactly, in order, on every field', () => {
        const client = clientItemLines();
        const server = CLAN_EXCHANGE_ITEMS.map((item) => literal(item));
        assert.equal(client.length, server.length, 'item count differs (missing or extra client entry)');
        for (let i = 0; i < server.length; i++) {
            assert.equal(client[i], server[i], `item ${CLAN_EXCHANGE_ITEMS[i]!.id} drifted`);
        }
    });

    it('renders every hall at the server unlock level', () => {
        // Each hall's unlock level as the server items define it.
        const hallLevels = new Map<string, number>();
        for (const item of CLAN_EXCHANGE_ITEMS) {
            const prev = hallLevels.get(item.hall);
            assert.ok(prev === undefined || prev === item.requiredClanLevel, `server hall ${item.hall} has mixed levels`);
            hallLevels.set(item.hall, item.requiredClanLevel);
        }
        const tiersText = clientSource().match(/const EXCHANGE_TIERS = \[([\s\S]*?)\n\] as const;/)?.[1];
        assert.ok(tiersText, 'EXCHANGE_TIERS table not found in the client component');
        const entries = [...tiersText.matchAll(/hall: "([a-z]+)"[^,]*, level: (\d+)/g)].map((m) => [m[1]!, Number(m[2])] as const);
        assert.deepEqual(new Map(entries), hallLevels, 'client hall table drifted from server unlock levels');
    });
});
