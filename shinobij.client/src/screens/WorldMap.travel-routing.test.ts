import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createSectorActionGuard, createTravelPresentationScope } from '../lib/travel-presentation';
import { exploreAmbushDialogState, exploreAmbushFightRequest } from '../lib/road-flee-api';

const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const source = readFileSync(new URL('./WorldMap.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('WorldMap.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['beginSectorTravel', 'travelToSector', 'triggerTravelPoint', 'runWhenSectorConfirmed',
    'advanceHuntTrail', 'presentExploreAmbush', 'focusDiscoverySector', 'triggerCreatorEvent', 'startPvpRaid', 'focusSectorCombat',
    'launchAiGuardRaid', 'launchWorldMapFight', 'startExploreAmbushFight', 'launchCreatorEventFight', 'huntSector', 'resolveHuntChoice']);
const functions: string[] = [];
let navigation = '';
function collect(node: import('typescript').Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) functions.push(node.getText(ast));
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
        const callback = node.arguments[0];
        if (callback && ts.isArrowFunction(callback) && callback.getText(ast).includes('takeSectorTravelIntent')) {
            navigation = `function enterWorldMap() ${callback.body.getText(ast)}`;
        }
    }
    ts.forEachChild(node, collect);
}
collect(ast);
assert.equal(functions.length, names.size);
assert.ok(navigation, 'the mounted map must consume explicit travel destinations');
const code = ts.transpileModule([...functions, navigation].join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
}).outputText;

// Execute the production handlers with a controlled server and arrival clock.
// No duplicate travel implementation or full game bootstrap is needed.
function harness(options: { sector?: number; tile?: number; ok?: boolean; travelMs?: number; arrivalTile?: number;
    destination?: number; reopen?: number; field?: boolean; raidReply?: Promise<unknown>; huntReply?: Promise<unknown> } = {}) {
    let arrival: (() => void) | undefined;
    let destination = options.destination ?? null;
    let reopen = options.reopen ?? null;
    const requests: number[] = [];
    const actions: (() => void)[] = [];
    const fights: unknown[] = [];
    const raidRequests: unknown[] = [];
    const scope = createTravelPresentationScope({
        set(callback) { arrival = callback; return 1 as unknown as ReturnType<typeof setTimeout>; },
        clear() { arrival = undefined; },
    });
    const state = createContext({
        currentSector: options.sector ?? 12, selectedSector: options.sector ?? 12,
        combatActive: false, isCombatActive: () => state.combatActive,
        wandererDialog: null as unknown, wandererChoiceRef: { current: null as unknown },
        requiresWandererChoice: (dialog: { msg?: unknown; w?: { verb?: string } } | null) => !!dialog && !dialog.msg && dialog.w?.verb === 'attack',
        sectorPlayerPos: options.tile ?? 43, isTraveling: false, travelingUntil: 0,
        liveWorldPosition: { current: { sector: options.sector ?? 12, tile: options.tile ?? 43, traveling: false } },
        getWorldPosition: () => state.liveWorldPosition.current,
        captureSectorAction: (sector: number) => createSectorActionGuard(state.travelPresentation.current,
            () => state.liveWorldPosition.current, () => state.travelRequestInFlight.current, sector),
        character: { name: 'Rill', level: 30 },
        travelRequestInFlight: { current: false }, travelPresentation: { current: scope },
        pending: null as unknown, toast: null as unknown, event: null as unknown, dialog: null as unknown,
        biome: '', weather: '', screens: [] as string[],
        fetch: async (_url: string, init: { body: string }) => {
            requests.push(JSON.parse(init.body).destinationSector);
            return { ok: options.ok !== false, json: async () => ({ arrivalAt: Date.now() + 3000,
                travelMs: options.travelMs ?? 3000, arrivalTile: options.arrivalTile ?? 17, error: 'Road blocked' }) };
        },
        AbortSignal, Date, Number, queueMicrotask,
        prefetchTravelDestination() {}, confirmRoadPosition: async () => true,
        sameSector: (a: number, b: number) => a === b,
        travelMaskMs: (ms: number) => ms,
        biomeForSector: (sector: number) => `biome-${sector}`,
        weatherForSector: (sector: number) => `weather-${sector}`,
        weatherForBiome: (biome: string) => `weather-${biome}`,
        travelArrivalTile: () => 25, SECTOR_CENTRE_TILE: 78,
        regionSplashLabelFor: () => null, setRegionSplash() {},
        roadExitsForSector: () => [], requestContinuousWorldWalk: () => false, FESTIVAL_SECTOR: 54,
        setCurrentSector(sector: number) { state.currentSector = sector; },
        setSelectedSector(sector: number | null) { state.selectedSector = sector; },
        setSectorPlayerPos(tile: number) { state.sectorPlayerPos = tile; },
        setCurrentBiome(biome: string) { state.biome = biome; },
        setCurrentWeather(weather: string) { state.weather = weather; },
        setPendingTravel(pending: unknown) { state.pending = pending; },
        setTravelingUntil(until: number) { state.travelingUntil = until; },
        setTravelToast(toast: unknown) { state.toast = toast; },
        setRouteHoverSector() {}, setSelectedVillageTerritory() {},
        setScreen(screen: string) { state.screens.push(screen); },
        window: { setTimeout(callback: () => void) { actions.push(callback); } },
        takeSectorReopen: () => { const next = reopen; reopen = null; return next; }, consumeReloadIntoSector: () => false,
        setSectorReopen(sector: number | null) { reopen = sector; },
        takeSectorTravelIntent: () => { const next = destination; destination = null; return next; },
        takeFieldMissionNavigationIntent: () => options.field ? { missionId: 'fetch', targetSector: 57, objective: 'explore' } : null,
        acceptedMissionIds: ['fetch'], builtinFetchMissions: [{ id: 'fetch', targetSector: 57 }], missionProgress: {},
        nextFieldMissionObjective: () => 'explore', missionRaidProgressKey: () => 'raid',
        playableFieldObjectiveSector: (sector: number) => sector === 54 ? 52 : sector,
        isWildSector: (sector: number) => sector > 0 && sector <= 99,
        setMissionProgress() {}, huntTrailSector: () => 57, playerSlug: () => 'rill',
        huntReadyForFight: () => false, sectorRegionName: () => 'Hollow Temple', setHuntToast() {},
        exploreAmbushDialogState, exploreAmbushFightRequest,
        setWandererDialog(dialog: unknown) { state.wandererDialog = typeof dialog === 'function' ? dialog(state.wandererDialog) : dialog; state.dialog = state.wandererDialog; },
        alert() {}, gameToast() {}, setCreatorEventPage() {}, setCreatorEventLine() {},
        setSelectedCreatorEvent(event: unknown) { state.event = event; },
        capabilityAdmissionAllowed: () => true, mutationAvailability() {},
        aiRaidLaunchInFlight: { current: false }, raidStartCooldownMs: 0,
        mintAiRaidToken: async (request: unknown) => {
            raidRequests.push(request);
            return options.raidReply ?? { ok: true, sector: options.sector ?? 12, opponentId: 'guard', token: 'sealed-raid' };
        },
        requestAiFight(request: unknown) { fights.push(request); return true; },
        aiRaidLaunchFailureMessage: () => 'Raid unavailable',
        creatorEventPracticeOpponent: () => ({ id: 'practice-bandit' }),
        huntTrailForSector: () => ({ mission: { id: 'hunt', aiProfileId: 'beast' } }),
        playableAis: [{ id: 'beast', name: 'Beast' }],
        postWorldHunt: async () => options.huntReply ?? { ok: true, state: { sector: options.sector ?? 12, claimable: true } },
        onVersionedCharacter: () => true, onServerVersion: () => true,
        setAcceptedMissionIds() {}, adoptHuntProgressMirror() {}, setAuthoritativeHuntStates() {},
        setHuntEncounter(encounter: unknown) { state.huntEncounter = encounter; },
    });
    runInContext(code, state);
    return { state, requests, actions, fights, raidRequests,
        call(name: string, ...args: unknown[]) { return state[name](...args); },
        async respond() { await new Promise<void>(resolve => setImmediate(resolve)); },
        arrive(flush = true) {
            arrival?.();
            state.liveWorldPosition.current = { sector: state.currentSector, tile: state.sectorPlayerPos, traveling: state.travelingUntil > 0 };
            if (flush) actions.splice(0).forEach(action => action());
        },
        flushActions() { actions.splice(0).forEach(action => action()); },
        dispose() { scope.dispose(); },
    };
}

test('a remote sector opens with its avatar on the sealed tile only after arrival', async () => {
    const h = harness();
    h.call('triggerTravelPoint', 57);
    await h.respond();
    assert.deepEqual(h.requests, [57]);
    assert.equal(h.state.currentSector, 12);
    assert.equal(h.state.selectedSector, null);
    assert.equal(h.state.sectorPlayerPos, 43);
    h.arrive();
    assert.equal(h.state.currentSector, 57);
    assert.equal(h.state.selectedSector, 57);
    assert.equal(h.state.sectorPlayerPos, 17);
    assert.equal(h.state.biome, 'biome-57');
    assert.equal(h.state.pending, null);
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

for (const interruption of ['leave', 'move', 'travel'] as const) {
    test(`a queued event action is retired when the player begins to ${interruption} after arrival`, async () => {
        const h = harness();
        h.call('triggerCreatorEvent', { targetSector: 57, levelReq: 20, eventKind: 'visualNovel' });
        await h.respond(); h.arrive(false);
        assert.equal(h.state.event, null);
        if (interruption === 'leave') h.dispose();
        if (interruption === 'move') h.state.liveWorldPosition.current.sector = 31;
        if (interruption === 'travel') h.state.travelRequestInFlight.current = true;
        h.flushActions();
        assert.equal(h.state.event, null);
    });

    test(`a delayed AI raid proof cannot open combat after ${interruption}`, async () => {
        const reply = deferred<unknown>();
        const h = harness({ raidReply: reply.promise });
        const launch = h.call('launchAiGuardRaid', 'guard', 20, 12);
        assert.equal(h.raidRequests.length, 1);
        assert.equal(h.state.aiRaidLaunchInFlight.current, true);
        if (interruption === 'leave') {
            h.dispose();
            // A replacement account/map scope must not revive the old proof.
            h.state.travelPresentation.current = createTravelPresentationScope();
        }
        if (interruption === 'move') h.state.liveWorldPosition.current.sector = 31;
        if (interruption === 'travel') h.state.travelRequestInFlight.current = true;
        reply.resolve({ ok: true, sector: 12, opponentId: 'guard', token: 'sealed-raid' });
        await launch;
        assert.deepEqual(h.fights, []);
        assert.equal(h.state.aiRaidLaunchInFlight.current, false);
    });
}

test('all field AI entry points refuse a stale rendered sector or active travel', async () => {
    const h = harness();
    for (const traveling of [false, true]) {
        h.state.liveWorldPosition.current = { sector: traveling ? 12 : 31, tile: 43, traveling };
        h.call('launchWorldMapFight', { name: 'Beast', level: 20 }, 12, { sourceId: 'beast' });
        assert.equal(h.call('startExploreAmbushFight', 12, 'receipt'), false);
        h.call('launchCreatorEventFight', { targetSector: 12, biome: 'forest', levelReq: 20 });
        await h.call('launchAiGuardRaid', 'guard', 20, 12);
    }
    assert.deepEqual(h.fights, []);
    assert.deepEqual(h.raidRequests, []);
});

test('current field fights retain the confirmed sector and explicit map return', async () => {
    const h = harness();
    h.call('launchWorldMapFight', { name: 'Beast', level: 20 }, 12, { sourceId: 'beast' });
    assert.equal(h.call('startExploreAmbushFight', 12, 'receipt'), true);
    h.call('launchCreatorEventFight', { targetSector: 12, biome: 'forest', levelReq: 20 });
    await h.call('launchAiGuardRaid', 'guard', 20, 12);
    assert.deepEqual(h.fights.map((request) => {
        const fight = request as { sector: number; returnScreen: string; battleKind: string };
        return [fight.sector, fight.returnScreen, fight.battleKind];
    }), [[12, 'worldMap', 'world'], [12, 'worldMap', 'explore'], [12, 'worldMap', 'practice'], [12, 'worldMap', 'raidAi']]);
});

test('event combat uses the same playable destination as its arrival', () => {
    const h = harness({ sector: 52 });
    h.call('launchCreatorEventFight', { targetSector: 54, biome: 'desert', levelReq: 20 });
    assert.equal((h.fights[0] as { sector: number }).sector, 52);
});

test('late hunt state and choice replies cannot reopen encounters or send the player to another trail', async () => {
    for (const action of ['huntSector', 'resolveHuntChoice']) {
        for (const retire of [false, true]) {
            const reply = deferred<unknown>();
            const h = harness({ huntReply: reply.promise });
            const pending = action === 'huntSector' ? h.call(action, 12)
                : h.call(action, { sector: 12, trail: { mission: { id: 'hunt' }, progress: 0 }, ai: {} }, { id: 'track' });
            if (retire) {
                h.dispose();
                h.state.travelPresentation.current = createTravelPresentationScope();
            } else h.state.liveWorldPosition.current.sector = 31;
            reply.resolve({ ok: true, progress: 1, nextSector: 57,
                state: { sector: 12, progress: 1, requiredTracks: 3 } });
            await pending;
            assert.deepEqual(h.requests, []);
            assert.deepEqual(h.fights, []);
            assert.ok(h.state.huntEncounter == null);
        }
    }
});

test('current hunt state opens its encounter and a recorded choice arrives on the next trail', async () => {
    const state = harness({ huntReply: Promise.resolve({ ok: true,
        state: { sector: 12, progress: 0, requiredTracks: 3, sign: { id: 'sealed-sign' } } }) });
    await state.call('huntSector', 12);
    assert.equal(state.state.huntEncounter.sector, 12);
    assert.equal(state.state.huntEncounter.view.sign.id, 'sealed-sign');

    const choice = harness({ huntReply: Promise.resolve({ ok: true, progress: 1, nextSector: 57 }) });
    await choice.call('resolveHuntChoice', { sector: 12, trail: { mission: { id: 'hunt' }, progress: 0, requiredTracks: 3 },
        ai: { name: 'Beast' } }, { id: 'track' });
    await choice.respond();
    assert.deepEqual(choice.requests, [57]);
    assert.equal(choice.state.currentSector, 12);
    choice.arrive();
    assert.equal(choice.state.currentSector, 57);
    assert.equal(choice.state.selectedSector, 57);
    assert.equal(choice.state.sectorPlayerPos, 17);
});

test('a failed trip leaves the player on the original board and never runs its action', async () => {
    const h = harness({ ok: false });
    let actions = 0;
    h.call('runWhenSectorConfirmed', 57, () => actions++);
    await h.respond();
    h.arrive();
    assert.equal(h.state.currentSector, 12);
    assert.equal(h.state.selectedSector, 12);
    assert.equal(h.state.sectorPlayerPos, 43);
    assert.equal(actions, 0);
    assert.equal(h.state.travelRequestInFlight.current, false);
});

test('a second handoff cannot replace a trip while its arrival is pending', async () => {
    const h = harness();
    h.call('travelToSector', 57);
    await h.respond();
    h.call('travelToSector', 31);
    let earlyAction = false;
    h.call('runWhenSectorConfirmed', 12, () => { earlyAction = true; });
    await h.respond();
    assert.deepEqual(h.requests, [57]);
    assert.equal(earlyAction, false);
    h.arrive();
    assert.equal(h.state.currentSector, 57);
    assert.equal(h.state.travelRequestInFlight.current, false);
});

test('React effect replay consumes a navigation intent only in the surviving map scope', async () => {
    const h = harness({ destination: 57 });
    h.call('enterWorldMap');
    h.state.travelPresentation.current.dispose();
    let arrival: (() => void) | undefined;
    h.state.travelPresentation.current = createTravelPresentationScope({
        set(callback) { arrival = callback; return 2 as unknown as ReturnType<typeof setTimeout>; }, clear() {},
    });
    h.state.travelRequestInFlight.current = false;
    h.call('enterWorldMap');
    await h.respond();
    arrival?.();
    assert.deepEqual(h.requests, [57]);
    assert.equal(h.state.currentSector, 57);
    assert.equal(h.state.selectedSector, 57);
    assert.equal(h.state.sectorPlayerPos, 17);
});

test('reopening the current sector preserves the walked tile without another trip', async () => {
    const h = harness({ tile: 91, reopen: 12 });
    h.call('enterWorldMap');
    await h.respond();
    assert.deepEqual(h.requests, []);
    assert.equal(h.state.selectedSector, 12);
    assert.equal(h.state.sectorPlayerPos, 91);
});

for (const entry of [{ destination: 57, reopen: 12 }, { field: true, reopen: 12 }, { reopen: 57 }]) {
    test(`map navigation confirms remote entry ${JSON.stringify(entry)}`, async () => {
        const h = harness(entry);
        h.call('enterWorldMap');
        await h.respond();
        assert.deepEqual(h.requests, [57]);
        assert.equal(h.state.currentSector, 12);
        h.arrive();
        assert.equal(h.state.selectedSector, h.state.currentSector);
        assert.equal(h.state.currentSector, 57);
        assert.equal(h.state.sectorPlayerPos, 17);
    });
}

test('advancing a hunt installs the new lead arrival tile', async () => {
    const h = harness({ arrivalTile: 119 });
    h.call('advanceHuntTrail', { mission: { id: 'hunt' }, requiredTracks: 3, progress: 0 }, { name: 'Beast' }, 12, 57);
    await h.respond();
    h.arrive();
    assert.deepEqual(h.requests, [57]);
    assert.equal(h.state.selectedSector, 57);
    assert.equal(h.state.sectorPlayerPos, 119);
});

test('an old discovery receipt cannot impersonate a world relocation', () => {
    const h = harness();
    h.call('focusDiscoverySector', 57);
    assert.equal(h.state.currentSector, 12);
    assert.equal(h.state.selectedSector, 12);
    assert.equal(h.state.sectorPlayerPos, 43);
});

test('delayed callbacks use the latest position instead of bypassing travel with an old sector', async () => {
    const h = harness();
    h.state.liveWorldPosition.current = { sector: 31, tile: 91, traveling: false };
    h.call('focusDiscoverySector', 12);
    h.call('travelToSector', 12);
    await h.respond();
    assert.deepEqual(h.requests, [12], 'the old render said 12, but the player has since left it');
    h.arrive();
    assert.equal(h.state.selectedSector, 12);
    assert.equal(h.state.sectorPlayerPos, 17);
});

test('a delayed combat handoff cannot move the player back to its old battlefield', async () => {
    const h = harness({ sector: 31 });
    await h.call('startPvpRaid', {}, 12, 'old-biome', 'old-weather');
    h.call('focusSectorCombat', 12, 'old-biome', 'old-weather');
    assert.equal(h.state.currentSector, 31);
    assert.equal(h.state.selectedSector, 31);
    assert.equal(h.state.sectorPlayerPos, 43);
});

test('recovering a remote ambush waits for real arrival before opening the encounter', async () => {
    const h = harness();
    h.call('presentExploreAmbush', 57, 'receipt');
    await h.respond();
    assert.equal(h.state.dialog, null);
    h.arrive();
    assert.equal(h.state.currentSector, 57);
    assert.equal(h.state.sectorPlayerPos, 17);
    assert.equal(h.state.dialog.ambush.requestId, 'receipt');
});

test('a delayed Explore arrival cannot replace another hostile choice or an active fight', async () => {
    for (const activeCombat of [false, true]) {
        const h = harness();
        h.call('presentExploreAmbush', 57, 'owed_receipt');
        await h.respond();
        const waiting = { w: { id: 'other-hostile', verb: 'attack', name: 'Kagero' } };
        h.state.wandererChoiceRef.current = activeCombat ? null : waiting;
        h.state.wandererDialog = waiting;
        h.state.dialog = waiting;
        h.state.combatActive = activeCombat;
        h.arrive();
        assert.equal(h.state.dialog, waiting);
        assert.deepEqual(h.fights, []);
    }
});

test('Explore presentation waits while a sealed fight already owns the screen', () => {
    const h = harness();
    h.state.combatActive = true;
    assert.equal(h.call('presentExploreAmbush', 57, 'owed_receipt'), false);
    assert.deepEqual(h.requests, []);
    assert.equal(h.state.dialog, null);
});

test('creator events check level before travel and open only on confirmed arrival', async () => {
    const h = harness();
    const event = { targetSector: 57, levelReq: 40, eventKind: 'visualNovel' };
    h.call('triggerCreatorEvent', event);
    assert.deepEqual(h.requests, []);
    event.levelReq = 20;
    h.call('triggerCreatorEvent', event);
    await h.respond();
    assert.equal(h.state.event, null);
    h.arrive();
    assert.equal(h.state.currentSector, 57);
    assert.equal(h.state.event.targetSector, 57);
});

test('leaving the map retires a late travel response and its encounter action', async () => {
    const h = harness();
    h.call('presentExploreAmbush', 57, 'receipt');
    h.dispose();
    await h.respond();
    h.arrive();
    assert.equal(h.state.currentSector, 12);
    assert.equal(h.state.selectedSector, 12);
    assert.equal(h.state.dialog, null);
});
