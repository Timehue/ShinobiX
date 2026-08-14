import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('README and canonical status agree that ShinobiX is a live public beta', () => {
    const readme = read('README.md');
    const roadmap = read('docs/ROADMAP.md');
    const status = read('docs/LIVE_PRODUCT_STATUS.md');
    assert.match(readme, /\*\*live public beta\*\*/i);
    assert.match(readme, /Live Product Status/);
    assert.match(status, /canonical repository authority/);
    assert.match(status, /live public-beta browser MMORPG/i);
    assert.doesNotMatch(readme, /public beta candidate|moves toward public beta|Gate or soft-launch/i);
    assert.doesNotMatch(roadmap, /before invites|public beta candidate|moves toward public beta|Gate or soft-launch/i);
});

test('static prelaunch warnings cannot return to ordinary gameplay', () => {
    assert.equal(existsSync('shinobij.client/src/lib/release-readiness.ts'), false);
    assert.equal(existsSync('shinobij.client/src/components/ReleaseReadinessNotice.tsx'), false);
    const app = read('shinobij.client/src/App.tsx');
    const hint = read('shinobij.client/src/components/ScreenHint.tsx');
    const liveNotice = read('shinobij.client/src/components/LiveServiceNotice.tsx');
    assert.doesNotMatch(app, /ReleaseReadinessNotice|release-readiness/);
    assert.doesNotMatch(hint, /advanced beta systems|soft-launch|desktop-first/i);
    assert.match(liveNotice, /liveServiceNotice/);
});

test('current progression truth names only Genin and Chunin as holds', () => {
    const status = read('docs/LIVE_PRODUCT_STATUS.md');
    const gates = read('shared/progression-holds.ts');
    const objectives = read('shinobij.client/src/lib/logbook-objectives.ts');
    assert.match(status, /only level-progression exam holds are Genin at level 20 and Chunin at level 39/);
    assert.match(gates, /exam: 'genin'/);
    assert.match(gates, /exam: 'chunin'/);
    assert.doesNotMatch(gates, /exam: 'jonin'|exam: 'specialJonin'/);
    assert.match(objectives, /progressionImpact === "blocking"/);
    assert.match(objectives, /optional leadership and PvP ceremony is prestige only/i);
});

test('rollout-era wording survives only with a prominent historical marker', () => {
    const historical = [
        'PUBLIC_BETA_LAUNCH_RECOMMENDATION.md',
        'FEATURE_FLAG_RELEASE_MATRIX.md',
        'docs/BETA_LIVE_OPERATIONS.md',
        'docs/RELEASE_NOTES_v0.1.0-beta.md',
    ];
    for (const path of historical) {
        assert.match(read(path).slice(0, 900), /HISTORICAL ROLLOUT EVIDENCE — SUPERSEDED FOR CURRENT AVAILABILITY/, path);
    }
    assert.match(read('docs/MMO_ROUNDNESS_IMPLEMENTATION_REPORT.md').slice(0, 900), /HISTORICAL IMPLEMENTATION EVIDENCE/);
});

test('the public capability route is wired and its contract excludes raw environment payloads', () => {
    const server = read('server.ts');
    const handler = read('api/player/capabilities.ts');
    assert.match(server, /route\('\/player\/capabilities', playerCapabilitiesHandler\)/);
    assert.match(handler, /publicCapabilities\(\)/);
    assert.doesNotMatch(handler, /process\.env|Object\.entries\(process\.env\)|DATABASE_URL|TOKEN|PASSWORD|SECRET/);
});
