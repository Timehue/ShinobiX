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
    // (player/sleeper-kill.ts used to be listed here. It now commits the KO and
    // the attacker's credit through mutatePlayerSaves and names no BUMP_MARKER,
    // so the "every mutatePlayerSave route acknowledges the committed version"
    // gate below covers it. It still echoes whichever write touched the
    // attacker's save LAST — the credit, or a head bounty on top.)
    // Ranked 2v2 ladder settlement. It rates up to four saves in one call, but
    // the CALLER is always one of them, and its only caller — pvp/ranked-2v2.ts's
    // settle action — echoes that participant's committed `_saveVersion` so the
    // client adopts the new rating rather than racing a stale local save. The
    // other three participants are covered by their own settle calls, each of
    // which is a no-op past the first thanks to the per-match receipt.
    'pvp/_ranked-2v2-settlement.ts',
    // _anbu-infiltration-store.ts (the raid's win credit, loss settle and cache
    // turn-in) and _sector-war-garrison-store.ts (the garrison assault's item
    // usage + HP) now commit through mutatePlayerSave and no longer name a
    // BUMP_MARKER. They still return that exact committed `_saveVersion`, and
    // their only callers — village/anbu-infiltration.ts and village/sector-war.ts's
    // garrison-resolve — still echo it in every response branch.
    // Daily village tax. The debit runs in this helper; its only caller,
    // village/tax.ts, re-reads the record and echoes `_saveVersion`, which the
    // client adopts along with the new balances — mandatory here, because ryo is
    // client-owned and an unadopted debit would be undone by the next autosave.
    '_war-tax-apply.ts',
    'admin/content-publish.ts',
    'clan/exchange/purchase.ts',
    'clan/mentor.ts',
    'clan/war/declare.ts',
    'clan/seal-pool/donate.ts',
    'hollow-gate/combat-settle.ts',
    'hollow-gate/event.ts',
    'hollow-gate/settle.ts',
    'hollow-gate/use-consumable.ts',
    // jutsu/speedup.ts now commits through mutatePlayerSave, so the
    // "every mutatePlayerSave route acknowledges the committed version" test
    // below covers it (it used to echo the pre-bump version — a stale ack).
    // jutsu/train-with-seals.ts no longer writes: Seal levels are timed lessons
    // through training/jutsu-ryo.ts (payWith: 'honorSeals'), which echoes.
    'missions/claim-mission.ts',
    'missions/queue-combat-claim.ts',
    'missions/report-raid.ts',
    'pet/battle-result.ts',
    'pet/showdown.ts',
    // player/_cross-heal-settlement.ts now commits both saves through
    // mutatePlayerSaves and names no BUMP_MARKER. It still returns the healer's
    // exact committed `_saveVersion`, which player/heal.ts echoes.
    // battle/lock.ts (every PvE defeat — the hottest path of all),
    // hollow-gate/step.ts, legacy/trial.ts, missions/report-pet-event.ts,
    // pet/gauntlet.ts, player/heal.ts and weekly-boss.ts now commit through
    // mutatePlayerSave, so the "every mutatePlayerSave route acknowledges the
    // committed version" test below covers them.
    // bank/claim-interest.ts, missions/weekly-board.ts, pet/evolve.ts,
    // player/daily-login.ts, profession/choose.ts, village/claim-daily-agenda.ts
    // and village/claim-war-crate.ts now commit through mutatePlayerSave, so the
    // "every mutatePlayerSave route acknowledges the committed version" test
    // below covers them.
    'pvp/bounty.ts',
    'pvp/claim-rewards.ts',
    'save/_mutate-player-save.ts',
    'sector/shrine-offer.ts',
    'clan/treasury/donate.ts',
    'village/treasury/donate.ts',
    // The sector quests and wanderer services (sector/contract.ts — whose claim
    // pays client-owned ryo, so the client must adopt the committed version and
    // `totalRyo` together — plus questbook, rift-quest, story-reckoning,
    // wanderer-ambush, -gift, -quest and -service) and festival/black-market.ts
    // now commit through mutatePlayerSave, so the "every mutatePlayerSave route
    // acknowledges the committed version" test below covers them.
    'towers/start.ts',
    'village/claim-map-control.ts',
    'village/hollow-gate-unlock.ts',
    'village/kage-challenge.ts',
    'village/hire-mercenary.ts',
]);

// These routes mutate through a versioned shared settlement helper rather than
// importing the low-level bumper themselves. Their authenticated response is
// still responsible for echoing the helper's exact committed version.
const INDIRECT_VERSION_MUTATION_ROUTES = new Set([
    'towers/settle.ts',
    // These commits now use the existing exact-CAS versioned writer so a lost
    // acknowledgement cannot roll back an already-paid checkpoint or death.
    'hollow-gate/combat-settle.ts',
    'hollow-gate/event.ts',
    'hollow-gate/settle.ts',
    'hollow-gate/use-consumable.ts',
    'missions/report-raid.ts',
    // Ranked/base settlement moved behind writeVersionedPlayerSave, so this route
    // no longer names a BUMP_MARKER itself. It still bumps — that helper builds a
    // versionedPlayerRecord and commits it with compareSet — and it still rereads
    // and echoes the authenticated caller's final `_saveVersion`.
    'pvp/claim-rewards.ts',
    // Mentor milestone payouts moved into clan/_mentor-settlement.ts, which
    // credits each save through mutatePlayerSave (exact-CAS versioned writer).
    // The route still echoes the sensei's committed `_saveVersion` together
    // with the character from that same record.
    'clan/mentor.ts',
    // The Honor Seal debit moved into _war-mercenary-hire.ts, so this route no
    // longer names a BUMP_MARKER either. It still bumps through that saga and
    // still echoes the hiring player's `_saveVersion`.
    'village/hire-mercenary.ts',
    // Retry-safe save->shared settlements (issue #179, _save-debit-saga.ts):
    // the debit commits through mutatePlayerSave inside the saga, and each route
    // echoes that committed `_saveVersion` (the current one on a replay). The
    // bounty claim credits through pvp/_bounty-claim.ts the same way (#180).
    'pvp/bounty.ts',
    'sector/shrine-offer.ts',
    'clan/treasury/donate.ts',
    'village/treasury/donate.ts',
    // Stake-style Honor Seal / ryo debits that joined the same saga in the
    // retry-safety audit's sibling pass.
    'village/hollow-gate-unlock.ts',
    'clan/war/declare.ts',
    'village/kage-challenge.ts',
    // The daily reward and its day stamp now commit together through
    // writeVersionedPlayerSave; the route still echoes that version.
    'village/claim-map-control.ts',
    // The no-treasury-share tax day commits through mutatePlayerSave (the
    // treasury-share day already ran through the debit saga), and the helper
    // still returns that `_saveVersion` for village/tax.ts to echo.
    '_war-tax-apply.ts',
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
    // Test-only Express journey setup. It positions two disposable fixture
    // accounts at once behind the full-admin gate and is registered only for
    // NODE_ENV=test + SHINOBIX_QA_MEMORY_KV=1. No player client consumes this
    // response, and one response cannot safely echo two players' versions.
    '_qa-sector-war.ts',
    // (pvp/_bounty-settle.ts used to be listed here. It now credits through
    // pvp/_bounty-claim.ts and mutatePlayerSave, names no BUMP_MARKER, and still
    // RETURNS the hunter's version to player/sleeper-kill.ts, which echoes it.)
    // (pvp/_vitals-settlement.ts used to be listed here: post-battle vitals +
    // hospital admission for a finished world PvP duel, written onto BOTH
    // fighters' saves, so it has no single participant whose `_saveVersion` it
    // could echo. It now commits each fighter through mutatePlayerSave and names
    // no BUMP_MARKER. Exactly-once is still the per-fighter receipt in the save,
    // and pvp/claim-rewards.ts still re-reads the save after it runs and echoes
    // the resulting version to whoever asked.)
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
    // (admin/bloodline-review.ts used to be listed here. It now commits through
    // mutatePlayerSave and is gated with the other admin routes in
    // ADMIN_TARGET_MUTATION_ROUTES below.)
    'cron/_ranked-season.ts',
    // cron/_clan-boss-weekly.ts (many members' saves, from a timer), _subscription.ts
    // (billing callbacks and admin comps), missions/_progress.ts, clan-boss/_profession.ts
    // (multi-member), _clan-points.ts and _era.ts used to be listed here. They now commit
    // through mutatePlayerSave and no longer name a BUMP_MARKER; they still bump, and
    // still have no single response of the affected player's to echo into.
    'clan/seal-pool/distribute.ts',
    // (player/trade.ts used to be listed here: it bumps the recipient's save as
    // well as the sender's. It now settles both through mutatePlayerSaves, names
    // no BUMP_MARKER, and returns only the SENDER's committed `_saveVersion`, the
    // one save the requesting tab owns. The "every mutatePlayerSave route
    // acknowledges the committed version" test below now gates it.)
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
    // (village/_kage-inactivity.ts used to be listed here. Its stake-refund drain
    // now commits through mutatePlayerSave and names no BUMP_MARKER. It still has
    // no HTTP response to echo into: the challenger's next load adopts the bumped
    // `_saveVersion`, and an offline notice tells them.)
    // (towers/_entry-recovery.ts, towers/_tower-store.ts and towers/_records.ts
    // used to be listed here. They now commit through mutatePlayerSave and name
    // no BUMP_MARKER. The reasons they never echo still hold: the crash-recovery
    // refund can credit the host on another member's request, and the member
    // settlements and records write every squad member's save. towers/settle
    // still re-reads and echoes only the caller's committed character and
    // `_saveVersion` once every member has settled.)
    // Many actions on one route, most of them world/village rows rather than
    // saves. Its one save-versioning action — the village-war declaration's
    // Honor Seal debit, live only when the war map is disabled — echoes the
    // declaring Kage's committed `_saveVersion` (_world-war-declaration.test.ts).
    'world-state.ts',
    // (legacy/_acceptance.ts, the shared acceptance writer, used to be listed here.
    // It now commits through mutatePlayerSave, and sage.ts and stats.ts still return
    // its exact record stamp to the requesting player.)
    '_elapsed-state.ts',
]);

/**
 * Admin routes that mutate ANOTHER player's save through mutatePlayerSave. They
 * must never echo that version: authFetch adopts any `_saveVersion` in a
 * response for the signed-in account, so the admin's own client would take the
 * target player's version as its base and 409 its next autosave. The target
 * adopts the bump from their own next load.
 */
const ADMIN_TARGET_MUTATION_ROUTES = new Set([
    'admin/bloodline-review.ts',
    'admin/economy-reconcile.ts',
    'admin/legacy.ts',
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
        if (ADMIN_TARGET_MUTATION_ROUTES.has(rel)) continue;
        const src = readFileSync(join(API_DIR, rel), 'utf8');
        assert.match(
            src,
            /_saveVersion/,
            `${rel} uses mutatePlayerSave but never returns its exact _saveVersion`,
        );
    }
});

test('admin routes never hand the admin a target player\'s save version', () => {
    for (const rel of ADMIN_TARGET_MUTATION_ROUTES) {
        assert.ok(helperMutationRoutes.includes(rel), `${rel} no longer mutates through mutatePlayerSave — update ADMIN_TARGET_MUTATION_ROUTES`);
        const src = readFileSync(join(API_DIR, rel), 'utf8');
        assert.doesNotMatch(src, /_saveVersion/, `${rel} must not echo another player's _saveVersion to the admin`);
    }
});
