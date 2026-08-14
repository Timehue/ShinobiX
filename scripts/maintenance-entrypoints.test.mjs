import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('legacy ledger commands route through the guarded combined scanner', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.scripts['ledger:audit'], 'node --import tsx scripts/currency-ledger-audit.mjs');
    assert.equal(pkg.scripts['ledger:backfill'], 'node --import tsx scripts/data-integrity-scan.mjs --repair');

    const shim = readFileSync(new URL('./currency-ledger-audit.mjs', import.meta.url), 'utf8');
    assert.match(shim, /process\.argv\.splice\(backfillIndex, 1, '--repair'\)/);
    assert.match(shim, /import\('\.\/data-integrity-scan\.mjs'\)/);
});

test('operator output defaults to pseudonyms and never logs target credential values', () => {
    const scan = readFileSync(new URL('./data-integrity-scan.mjs', import.meta.url), 'utf8');
    const patreon = readFileSync(new URL('./patreon-staging-smoke.mjs', import.meta.url), 'utf8');
    assert.match(scan, /subjectLabel\(name, INCLUDE_IDENTIFIERS\)/);
    assert.match(scan, /identifiers: INCLUDE_IDENTIFIERS \? 'included' : 'pseudonymized'/);
    assert.doesNotMatch(scan, /console\.(?:log|error)\([^\n]*(?:DATABASE_URL|PATREON_WEBHOOK_SECRET|PATREON_STAGING_ADMIN_TOKEN)/);
    assert.doesNotMatch(patreon, /console\.(?:log|error)\([^\n]*(?:PATREON_WEBHOOK_SECRET|PATREON_STAGING_ADMIN_TOKEN)/);
});

test('integrity certification fails closed when the admin item catalog cannot load', () => {
    const scan = readFileSync(new URL('./data-integrity-scan.mjs', import.meta.url), 'utf8');
    assert.match(scan, /const adminItems = await loadAdminItemObjects\(\);/);
    assert.doesNotMatch(scan, /loadAdminItemObjects\(\)\.catch\(/);
});

test('limited integrity scans are labeled non-certifying and cannot return clean certification', () => {
    const scan = readFileSync(new URL('./data-integrity-scan.mjs', import.meta.url), 'utf8');
    assert.match(scan, /NON-CERTIFYING SAMPLE/);
    assert.match(scan, /CLEAN SAMPLE ONLY/);
    assert.match(scan, /report\.total\(\) === 0 && scope\.completeScan \? 0 : 1/);
});
