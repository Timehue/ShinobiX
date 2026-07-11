import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const here = join(process.cwd(), 'api', 'admin');

function source(name: string): string {
    return readFileSync(join(here, name), 'utf8');
}

test('security, economy, player, and ranked operations require full admin', () => {
    const sensitive = [
        'battle-receipts.ts',
        'beta-metrics.ts',
        'economy.ts',
        'economy-reconcile.ts',
        'ranked-season.ts',
        'legacy.ts',
        'migrate-kv.ts',
        'moderation.ts',
        'player-index-health.ts',
        'players.ts',
        'save-snapshot.ts',
        'server-reset.ts',
    ];
    for (const file of sensitive) {
        assert.match(source(file), /isFullAdmin\(req\)/, `${file} must require full admin`);
    }
});

test('content admin stays limited to curation and content diagnostics', () => {
    for (const file of ['bloodline-review.ts', 'item-review.ts', 'asset-report.ts']) {
        assert.match(source(file), /isAdmin\(req\)/, `${file} should permit content admin`);
    }
    const audit = source('audit-log.ts');
    assert.match(audit, /domain !== 'content' && !isFullAdmin\(req\)/);
});
