import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

// Execute the actual component's hooks and movement closure with a minimal
// host. JSX rendering and React scheduling are deliberately outside this unit
// harness; browser tests remain responsible for the real DOM integration.
const source = readFileSync(new URL('./SectorWanderer.tsx', import.meta.url), 'utf8');
const start = source.indexOf('const GRID_W =');
const end = source.lastIndexOf('    return (\n');
assert.ok(start >= 0 && end > start, 'component fixture boundaries must exist');
const executable = stripTypeScriptTypes(source.slice(start, end).replace('export function SectorWanderer', 'function SectorWanderer') + '\n}\nSectorWanderer;', { mode: 'strip' });

function mount({ reduced = false, width = 0, height = width, near = false, routine = false, native = false, unconsumedMs = 0 } = {}) {
    let now = 100, reads = 0, nextId = 0, refIndex = 0;
    let rect = { width, height };
    const queue = new Map<number, (at: number) => void>();
    const layouts: (() => unknown)[] = [], effects: (() => unknown)[] = [], cleanups: (() => void)[] = [];
    const motion: { elapsedMs: number; speed: number; position: { col: number; row: number } }[] = [];
    let engagements = 0, greetings = 0, disconnected = false;
    let observer: (() => void) | undefined;
    const classes = new Set<string>();
    const style: Record<string, unknown> = { setProperty() {} };
    const figure = { style, dataset: {} as Record<string, string>, title: '', setAttribute() {},
        classList: { toggle(name: string, on: boolean) { on ? classes.add(name) : classes.delete(name); } } };
    const grid = { getBoundingClientRect() { reads++; return rect; } };
    const schedule = (fn: (at: number) => void) => { const id = ++nextId; queue.set(id, fn); return id; };
    const life = routine ? { id: 'resident', name: 'Resident', restTile: 64, activity: 'rest' } : undefined;
    const context = {
        useRef(value: unknown) {
            const index = refIndex++;
            return { current: index === 0 ? { parentElement: grid } : index === 1 ? figure : index === 2 ? { style } : value };
        },
        useCallback: (fn: unknown) => fn,
        useContext: () => ({ current: { sector: native ? 6 : 24, col: near ? 4 : 1, row: 5 } }),
        useLayoutEffect: (fn: () => unknown) => layouts.push(fn),
        useEffect: (fn: () => unknown) => effects.push(fn),
        useState: (initial: unknown) => [initial, () => { greetings++; }],
        WorldPlayerPosition: {}, safeSectorTile: (_sector: number, tile: number) => tile,
        isWalkableTile: () => true, sectorObstaclesOn: () => true,
        useSectorServiceRoutine: () => undefined,
        lifeActorPosition: () => ({ col: 4, row: 5 }), loiterPositionAt: () => ({ col: 4, row: 5, facing: 1 }),
        serverNow: () => now, useSectorModelPins: () => ({ portraitModels: new Map() }),
        useSectorModelArtBase: () => undefined, usePlayerGaits: () => true, wandererAvatar: () => 'actor.webp',
        SECTOR_MARKER_ANCHOR: 80, SECTOR_RING_AI: 'ring',
        sectorMarkerBox: (tile: number) => ({ w: tile * 0.58, h: tile }),
        publishFigureGroundPosition() {}, layoutWandererLabels() {}, paintGroundWorkTool() {},
        groundWorkPresentation: (_life: unknown, presentation: unknown) => presentation,
        lifeActivityAtPosition: () => ({ activity: 'rest' }), lifeActivityAt: () => ({ activity: 'rest' }),
        sectorTrackerAway: () => false, isCoveredByCombat: () => false, subscribeCombatCover: () => () => {},
        sectorGaitTilesPerSecond: { walk: 1, run: 2 }, createSectorNavigator: () => () => {},
        advanceAuthoredGroundMotion(args: { elapsedMs: number; speed: number; position: { col: number; row: number } }) {
            motion.push(args); return { position: { col: args.position.col + (args.elapsedMs > 0 ? 0.01 : 0), row: args.position.row },
                unconsumedMs, facingDelta: 0, remainingDistance: 0.5 };
        },
        ResizeObserver: class { constructor(fn: () => void) { observer = fn; } observe() {} disconnect() { disconnected = true; } },
        getComputedStyle: () => ({ paddingLeft: '8px', paddingTop: '8px', columnGap: '1px', rowGap: '1px' }),
        performance: { now: () => now }, requestAnimationFrame: schedule,
        cancelAnimationFrame: (id: number) => queue.delete(id),
        document: { hidden: false, addEventListener() {}, removeEventListener() {} },
        window: { matchMedia: () => ({ matches: reduced }), setTimeout: schedule, clearTimeout: (id: number) => queue.delete(id) },
    };
    const Component = runInNewContext(executable, context);
    Component({ wanderer: { id: `bandit-${native ? 6 : 24}`, name: 'Road shinobi', homeTile: 64,
        waypoints: [64], movement: 'pursue', verb: native ? 'angler' : 'attack', avatarKey: 'bandit' },
        sector: native ? 6 : 24, playerIndex: near ? 64 : 61, biome: 'forest', routine: life,
        onEngage: () => { engagements++; return true; } });
    for (const effect of [...layouts, ...effects]) { const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => void); }
    return {
        figure, motion, classes,
        get reads() { return reads; }, get engagements() { return engagements; }, get greetings() { return greetings; },
        get queued() { return queue.size; }, get disconnected() { return disconnected; },
        resize(w: number, h = w, notify = true) { rect = { width: w, height: h }; if (notify) observer!(); },
        tick(at: number) { now = at; const entry = queue.entries().next().value; assert.ok(entry, 'ordinary scheduler must continue'); queue.delete(entry[0]); entry[1](at); },
        dispose() { for (const cleanup of cleanups.reverse()) cleanup(); },
    };
}

for (const native of [false, true]) {
    for (const reduced of [false, true]) {
        test(`geometry loss clears routine debt (${native ? 'native' : 'ordinary'}, ${reduced ? 'reduced' : 'animated'})`, () => {
            const host = mount({ routine: true, native, reduced, unconsumedMs: 450 });
            host.resize(637); // Deliver the owner's normal ResizeObserver notification.
            host.tick(1000);
            host.tick(reduced ? 1200 : 1016);
            assert.equal(host.motion[1].elapsedMs, 450 + (reduced ? 200 : 16),
                'fixture must carry nonzero routine debt before losing geometry');
            host.resize(0);
            const count = host.motion.length;
            host.tick(5000);
            assert.equal(host.motion.length, count, 'invalid geometry must not advance the routine');
            host.resize(637); // Recovery uses the existing observer, not a fallback.
            host.tick(15000);
            assert.equal(host.motion.at(-1)!.elapsedMs, 0,
                'recovery must discard prior routine debt as well as the stale timestamp');
            assert.match(String(host.figure.style.transform), /^translate\(/);
            host.dispose();
            assert.equal(host.disconnected, true);
            assert.equal(host.queued, 0);
        });
    }
    test(`geometry loss stops the walking presentation (${native ? 'native' : 'ordinary'})`, () => {
        const host = mount({ routine: true, native });
        host.resize(637);
        host.tick(1000); host.tick(1016);
        assert.equal(host.classes.has('is-walking'), true, 'fixture must first be visibly walking');
        host.resize(0); host.tick(5000);
        assert.equal(host.classes.has('is-walking'), false, 'a paused routine must not keep its walking presentation');
        host.resize(637); host.tick(6000); host.tick(6016);
        assert.equal(host.classes.has('is-walking'), true, 'normal presentation resumes after valid geometry');
        host.dispose();
    });
}

for (const reduced of [false, true]) {
    test(`initial readiness guard and first-valid arming stay intact (${reduced ? 'reduced' : 'animated'})`, () => {
        const host = mount({ near: true, reduced });
        host.tick(3000); host.tick(5000);
        assert.equal(host.motion.length, 0);
        assert.equal(host.engagements, 0);
        host.resize(637); host.tick(6000);
        assert.equal(host.engagements, 0, 'first valid geometry must not skip the owner arm delay');
        host.tick(8199);
        assert.equal(host.engagements, 0);
        host.tick(8200);
        assert.equal(host.engagements, 1, 'the existing 2200 ms first-valid arm delay is preserved');
        host.dispose();
    });
}
