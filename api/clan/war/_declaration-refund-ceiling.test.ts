import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLAN_WAR_RULES } from '../../../shared/clan-war-campaign.js';

/*
 * A do-not-touch trap pinned (2026-10 rebalance, framework I-20).
 *
 * The clan-war service-cancel refund (api/clan/war/_campaign-service-cancel.ts)
 * refuses any payment above a literal 100 Honor Seals as invalid. The price it
 * refunds lives elsewhere (shared/clan-war-campaign.ts `declarationCost: 100`,
 * 90 with the warmonger doctrine), and nothing tied the two together: a
 * rebalance that raised the declaration would silently stop every service
 * refund. This test ties them.
 */

test('the clan-war declaration never costs more than the service-cancel refund accepts', () => {
    // Read from the repo root (the test runner's cwd): api tests also compile to CommonJS.
    const source = readFileSync(join(process.cwd(), 'api', 'clan', 'war', '_campaign-service-cancel.ts'), 'utf8');
    const ceiling = /payment\.amount\s*>\s*(\d+)/.exec(source);
    assert.ok(ceiling, 'the refund ceiling check is still in api/clan/war/_campaign-service-cancel.ts');
    const refundCeiling = Number(ceiling[1]);
    assert.equal(refundCeiling, 100, 'the refund ceiling in _campaign-service-cancel.ts is 100 Honor Seals');
    assert.ok(
        CLAN_WAR_RULES.declarationCost <= refundCeiling,
        `raising the clan-war declaration (shared/clan-war-campaign.ts declarationCost: ${CLAN_WAR_RULES.declarationCost}) `
        + `above the service-cancel ceiling (${refundCeiling}) breaks service refunds; raise both together`,
    );
});
