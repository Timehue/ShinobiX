import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/*
 * Any endpoint that bumps a player's stored save version should TELL that player.
 *
 * The client echoes its last known version as `_baseSaveVersion` on every autosave, and
 * the save route rejects a stale one with 409. The client's 409 recovery refetches the
 * server snapshot and applies it wholesale — so a version the client never learned about
 * turns its next autosave into a silent rollback of whatever it had in flight.
 *
 * The client side needs nothing per endpoint: authFetch's observeSaveVersion picks
 * `_saveVersion` out of ANY JSON response body and adopts it monotonically
 * (SAVE_VERSION_EVENT → App.tsx). So "tell the player" just means including
 * `_saveVersion` in the response.
 *
 * This is a RATCHET, not a clean bill of health. `ECHOES_VERSION` is fixed and must stay
 * fixed. `PENDING_ECHO` is the known-unfixed backlog: when you fix one, move it up —
 * the test fails if a pending file starts echoing, which keeps the list honest and
 * shrinking. Anything not in either list, and not exempt, fails the build so a NEW
 * save-mutating endpoint forces a deliberate decision.
 */

const API_DIR = join(process.cwd(), 'api');
const BUMP_MARKERS = ['bumpSaveVersion', 'versionedPlayerRecord'];

/**
 * Compliant: these return `_saveVersion` and must keep doing so. Most were already
 * correct — the reward and settlement paths (claims, raids, Hollow Gate, PvP payouts)
 * have echoed from the start, which is why mission rewards survive a 409.
 */
const ECHOES_VERSION = new Set([
    '_anbu-infiltration-store.ts',
    'admin/content-publish.ts',
    'bank/claim-interest.ts',
    'battle/lock.ts',            // fires on every PvE defeat — the hottest path of all
    'clan/war/declare.ts',
    'festival/black-market.ts',
    'hollow-gate/combat-settle.ts',
    'hollow-gate/settle.ts',
    'hollow-gate/use-consumable.ts',
    'jutsu/speedup.ts',
    'jutsu/train-with-seals.ts',
    'missions/claim-mission.ts',
    'missions/queue-combat-claim.ts',
    'missions/report-pet-event.ts',
    'missions/report-raid.ts',
    'missions/weekly-board.ts',
    'pet/battle-result.ts',
    'pet/evolve.ts',
    'pet/gauntlet.ts',
    'player/daily-login.ts',
    'player/heal.ts',
    'profession/choose.ts',
    'pvp/bounty.ts',
    'pvp/claim-rewards.ts',
    'save/_mutate-player-save.ts',
    'village/claim-daily-agenda.ts',
    'village/claim-map-control.ts',
    'village/claim-war-crate.ts',
    'village/hollow-gate-unlock.ts',
    'village/kage-challenge.ts',
]);

/**
 * Known backlog — player-triggered writes that still bump silently. Each one can strand
 * a stale version and cost the player their in-flight local state exactly once, until
 * the next successful save re-syncs.
 */
const PENDING_ECHO = new Set([
    'clan/exchange/purchase.ts',
    'clan/mentor.ts',
    'clan/seal-pool/donate.ts',
    'legacy/sage.ts',
    'legacy/trial.ts',
    'sector/questbook.ts',
    'sector/rift-quest.ts',
    'sector/story-reckoning.ts',
    'sector/wanderer-ambush.ts',
    'sector/wanderer-gift.ts',
    'sector/wanderer-quest.ts',
    'sector/wanderer-service.ts',
    'village/hire-mercenary.ts',
    'weekly-boss.ts',
]);

/**
 * Exempt, with reasons:
 *  - admin/*, cron/*, patreon/*  — no player autosave follows on that client, and the
 *    affected player usually is not the caller at all.
 *  - multi-player writes         — they bump SOMEONE ELSE'S save too, so a single
 *    `_saveVersion` in the response would be ambiguous; handing the caller another
 *    player's version would push its base version too high and 409 on purpose.
 *  - shared helpers / world state — reached through many callers; the caller owns the echo.
 */
const EXEMPT = new Set([
    'admin/bloodline-review.ts',
    'admin/economy-reconcile.ts',
    'admin/legacy.ts',
    'cron/_ranked-season.ts',
    // Weekly boss settlement credits MANY members' saves at once, from a timer with no
    // request to echo into. The bump is deliberate and load-bearing: it is what stops a
    // rewarded player's next full-character autosave from overwriting the credit — that
    // client 409s and refetches the reward instead.
    'cron/_clan-boss-weekly.ts',
    'patreon/_patreon.ts',
    'clan/seal-pool/distribute.ts',
    'player/sleeper-kill.ts',
    'player/trade.ts',
    'missions/_progress.ts',
    'towers/_tower-store.ts',
    'world-state.ts',
    '_clan-points.ts',
    '_elapsed-state.ts',
    '_era.ts',
]);

function collect(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { collect(full, out); continue; }
        if (!entry.name.endsWith('.ts') || entry.name.includes('.test.')) continue;
        out.push(full);
    }
    return out;
}

const bumpers = collect(API_DIR)
    .filter((file) => {
        const src = readFileSync(file, 'utf8');
        return BUMP_MARKERS.some((marker) => src.includes(marker));
    })
    .map((file) => relative(API_DIR, file).split('\\').join('/'))
    // The versioning helper itself and the save route (which owns the contract).
    .filter((rel) => rel !== 'save/_save-version.ts' && rel !== 'save/[name].ts');

test('every save-version bumper is classified', () => {
    const unclassified = bumpers.filter((rel) => !ECHOES_VERSION.has(rel) && !PENDING_ECHO.has(rel) && !EXEMPT.has(rel));
    assert.deepEqual(
        unclassified,
        [],
        'new endpoint(s) bump the save version — return `_saveVersion` and add to ECHOES_VERSION, '
        + 'or justify an entry in PENDING_ECHO / EXEMPT',
    );
});

test('the fixed endpoints still echo their new save version', () => {
    for (const rel of ECHOES_VERSION) {
        assert.ok(bumpers.includes(rel), `${rel} no longer bumps the save version — update ECHOES_VERSION`);
        const src = readFileSync(join(API_DIR, rel), 'utf8');
        assert.match(src, /_saveVersion/, `${rel} must return _saveVersion to the client`);
    }
});

test('the pending backlog shrinks rather than drifts', () => {
    for (const rel of PENDING_ECHO) {
        assert.ok(bumpers.includes(rel), `${rel} no longer bumps the save version — remove it from PENDING_ECHO`);
        const src = readFileSync(join(API_DIR, rel), 'utf8');
        assert.doesNotMatch(
            src,
            /_saveVersion/,
            `${rel} now echoes its save version — move it from PENDING_ECHO to ECHOES_VERSION`,
        );
    }
});
