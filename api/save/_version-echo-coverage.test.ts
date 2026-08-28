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
    // Sleeping-camp KO. It credits the attacker (base ryo, kill count, Vanguard
    // seals) and may then credit a head bounty on top; it echoes whichever write
    // touched the save LAST, so the client adopts the balance it will actually
    // read back. Used to be EXEMPT ("bumps silently") — it no longer does.
    'player/sleeper-kill.ts',
    // Ranked 2v2 ladder settlement. It rates up to four saves in one call, but
    // the CALLER is always one of them, and its only caller — pvp/ranked-2v2.ts's
    // settle action — echoes that participant's committed `_saveVersion` so the
    // client adopts the new rating rather than racing a stale local save. The
    // other three participants are covered by their own settle calls, each of
    // which is a no-op past the first thanks to the per-match receipt.
    'pvp/_ranked-2v2-settlement.ts',
    '_anbu-infiltration-store.ts',
    // Sector War garrison assault's personal settlement (item usage + HP). Its
    // only caller, village/sector-war.ts's garrison-resolve, echoes the exact
    // committed `_saveVersion` in every response branch (stall/superseded/scored).
    '_sector-war-garrison-store.ts',
    // Daily village tax. The debit runs in this helper; its only caller,
    // village/tax.ts, re-reads the record and echoes `_saveVersion`, which the
    // client adopts along with the new balances — mandatory here, because ryo is
    // client-owned and an unadopted debit would be undone by the next autosave.
    '_war-tax-apply.ts',
    'admin/content-publish.ts',
    'bank/claim-interest.ts',
    'battle/lock.ts',            // fires on every PvE defeat — the hottest path of all
    'clan/exchange/purchase.ts',
    'clan/mentor.ts',
    'clan/war/declare.ts',
    'clan/seal-pool/donate.ts',
    'festival/black-market.ts',
    'hollow-gate/combat-settle.ts',
    'hollow-gate/event.ts',
    'hollow-gate/settle.ts',
    'hollow-gate/step.ts',
    'hollow-gate/use-consumable.ts',
    'jutsu/speedup.ts',
    'jutsu/train-with-seals.ts',
    'legacy/trial.ts',
    'missions/claim-mission.ts',
    'missions/queue-combat-claim.ts',
    'missions/report-pet-event.ts',
    'missions/report-raid.ts',
    'missions/weekly-board.ts',
    'pet/battle-result.ts',
    'pet/evolve.ts',
    'pet/gauntlet.ts',
    'pet/showdown.ts',
    'player/daily-login.ts',
    'player/_cross-heal-settlement.ts',
    'player/heal.ts',
    'profession/choose.ts',
    'pvp/bounty.ts',
    'pvp/claim-rewards.ts',
    'save/_mutate-player-save.ts',
    // Sector Contracts. The claim pays ryo, which is client-owned, so the
    // response echoes the committed `_saveVersion` and the client adopts the
    // server's `totalRyo` — without both, the next autosave would undo the
    // bounty it just collected.
    'sector/contract.ts',
    'sector/questbook.ts',
    'sector/rift-quest.ts',
    'sector/story-reckoning.ts',
    'sector/wanderer-ambush.ts',
    'sector/wanderer-gift.ts',
    'sector/wanderer-quest.ts',
    'sector/wanderer-service.ts',
    'towers/start.ts',
    'village/claim-daily-agenda.ts',
    'village/claim-map-control.ts',
    'village/claim-war-crate.ts',
    'village/hollow-gate-unlock.ts',
    'village/kage-challenge.ts',
    'village/hire-mercenary.ts',
    'weekly-boss.ts',
]);

// These routes mutate through a versioned shared settlement helper rather than
// importing the low-level bumper themselves. Their authenticated response is
// still responsible for echoing the helper's exact committed version.
const INDIRECT_VERSION_MUTATION_ROUTES = new Set([
    'missions/report-raid.ts',
    // Ranked/base settlement moved behind writeVersionedPlayerSave, so this route
    // no longer names a BUMP_MARKER itself. It still bumps — that helper builds a
    // versionedPlayerRecord and commits it with compareSet — and it still rereads
    // and echoes the authenticated caller's final `_saveVersion`.
    'pvp/claim-rewards.ts',
    // The Honor Seal debit moved into _war-mercenary-hire.ts, so this route no
    // longer names a BUMP_MARKER either. It still bumps through that saga and
    // still echoes the hiring player's `_saveVersion`.
    'village/hire-mercenary.ts',
]);

/**
 * Known backlog — player-triggered writes that still bump silently. Each one can strand
 * a stale version and cost the player their in-flight local state exactly once, until
 * the next successful save re-syncs.
 */
const PENDING_ECHO = new Set<string>();

/**
 * Exempt, with reasons:
 *  - admin/*, cron/*, billing     — no player autosave follows on that client, and the
 *    affected player usually is not the caller at all.
 *  - multi-player writes         — they bump SOMEONE ELSE'S save too, so a single
 *    `_saveVersion` in the response would be ambiguous; handing the caller another
 *    player's version would push its base version too high and 409 on purpose.
 *  - shared helpers / world state — reached through many callers; the caller owns the echo.
 */
const EXEMPT = new Set([
    // Head-bounty settlement for a kill with no PvP session behind it. A helper,
    // not a route: it bumps the hunter's save and RETURNS that version to its
    // caller (player/sleeper-kill.ts), which echoes it. Exposing a version from
    // here would duplicate that responsibility, not discharge it.
    'pvp/_bounty-settle.ts',
    // Clan War 2v2 consumable charge. It debits every fighter who spent an item
    // — up to four saves in one call — so there is no single participant whose
    // `_saveVersion` it could echo. It is also reached from settlement rather
    // than from a request the charged player made, so no response of theirs is
    // in flight to carry one. Each save is stamped with its own durable receipt,
    // which is what makes the charge exactly-once instead of version-guarded.
    'clan/war/_mpvp-consumables.ts',
    // Village-war Honor Seal sagas. Both debit the declaring/hiring player and
    // bump that save, but they are helpers with several callers and cannot pick
    // one participant's version to expose. village/hire-mercenary.ts rereads and
    // echoes the caller's final `_saveVersion`.
    //
    // _war-declaration-funding.ts bumps a player save on its `honor-seals`
    // branch ONLY — projectSourceEntry/projectDebit reach versionedPlayerRecord
    // just there. Its `war-resources` branch debits the village pool row
    // (`shared:village-war:*`) and never opens a save at all. The saga now
    // returns the exact committed `sourceRow` alongside the receipt, so its one
    // honor-seals caller — world-state.ts's village-war declare — echoes that
    // row's `_saveVersion` to the charged Kage (gated by
    // _world-war-declaration.test.ts). The helper itself stays exempt: several
    // callers reach it, and only each caller knows which participant it may echo.
    //
    // village/sector-war.ts funds exclusively from `war-resources`: it 404s
    // whenever the war map is disabled, and that flag being disabled is the only
    // condition that selects honor-seals. So that route commits no player save
    // version and has none to echo. The invariant is gated below and,
    // end-to-end, by village/sector-war-authority-race.test.ts.
    '_war-declaration-funding.ts',
    '_war-mercenary-hire.ts',
    'admin/bloodline-review.ts',
    'admin/economy-reconcile.ts',
    'admin/legacy.ts',
    'cron/_ranked-season.ts',
    // Weekly boss settlement credits MANY members' saves at once, from a timer with no
    // request to echo into. The bump is deliberate and load-bearing: it is what stops a
    // rewarded player's next full-character autosave from overwriting the credit — that
    // client 409s and refetches the reward instead.
    'cron/_clan-boss-weekly.ts',
    // Subscription entitlement writer (was patreon/_patreon.ts until the Patreon
    // rail was removed). Writes the server-owned perk flag from an admin comp or
    // a billing-provider callback — never from a request the affected player
    // made, so there is no response of theirs in flight to carry a version.
    '_subscription.ts',
    'clan/seal-pool/distribute.ts',
    'player/trade.ts',
    'missions/_progress.ts',
    // Shared two-save ranked helper. pet/battle-result settles both fighters,
    // then rereads and echoes only the requesting player's final `_saveVersion`;
    // exposing either side's version from this helper would be ambiguous.
    'pet/_ranked-settlement.ts',
    // Shared two-save player-ranked journal. It may run from the claimant route
    // (which rereads and echoes that caller's final version) or the season cron;
    // the helper itself cannot choose one participant's version to expose.
    'pvp/_player-ranked-journal.ts',
    // Shared two-save consumable helper. Its version-bumping legacy branch is
    // reached through pvp/claim-rewards, which rereads and echoes only the
    // authenticated caller's final `_saveVersion` after both sides settle.
    // Ranked-V2 move/cron callers take the empty-usage confirmation branch and
    // do not mutate either save here, so this helper has no single safe echo.
    'pvp/_consumable-settlement.ts',
    // Daily cron pass (kage-inactivity): refunds a pending challenger's declare
    // stake under their save lock when an absent Kage's seat is vacated. There is
    // no HTTP response to echo a version into; the challenger's next load adopts
    // the bumped `_saveVersion` and they are told via an offline notice.
    'village/_kage-inactivity.ts',
    // Shared multi-member operation helper; assault-settle rereads and echoes the
    // requesting member's final `_saveVersion` after all reward helpers complete.
    'clan-boss/_profession.ts',
    // Shared crash-recovery helper. Direct recovery changes the caller, while a
    // party lifecycle repair can refund the host on another member's request;
    // exposing the host's version from the helper would be ambiguous and unsafe.
    'towers/_entry-recovery.ts',
    'towers/_tower-store.ts',
    // Many actions on one route, most of them world/village rows rather than
    // saves. Its one save-versioning action — the village-war declaration's
    // Honor Seal debit, live only when the war map is disabled — echoes the
    // declaring Kage's committed `_saveVersion` (_world-war-declaration.test.ts).
    'world-state.ts',
    '_clan-points.ts',
    // Shared acceptance writer; sage.ts and stats.ts return the exact record
    // stamp from this helper to the requesting player.
    'legacy/_acceptance.ts',
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

const helperMutationRoutes = collect(API_DIR)
    .filter((file) => {
        const src = readFileSync(file, 'utf8');
        return src.includes('mutatePlayerSave') && /export\s+default\s+async\s+function/.test(src);
    })
    .map((file) => relative(API_DIR, file).split('\\').join('/'));

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
        assert.ok(
            bumpers.includes(rel) || INDIRECT_VERSION_MUTATION_ROUTES.has(rel),
            `${rel} no longer bumps the save version — update ECHOES_VERSION`,
        );
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

/*
 * The `_war-declaration-funding.ts` exemption above rests on sector-war never
 * selecting the save-bumping `honor-seals` branch. Lock that here: the moment a
 * sector declaration spends a player's Honor Seals it starts bumping that
 * player's save version, and the route owes them a `_saveVersion` echo.
 */
test('sector-war declarations never fund from a player save', () => {
    const src = readFileSync(join(API_DIR, 'village/sector-war.ts'), 'utf8');
    assert.deepEqual(
        src.match(/'honor-seals'/g) ?? [],
        [],
        'village/sector-war.ts now names an honor-seals funding source — that branch bumps the '
        + "declaring player's save version, so the route must reread and echo `_saveVersion` "
        + '(the village/hire-mercenary.ts pattern) and leave the _war-declaration-funding exemption',
    );
});

test('every mutatePlayerSave route acknowledges the committed version', () => {
    for (const rel of helperMutationRoutes) {
        const src = readFileSync(join(API_DIR, rel), 'utf8');
        assert.match(
            src,
            /_saveVersion/,
            `${rel} uses mutatePlayerSave but never returns its exact _saveVersion`,
        );
    }
});
