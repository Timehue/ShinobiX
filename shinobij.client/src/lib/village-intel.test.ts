import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    __resetVillageIntelCache,
    cleanVillageIntel,
    clearVillageIntel,
    hydrateVillageIntel,
    intelExpiryLabel,
    intelPlateViewFor,
    loadVillageIntel,
    maybeRefreshVillageIntel,
    refreshIntelForSelectedSector,
    requestVillageIntelRefresh,
    revealedIntelForSector,
    sectorIntelPlateForViewer,
    villageIntelRevision,
    VILLAGE_INTEL_API,
} from './village-intel';
import { subscribeSharedWorldStateLateChanges } from './world-state';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const INTEL = {
    village: 'Moonshadow Village',
    thresholds: { scouted: 100, mapped: 250, infiltrated: 500 },
    revealed: [
        {
            sector: 12, points: 140, tier: 'scouted', expiresAt: NOW + 2 * DAY + 5 * HOUR, owner: 'Stormveil Village',
            revealed: { garrison: 'open', poolUsage: { explores: 120, chests: 3 }, structures: { ramparts: 2, watchtower: 1, barracks: 0, warAcademy: 0, supplyDepot: 4, treasuryVault: 0 } },
        },
        {
            sector: 20, points: 600, tier: 'infiltrated', expiresAt: NOW + 5 * HOUR, owner: null,
            revealed: { garrison: 'none', poolUsage: { explores: 0, chests: 0 }, structures: null },
        },
    ],
    scoutedBy: { '33': [{ village: 'Frostfang Village', tier: 'mapped', points: 300 }], '0': [{ village: 'x', tier: 'scouted', points: 100 }] },
};
const CAPS = { explores: 500, chests: 75 };

beforeEach(() => __resetVillageIntelCache());

test('cleanVillageIntel keeps well-formed rows, fills missing tiers from points, drops junk', () => {
    const v = cleanVillageIntel(INTEL);
    assert.ok(v);
    assert.equal(v.village, 'Moonshadow Village');
    assert.equal(v.revealed.length, 2);
    assert.equal(v.revealed[0].revealed.garrison, 'open');
    assert.equal(v.revealed[0].revealed.structures?.supplyDepot, 4);
    assert.equal(v.revealed[1].revealed.structures, null);
    assert.deepEqual(Object.keys(v.scoutedBy), ['33']);
    const inferred = cleanVillageIntel({ village: 'V', revealed: [{ sector: 3, points: 260, revealed: { garrison: 'weird' } }] });
    assert.equal(inferred?.revealed[0].tier, 'mapped');
    assert.equal(inferred?.revealed[0].revealed.garrison, 'none');
    assert.equal(cleanVillageIntel(null), null);
    assert.equal(cleanVillageIntel({ revealed: [] }), null);
});

test('hydrateVillageIntel caches the block, reports change, and clears on an anonymous poll', () => {
    assert.equal(hydrateVillageIntel({ villageIntel: INTEL }), true);
    assert.equal(hydrateVillageIntel({ villageIntel: INTEL }), false);
    assert.equal(loadVillageIntel()?.village, 'Moonshadow Village');
    assert.equal(revealedIntelForSector(12)?.tier, 'scouted');
    assert.equal(revealedIntelForSector(99), null);
    assert.equal(hydrateVillageIntel({}), true);
    assert.equal(loadVillageIntel(), null);
    assert.equal(hydrateVillageIntel(null), false);
});

test('intelPlateViewFor: scouted sector shows the reveal block; unscouted shows none', () => {
    hydrateVillageIntel({ villageIntel: INTEL });
    const scouted = intelPlateViewFor(12, 'Moonshadow Village', 'Stormveil Village', CAPS, undefined, NOW);
    assert.ok(scouted);
    assert.equal(scouted.loading, false);
    assert.equal(scouted.tierLabel, 'Scouted · 140 pts');
    assert.equal(scouted.reveal?.garrison, 'open');
    assert.equal(scouted.reveal?.poolLine, 'Explores 120 / 500 · Chests 3 / 75');
    assert.equal(scouted.reveal?.structures?.find((s) => s.key === 'supplyDepot')?.level, 4);
    assert.deepEqual(scouted.scoutedByLines, []);
    assert.deepEqual(scouted.unscoutedNotes, []);

    const infiltrated = intelPlateViewFor(20, 'Moonshadow Village', undefined, CAPS, undefined, NOW);
    assert.equal(infiltrated?.tierLabel, 'Infiltrated');
    assert.equal(infiltrated?.reveal?.structures, null);
    assert.equal(infiltrated?.reveal?.structuresLabel, null);

    const unscouted = intelPlateViewFor(5, 'Moonshadow Village', 'Stormveil Village', CAPS, undefined, NOW);
    assert.equal(unscouted?.tierLabel, 'Unscouted');
    assert.equal(unscouted?.reveal, null);
    assert.equal(unscouted?.expiryLabel, null);
});

test('intelPlateViewFor: the tier pill is a DIFFERENT colour per tier — the tier is the point of the card', () => {
    hydrateVillageIntel({ villageIntel: INTEL });
    assert.equal(intelPlateViewFor(5, 'Moonshadow Village', undefined, CAPS, undefined, NOW)?.tierPillClass, '');
    assert.equal(intelPlateViewFor(12, 'Moonshadow Village', undefined, CAPS, undefined, NOW)?.tierPillClass, 'is-traveling');
    assert.equal(intelPlateViewFor(20, 'Moonshadow Village', undefined, CAPS, undefined, NOW)?.tierPillClass, 'is-fighting');
    const mapped = cleanVillageIntel({ village: 'V', revealed: [{ sector: 3, points: 260, expiresAt: NOW + DAY, revealed: {} }] });
    assert.equal(intelPlateViewFor(3, 'V', undefined, CAPS, mapped, NOW)?.tierPillClass, 'is-fighting');
});

test('intelPlateViewFor: intel never silently goes cold — the plate says when it expires', () => {
    hydrateVillageIntel({ villageIntel: INTEL });
    assert.equal(intelPlateViewFor(12, 'Moonshadow Village', 'Stormveil Village', CAPS, undefined, NOW)?.expiryLabel, 'Intel goes cold in 2d');
    assert.equal(intelPlateViewFor(20, 'Moonshadow Village', undefined, CAPS, undefined, NOW)?.expiryLabel, 'Intel goes cold in 5h');

    assert.equal(intelExpiryLabel(NOW + 30 * 60_000, NOW), 'Intel goes cold in under an hour');
    assert.equal(intelExpiryLabel(NOW + 47 * HOUR, NOW), 'Intel goes cold in 1d');
    assert.equal(intelExpiryLabel(NOW, NOW), null, 'already cold');
    assert.equal(intelExpiryLabel(0, NOW), null, 'no expiry known');
});

test('intelPlateViewFor: structures list only what was RAISED, and says so when nothing was', () => {
    hydrateVillageIntel({ villageIntel: INTEL });
    // Six keys arrive; four sit at L0 and would otherwise render as a wall of
    // "Barracks L0, War Academy L0, …" that reads as a bug.
    const scouted = intelPlateViewFor(12, 'Moonshadow Village', 'Stormveil Village', CAPS, undefined, NOW);
    assert.deepEqual(scouted?.reveal?.structures?.map((s) => s.key), ['ramparts', 'watchtower', 'supplyDepot']);
    assert.equal(scouted?.reveal?.structuresLabel, 'Ramparts L2, Watchtower L1, Supply Depot L4');

    const bare = cleanVillageIntel({
        village: 'V',
        revealed: [{ sector: 3, points: 300, expiresAt: NOW + DAY, revealed: { structures: { ramparts: 0, watchtower: 0, barracks: 0, warAcademy: 0, supplyDepot: 0, treasuryVault: 0 } } }],
    });
    const plate = intelPlateViewFor(3, 'V', undefined, CAPS, bare, NOW);
    assert.deepEqual(plate?.reveal?.structures, []);
    assert.equal(plate?.reveal?.structuresLabel, 'No structures raised here.');
});

test('intelPlateViewFor: the garrison line keeps a sentence register and flags an open one as an alarm', () => {
    hydrateVillageIntel({ villageIntel: INTEL });
    const open = intelPlateViewFor(12, 'Moonshadow Village', 'Stormveil Village', CAPS, undefined, NOW);
    assert.equal(open?.reveal?.garrisonLabel, 'Open to assault');
    assert.equal(open?.reveal?.garrisonAlert, true);
    const quiet = intelPlateViewFor(20, 'Moonshadow Village', undefined, CAPS, undefined, NOW);
    assert.equal(quiet?.reveal?.garrisonLabel, 'No siege');
    assert.equal(quiet?.reveal?.garrisonAlert, false);
});

test('intelPlateViewFor: the unscouted explainer is two sentences built from the LIVE thresholds', () => {
    hydrateVillageIntel({ villageIntel: INTEL });
    const unscouted = intelPlateViewFor(5, 'Moonshadow Village', 'Stormveil Village', CAPS, undefined, NOW);
    assert.deepEqual(unscouted?.unscoutedNotes, [
        'No one from your village has scouted here. Explore and open chests to build intel.',
        '100 intel reveals the garrison and structures. 250 makes a sector-war declare cheaper.',
    ]);
    const shifted = cleanVillageIntel({ village: 'V', thresholds: { scouted: 1200, mapped: 3400, infiltrated: 9000 }, revealed: [] });
    assert.match(intelPlateViewFor(5, 'V', undefined, CAPS, shifted, NOW)?.unscoutedNotes[1] ?? '', /^1,200 intel reveals .* 3,400 makes /u);
});

test('intelPlateViewFor: scoutedBy lines only on sectors the viewer OWNS, and null for other villages / logged out', () => {
    hydrateVillageIntel({ villageIntel: INTEL });
    const owned = intelPlateViewFor(33, 'Moonshadow Village', 'Moonshadow Village', CAPS);
    assert.deepEqual(owned?.scoutedByLines, ['Frostfang Village has mapped this sector.']);
    const notOwned = intelPlateViewFor(33, 'Moonshadow Village', 'Stormveil Village', CAPS);
    assert.deepEqual(notOwned?.scoutedByLines, []);
    assert.equal(intelPlateViewFor(33, 'Frostfang Village', 'Frostfang Village', CAPS), null);
    assert.equal(intelPlateViewFor(33, undefined, 'Moonshadow Village', CAPS), null);
    __resetVillageIntelCache();
    assert.equal(intelPlateViewFor(33, 'Moonshadow Village', 'Moonshadow Village', CAPS), null);
});

test('intelPlateViewFor: an enemy scout report is a SENTENCE per tier, never a raw enum', () => {
    const spied = cleanVillageIntel({
        village: 'Moonshadow Village',
        revealed: [],
        scoutedBy: {
            '7': [
                { village: 'Frostfang', tier: 'infiltrated', points: 600 },
                { village: 'Sunscar', tier: 'mapped', points: 300 },
                { village: 'Ashenleaf', tier: 'scouted', points: 120 },
            ],
        },
    });
    assert.deepEqual(intelPlateViewFor(7, 'Moonshadow Village', 'Moonshadow Village', CAPS, spied, NOW)?.scoutedByLines, [
        'Frostfang has infiltrated this sector — they know your garrison and your structures.',
        'Sunscar has mapped this sector.',
        'Ashenleaf has scouted this sector.',
    ]);
});

// ── Poll: GET /api/village/intel (its own endpoint, NOT the world-state poll) ──
//
// The module reads the signed-in player through authFetch's storage-backed
// getSocketAuth(), so these tests shim the two Web Storage globals node lacks.

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
function memoryStorage(): Store {
    const map = new Map<string, string>();
    return {
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => { map.set(k, v); },
        removeItem: (k) => { map.delete(k); },
    };
}
const g = globalThis as unknown as Record<string, unknown>;
const PLAYER_KEY = 'shinobix:activePlayer';
let calls: string[] = [];
let realFetch: unknown;

function signIn(name: string | null) {
    const store = g.sessionStorage as Store;
    if (name) store.setItem(PLAYER_KEY, name); else store.removeItem(PLAYER_KEY);
}
/** Let the fire-and-forget fetch chain settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function installFetch(body: unknown, ok = true) {
    g.fetch = async (url: unknown) => {
        calls.push(String(url));
        return { ok, json: async () => body } as unknown as Response;
    };
}

beforeEach(() => {
    realFetch = g.fetch;
    g.sessionStorage = memoryStorage();
    g.localStorage = memoryStorage();
    calls = [];
    __resetVillageIntelCache();
});
afterEach(() => {
    g.fetch = realFetch;
    delete g.sessionStorage;
    delete g.localStorage;
});

test('poll: a logged-out viewer NEVER calls the endpoint', async () => {
    installFetch({ villageIntel: INTEL });
    signIn(null);
    maybeRefreshVillageIntel();
    requestVillageIntelRefresh();
    sectorIntelPlateForViewer(12, 'Moonshadow Village', 'Stormveil Village');
    await settle();
    assert.deepEqual(calls, []);
    assert.equal(loadVillageIntel(), null);
});

test('poll: a signed-in viewer fetches the endpoint once, caches it, and signals a late change', async () => {
    installFetch({ ok: true, enabled: true, villageIntel: INTEL });
    signIn('moonrunner');
    let signals = 0;
    const off = subscribeSharedWorldStateLateChanges(() => { signals += 1; });
    maybeRefreshVillageIntel();
    await settle();
    assert.deepEqual(calls, [VILLAGE_INTEL_API]);
    assert.equal(loadVillageIntel()?.village, 'Moonshadow Village');
    assert.equal(signals, 1);

    // Throttled: an immediate second nudge (background OR on-demand) is a no-op,
    // and an unchanged payload signals nothing even when it does go out.
    maybeRefreshVillageIntel();
    requestVillageIntelRefresh();
    await settle();
    assert.deepEqual(calls, [VILLAGE_INTEL_API]);
    assert.equal(signals, 1);
    off();
});

test('poll: the kill-switch / no-village response clears the cache', async () => {
    signIn('moonrunner');
    installFetch({ ok: true, enabled: true, villageIntel: INTEL });
    maybeRefreshVillageIntel();
    await settle();
    assert.equal(loadVillageIntel()?.village, 'Moonshadow Village');

    __resetVillageIntelCache();          // drop the throttle, keep the sign-in
    hydrateVillageIntel({ villageIntel: INTEL });
    installFetch({ ok: true, enabled: false, villageIntel: null });
    maybeRefreshVillageIntel();
    await settle();
    assert.equal(loadVillageIntel(), null);
});

test('poll: logout clears the cache, and an account switch refetches immediately', async () => {
    installFetch({ villageIntel: INTEL });
    signIn('moonrunner');
    maybeRefreshVillageIntel();
    await settle();
    assert.equal(loadVillageIntel()?.village, 'Moonshadow Village');

    // Logout: the next nudge wipes the previous viewer's reveals, no request.
    signIn(null);
    maybeRefreshVillageIntel();
    await settle();
    assert.equal(loadVillageIntel(), null);
    assert.equal(calls.length, 1);

    // Account switch bypasses the throttle so the new player never sees the old
    // village's intel.
    signIn('frostrunner');
    installFetch({ villageIntel: { ...INTEL, village: 'Frostfang Village' } });
    maybeRefreshVillageIntel();
    await settle();
    assert.equal(calls.length, 2);
    assert.equal(loadVillageIntel()?.village, 'Frostfang Village');
});

test('the plate projection is PURE — rendering it a hundred times issues no request', async () => {
    installFetch({ villageIntel: INTEL });
    signIn('moonrunner');
    // WorldMap calls this inline in JSX. When it kicked off its own refresh, one
    // render meant one storage-read + throttle check, and a landed response fed
    // the late-change bus, which re-rendered the App, which rendered this again:
    // the intel poll ran at the 10s on-demand floor rather than its 45s cadence.
    for (let i = 0; i < 100; i += 1) {
        assert.equal(sectorIntelPlateForViewer(12, 'Moonshadow Village', 'Stormveil Village'), null);
    }
    await settle();
    assert.deepEqual(calls, []);
});

test('the effect asks for the refresh — wild sector + signed-in viewer only', async () => {
    installFetch({ villageIntel: INTEL });
    signIn('moonrunner');
    // No village (still loading the character) and non-wild sectors are not
    // plates, so they must not spend the on-demand budget.
    assert.equal(refreshIntelForSelectedSector(12, undefined), false);
    assert.equal(refreshIntelForSelectedSector(null, 'Moonshadow Village'), false);
    assert.equal(refreshIntelForSelectedSector(0, 'Moonshadow Village'), false);
    await settle();
    assert.deepEqual(calls, []);

    // Opening the map on a sector asks once…
    assert.equal(refreshIntelForSelectedSector(12, 'Moonshadow Village'), true);
    await settle();
    assert.deepEqual(calls, [VILLAGE_INTEL_API]);
    // …and picking another sector inside the ON_DEMAND_MIN_MS floor reuses the
    // answer instead of re-asking.
    refreshIntelForSelectedSector(20, 'Moonshadow Village');
    await settle();
    assert.deepEqual(calls, [VILLAGE_INTEL_API]);
    assert.equal(sectorIntelPlateForViewer(12, 'Moonshadow Village', 'Stormveil Village')?.tier, 'scouted');
    assert.equal(sectorIntelPlateForViewer(12, 'Moonshadow Village', 'Stormveil Village')?.loading, false);
});

test('the loading shell and the landed cache both bump the revision the plate memo watches', async () => {
    installFetch({ villageIntel: INTEL });
    signIn('moonrunner');
    const cold = villageIntelRevision();
    // The first request turns the plate into the LOADING shell rather than null —
    // returning null would pop the whole card into the panel a second later and
    // shift everything under it — so the memo has to recompute for it too.
    refreshIntelForSelectedSector(12, 'Moonshadow Village');
    const pending = sectorIntelPlateForViewer(12, 'Moonshadow Village', 'Stormveil Village');
    assert.equal(pending?.loading, true);
    assert.equal(pending?.reveal, null);
    assert.ok(villageIntelRevision() > cold, 'the shell is a visible change');
    const shell = villageIntelRevision();
    await settle();
    assert.ok(villageIntelRevision() > shell, 'so is the landed intel');

    assert.equal(clearVillageIntel(), true);
    assert.equal(loadVillageIntel(), null);
    assert.equal(clearVillageIntel(), false);
});

test('poll: a SETTLED empty cache renders nothing — the shell is for pending, not for "no intel"', async () => {
    signIn('moonrunner');
    // Kill switch off / no village: the server answered, so the card must not
    // sit on "Gathering intel…" for the rest of the session.
    installFetch({ ok: true, enabled: false, villageIntel: null });
    maybeRefreshVillageIntel();
    await settle();
    assert.equal(sectorIntelPlateForViewer(12, 'Moonshadow Village', 'Stormveil Village'), null);

    // A logged-out viewer never issues the request, so it never shows the shell.
    __resetVillageIntelCache();
    signIn(null);
    assert.equal(sectorIntelPlateForViewer(12, 'Moonshadow Village', 'Stormveil Village'), null);
});
