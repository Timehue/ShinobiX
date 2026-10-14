import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLAN_EXCHANGE_ITEMS } from './_exchange.js';
import { CLAN_EXCHANGE_ITEMS as CANONICAL_ITEMS } from '../../shared/clan-exchange-catalog.js';

// The storefront and purchase authority now consume one canonical catalog.
// Preserve the original drift regression guard while eliminating its duplicate
// item literals; the UI's independently authored shelf grouping is still checked.
const CLIENT_PATH = 'shinobij.client/src/components/ClanExchange.tsx';

function clientSource(): string {
    return readFileSync(CLIENT_PATH, 'utf8').split('\r\n').join('\n');
}

describe('clan exchange client mirror', () => {
    it('uses the same catalog owner for the storefront and purchase authority', () => {
        assert.equal(CLAN_EXCHANGE_ITEMS, CANONICAL_ITEMS);
        assert.match(clientSource(), /import\s*\{\s*CLAN_EXCHANGE_ITEMS\s*\}\s*from\s*["'][^"']*shared\/clan-exchange-catalog["']/);
        assert.match(clientSource(), /const EXCHANGE_ITEMS:\s*ExchangeItem\[\]\s*=\s*CLAN_EXCHANGE_ITEMS;/);
        assert.doesNotMatch(clientSource(), /const EXCHANGE_ITEMS[^=]*=\s*\[/, 'a second shelf catalog reintroduced drift');
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
