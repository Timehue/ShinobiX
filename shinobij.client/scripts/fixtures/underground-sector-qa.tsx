import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { HollowGateShrineView } from '../../src/features/hollowGate/HollowGateShrineView';
import { StrongholdExplore } from '../../src/features/anbuInfiltration/StrongholdExplore';
import { AnbuVaultRaid } from '../../src/features/anbuInfiltration/AnbuVaultRaid';
import { useHollowGateWalk } from '../../src/features/hollowGate/use-hollow-gate-walk';
import { generateHollowGateFloor } from '../../src/lib/hollow-gate-generate';
import { hollowRifts } from '../../src/data/hollow-rifts';
import { riftEventConfig } from '../../src/lib/rift-run';
import { hollowGateVariantDims, variantFromEventConfig } from '../../src/lib/hollow-gate-variant';
import { computeHollowGateVisible } from '../../src/lib/hollow-gate-visibility';
import { findHollowGatePath } from '../../src/lib/hollow-gate-path';
import { createHollowGateWanderers, advanceHollowGateWanderers } from '../../../shared/hollow-gate-wanderers';
import { hollowGateBoardManifest } from '../../src/lib/hollow-gate-recovery';
import { planUndergroundFloorFeatures } from '../../../shared/underground-floor-features';
import { undergroundFeatureBlocks, undergroundFeatureWalkable } from '../../../shared/underground-floor-collision';
import { resolveHollowGateTile, type HollowGateEventModal } from '../../src/lib/hollow-gate-tile';
import { hollowGateNpcCanTalk } from '../../src/lib/hollow-gate-wanderer-event';
import type { Character, HollowGateShrineRun } from '../../src/types/character';
import type { SectorWarContestView } from '../../src/lib/sector-war-engagement';
import { GameConfirmHost, gameConfirm } from '../../src/components/GameAlert';
import { SessionExpiredModal } from '../../src/components/SessionExpiredModal';
import { LiveCapabilitiesContext } from '../../src/lib/live-capabilities-context';
import { LiveCapabilitiesStore } from '../../src/lib/live-capabilities';
import { PUBLIC_CAPABILITY_IDS } from '../../../shared/public-capabilities';

const params = new URLSearchParams(location.search);
const questRift = hollowRifts.find(rift => rift.id === params.get('rift'));
const questVariant = questRift ? variantFromEventConfig(riftEventConfig(questRift)) : undefined;
// Reproduce saves with an assigned legacy atlas, which used to hide the new
// underground terrain. Keep a content icon assigned to check that it survives.
const sharedImages = params.has('legacyAtlas') ? {
    'shrine:tile-room-floor': '/assets/dungeon/0x72-dungeon-tileset-ii.png',
    'shrine:tile-corridor-floor': '/assets/dungeon/0x72-dungeon-tileset-ii.png',
    'shrine:tile-wall': '/assets/dungeon/0x72-dungeon-tileset-ii.png',
    'shrine:icon-exit': '/ui/icon-96/gate.webp',
} : {};
const targetVillage = params.get('targetVillage') ?? 'Frostfang Village';
const capabilities = Object.fromEntries(PUBLIC_CAPABILITY_IDS.map(id => [id, { state: 'available', reason: 'available' }]));
const capabilityStore = new LiveCapabilitiesStore(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, capabilities }) }));
if (params.has('raidHost')) void capabilityStore.refresh();
const character = { name: params.get('name') ?? 'scout', level: Number(params.get('level') ?? 100), village: params.get('village') ?? 'Moonshadow Village', avatarImage: '/anbu/frostfang.webp',
    hp: 10000, maxHp: 10000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
    stats: {}, equipment: {}, jutsu: [], inventory: [], itemStacks: [], jutsuMastery: [], pets: [], hollowShards: Number(params.get('shards') ?? 100), ryo: Number(params.get('ryo') ?? 0) } as unknown as Character;
const warKind = params.get('war') === 'card' ? 'card' : 'pet';
const contest: SectorWarContestView | null = params.has('war') ? {
    id: 'qa-contest', sector: 12, winCondition: warKind, attackerVillage: character.village, defenderVillage: 'Frostfang Village', endsAt: Date.now() + 60000, garrisonReady: true,
} : null;
function initialRun(requestedFloor?: number): HollowGateShrineRun {
    let seed = 91825;
    const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const floor = requestedFloor ?? Number(params.get('floor') ?? (questRift ? 1 : 2));
    const event = params.has('event');
    const run = generateHollowGateFloor(floor, floor === (questRift?.floors ?? (event ? 3 : 5)), questVariant ? hollowGateVariantDims(questVariant) : event ? { width: 19, height: 15 } : undefined, rng);
    run.keys = Number(params.get('keys') ?? run.keys);
    run.threat = Number(params.get('threat') ?? run.threat);
    run.completed = params.has('completed');
    if (params.has('risk')) run.entryCurrencies = { hollowShards: Math.max(0, (character.hollowShards ?? 0) - 20000), ryo: Math.max(0, character.ryo - 40000) };
    run.runToken = 'underground-qa';
    run.floorFeatures = planUndergroundFloorFeatures(run.tiles, run.width, true, false, run.playerY * run.width + run.playerX);
    run.floorFeaturesVersion = 1;
    if (params.has('npc')) {
        if (params.get('npc') !== 'keeper') { const board = hollowGateBoardManifest(run.tiles); run.wanderers = createHollowGateWanderers({ floor, width: run.width, height: run.height, spawn: { x: run.playerX, y: run.playerY }, ...board, walkable: undergroundFeatureWalkable(board.walkable, run.floorFeatures) }, 'qa-wanderer', character.village); }
        const npc = params.get('npc') === 'keeper' ? { tile: run.tiles.findIndex(t => t.kind === 'npc') } : run.wanderers!.find(n => n.role === params.get('npc'))!;
        const index = [npc.tile - 1, npc.tile + 1, npc.tile - run.width, npc.tile + run.width].find(i => run.tiles[i]?.kind === 'empty');
        if (index != null) { run.playerX = index % run.width; run.playerY = Math.floor(index / run.width); }
    }
    if (event) run.variant = { id: 'event-qa', label: 'Festival Rift', maxFloor: 3, bossName: 'Festival Guardian', width: 19, height: 15 };
    if (questVariant) run.variant = questVariant;
    if (!params.has('bossIntro')) sessionStorage.setItem(`shinobix:hollow-gate-alpha-intro:underground-qa:${floor}`, '1');
    const visible = computeHollowGateVisible(run);
    run.tiles = run.tiles.map((t, i) => ({ ...t, seen: params.has('explored') || visible.has(i) || (params.has('legacyAtlas') && t.kind === 'exit') }));
    return run;
}
export function CaveFixture() {
    const [run, setRun] = useState(() => initialRun());
    const [event, setEvent] = useState<HollowGateEventModal>(null);
    const [intro, setIntro] = useState<number | null>(params.has('intro') ? 0 : null);
    const [exited, setExited] = useState(false);
    function move(dx: number, dy: number) {
        document.body.dataset.move = `${dx},${dy}`;
        document.body.dataset.moveCount = String(Number(document.body.dataset.moveCount ?? 0) + 1);
        setRun(previous => {
            const x = previous.playerX + dx, y = previous.playerY + dy, tile = previous.tiles[y * previous.width + x];
            if (x < 0 || y < 0 || x >= previous.width || y >= previous.height || !tile || tile.kind === 'wall' || tile.kind === 'locked' || undergroundFeatureBlocks(previous.floorFeatures, y * previous.width + x)) return previous;
            const board = hollowGateBoardManifest(previous.tiles);
            const next = { ...previous, playerX: x, playerY: y, wanderers: previous.wanderers ? advanceHollowGateWanderers({ ...board, ...previous, walkable: undergroundFeatureWalkable(board.walkable, previous.floorFeatures), spawn: { x: 0, y: 0 } }, previous.wanderers, { x, y }, 1) : undefined };
            if (tile.kind === 'npc' || next.wanderers?.some(n => n.tile === y * next.width + x && !n.spent && (n.role === 'medic' || n.role === 'wayfarer'))) setTimeout(() => resolveHollowGateTile({ ...tile, kind: 'npc' }, x, y, {
                character, hollowGateRun: next, setHollowGateRun: setRun, setHollowGateEvent: setEvent, setHollowGateHiddenChamber: () => {},
                onVersionedCharacter: () => true, pushHollowGateLog: () => {}, buildHollowGateRunSummary: () => '', startHollowGateBattle: () => {}, leaveHollowGateShrine: () => {},
            }), 0);
            const visible = computeHollowGateVisible(next);
            return { ...next, tiles: previous.tiles.map((t, i) => ({ ...t, seen: t.seen || visible.has(i), revealed: t.revealed || i === y * previous.width + x })) };
        });
    }
    const walk = useHollowGateWalk({ active: !exited, run, blocked: !!event || intro !== null, moveStep: move });
    useEffect(() => {
        if (!params.has('resources')) return;
        const control = {
            walk: () => {
                const route = run.tiles.map((tile, i) => tile.kind === 'empty' ? findHollowGatePath(run, i) : null)
                    .find(path => path && path.length >= 5 && path.length <= 9 && path.every(i => run.tiles[i].kind === 'empty' && !run.wanderers?.some(n => n.tile === i)));
                if (!route) throw new Error('No clear resource-audit walk route');
                walk.walkTo(route[route.length - 1]);
                return route;
            },
            floor: (floor: number) => { setEvent(null); setRun(initialRun(floor)); },
        };
        Object.assign(window, { caveResourceControl: control });
        return () => { delete (window as unknown as { caveResourceControl?: unknown }).caveResourceControl; };
    }, [run, walk]);
    useEffect(() => { document.body.dataset.tile = String(run.playerY * run.width + run.playerX); document.body.dataset.npcs = JSON.stringify(run.wanderers); }, [run]);
    if (exited) return <h1>Returned to sector</h1>;
    return <HollowGateShrineView character={character} hollowGateRun={run} hollowGateLog={[]} sharedImages={sharedImages}
        hollowGateIntroPage={intro} setHollowGateIntroPage={setIntro} hollowGateEvent={event} hollowGateHiddenChamber={null}
        moveHollowGatePlayer={move} onTileClick={index => {
            if (hollowGateNpcCanTalk(run, index)) resolveHollowGateTile({ ...run.tiles[index], kind: 'npc' }, index % run.width, Math.floor(index / run.width), {
                character, hollowGateRun: run, setHollowGateRun: setRun, setHollowGateEvent: setEvent, setHollowGateHiddenChamber: () => {},
                onVersionedCharacter: () => true, pushHollowGateLog: () => {}, buildHollowGateRunSummary: () => '', startHollowGateBattle: () => {}, leaveHollowGateShrine: () => {},
            }); else walk.walkTo(index);
        }} walkTarget={walk.walkTarget} setHollowGateRun={setRun}
        onVersionedCharacter={() => true} pushHollowGateLog={() => {}} petEligible={false} exitPending={false}
        onEmergencyForfeit={() => { if (params.has('confirmForfeit')) void gameConfirm('Forfeit this Hollow Gate run?', { title: 'Emergency Forfeit', confirmLabel: 'Forfeit Run' }).then(confirmed => { if (confirmed) setExited(true); }); else setExited(true); }} onSearchHiddenChamber={() => {}} onTakeHiddenChamberRelic={() => {}} onCloseHiddenChamber={() => {}} />;
}
function ResourceCaveHost() {
    const [mounted, setMounted] = useState(false), [generation, setGeneration] = useState(0);
    return <>{mounted ? <CaveFixture key={generation} /> : <h1>Returned to sector</h1>}
        <button data-testid="cave-resource-enter" hidden={mounted} onClick={() => { setGeneration(value => value + 1); setMounted(true); }}>Enter preview</button>
        <button data-testid="cave-resource-unmount" hidden onClick={() => setMounted(false)}>Unmount preview</button>
    </>;
}
export function DungeonFixture() {
    const [exited, setExited] = useState(false);
    if (exited) return <h1>Returned to sector</h1>;
    if (params.has('raidHost')) return <LiveCapabilitiesContext.Provider value={capabilityStore}><AnbuVaultRaid character={character} sector={Number(params.get('sector') ?? 12)} targetVillage={targetVillage} sharedImages={{}}
        onVersionedCharacter={() => true} onExit={() => setExited(true)} onAttackPlayer={() => { document.body.dataset.attack = 'true'; }} /></LiveCapabilitiesContext.Provider>;
    return <StrongholdExplore character={character} sector={Number(params.get('sector') ?? 12)} targetVillage={targetVillage} sharedImages={{}}
        anbuAvatar="/anbu/frostfang.webp?v=2" anbuName="Frostfang Anbu" blocked={false} onExit={() => setExited(true)}
        onChallenge={() => { document.body.dataset.challenge = 'true'; }} onPatrol={() => { document.body.dataset.patrol = 'true'; }}
        onAttackPlayer={async player => {
            if (params.has('multiplayer')) { const result = await fetch('/api/player/attack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: character.name, targetName: player.name, attacker: { name: character.name } }) });
                const body = await result.json(); if (!result.ok) throw new Error(body.error ?? 'Battle admission failed'); document.body.dataset.admission = JSON.stringify(body); }
            document.body.dataset.attack = 'true';
        }} sectorContest={contest}
        onOpenSectorContest={() => { document.body.dataset.table = warKind; }} onFightSectorGarrison={() => { document.body.dataset.garrison = warKind; }} />;
}
export function AuditHost() {
    const [reauth, setReauth] = useState(false), [password, setPassword] = useState('');
    useEffect(() => { const expire = () => setReauth(true); window.addEventListener('qa-session-expired', expire); return () => window.removeEventListener('qa-session-expired', expire); }, []);
    return <><GameConfirmHost />{reauth && <SessionExpiredModal password={password} error="" busy={false} onPasswordChange={setPassword} onContinue={() => setReauth(false)} onLogout={() => setReauth(false)} />}{params.get('mode') === 'stronghold' ? <DungeonFixture /> : params.has('resources') ? <ResourceCaveHost /> : <CaveFixture />}</>;
}
createRoot(document.getElementById('root')!).render(params.has('strict') ? <StrictMode><AuditHost /></StrictMode> : <AuditHost />);
