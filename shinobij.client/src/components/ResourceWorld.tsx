import { useEffect, useRef, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { RESOURCE_NODES, WORLD_BOSS_CRYSTAL_NODES, resourceNode, resourceNodePosition, type ResourceNode } from '../../../shared/resource-nodes';
import { readResourceGathering, resourceNodeState, resourceSkillLevel, resourceSuccessRate, resourceActionsToday, RESOURCE_GRADES, type ResourceReceipt } from '../../../shared/resource-gathering';
import { resourceRequest, type ResourceResponse } from '../lib/resource-api';
import { Modal } from './ui/Modal';
import { ResourceMinigame } from './ResourceMinigames';
import { GatheringResult } from './GatheringResult';
import { serverNow } from '../lib/server-clock';
import { gatheringTool, gatheringToolRemaining } from '../../../shared/gathering-tools';
import './resource-gathering.css';

export function ResourceWorld({ character, sector, tile, commit, walk, worldBossCrystals }: {
    character: Character; sector: number; tile: number; commit: VersionedCharacterCommit; walk: (sector: number, tile: number) => void;
    worldBossCrystals?: { active?: boolean; eventId?: string; minedNodeIds?: readonly string[] };
}) {
    const [selected, setSelected] = useState<ResourceNode | null>(null), [mode, setMode] = useState<'active' | 'relaxed'>('active');
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [receipt, setReceipt] = useState<ResourceReceipt | null>(null);
    const [worldBossHollowShard, setWorldBossHollowShard] = useState<ResourceResponse['worldBossHollowShard']>();
    const [locallyMinedCrystals, setLocallyMinedCrystals] = useState<Record<string, string[]>>({});
    const [now, setNow] = useState(() => serverNow());
    const [recovery, setRecovery] = useState({ name: '', status: 'checking' as 'checking' | 'ready' | 'failed' });
    const [recoveryRetry, setRecoveryRetry] = useState(0);
    const ready = recovery.name === character.name && recovery.status === 'ready';
    const recoveryAttemptRef = useRef(character.resourceGathering?.active);
    useEffect(() => { recoveryAttemptRef.current = character.resourceGathering?.active; }, [character.resourceGathering?.active]);
    const inFlight = useRef(false), commitRef = useRef(commit); useEffect(() => { commitRef.current = commit; }, [commit]);
    useEffect(() => {
        let alive = true;
        const attempt = recoveryAttemptRef.current;
        void resourceRequest({ action: 'status', playerName: character.name, requestId: attempt?.id, nodeId: attempt?.nodeId }).then(result => {
            if (!alive) return;
            if (!result.ok || !result.character || !commitRef.current(result.character, result._saveVersion)) {
                setRecovery({ name: character.name, status: 'failed' });
                setError(result.error ?? 'A newer save arrived. Check gathering again to recover your attempt.');
                return;
            }
            if (result.receipt) {
                setSelected(resourceNode(result.nodeId) ?? null);
                clearAttemptInput(result.receipt.id);
                setReceipt(result.receipt);
            }
            setError(''); setRecovery({ name: character.name, status: 'ready' });
        });
        return () => { alive = false; };
    }, [character.name, recoveryRetry]);
    useEffect(() => { const interval = window.setInterval(() => setNow(serverNow()), 1000); return () => clearInterval(interval); }, []);
    const state = readResourceGathering(character.resourceGathering), active = state.active;
    const node = active ? resourceNode(active.nodeId) : selected;
    const level = node ? resourceSkillLevel(state[`${node.activity}Xp`]) : 1;
    const toolSlot = node?.activity === 'mining' ? 'pickaxe' : 'fishingPole';
    const toolId = character.equipment[toolSlot];
    const usableTool = gatheringTool(toolId)?.slot === toolSlot && gatheringToolRemaining(character, toolId!) !== 0;
    const charges = node ? 3 - resourceNodeState(state.nodes[node.id], now).attempts : 0;
    const today = resourceActionsToday(character, now);
    async function request(action: 'start' | 'resolve' | 'cancel', input: Record<string, unknown> = {}) {
        if (inFlight.current || !node || !ready) return;
        inFlight.current = true; setBusy(true); setError('');
        try {
            const result = await resourceRequest({ action, playerName: character.name, nodeId: node.id, mode, requestId: active?.id, ...input });
            if (result.character && !commitRef.current(result.character, result._saveVersion)) { setError('A newer save arrived. Reopen this node to recover its result.'); return false; }
            if (!result.ok) { setError(result.error ?? 'Gathering is unavailable.'); return false; }
            if (result.worldBossHollowShard) {
                setWorldBossHollowShard(result.worldBossHollowShard);
                const worldBossEventId = worldBossCrystals?.eventId;
                if (worldBossEventId && node.worldBossCrystal) setLocallyMinedCrystals(current => ({
                    ...current,
                    [worldBossEventId]: [...new Set([...(current[worldBossEventId] ?? []), node.id])],
                }));
            }
            if (result.receipt) {
                // A restored attempt has no clicked selection. Keep its node for the
                // receipt's remaining charges and repeat action after active clears.
                setSelected(node);
                clearAttemptInput(result.receipt.id);
                setReceipt(result.receipt);
            }
            return true;
        } finally { inFlight.current = false; setBusy(false); }
    }
    function close() {
        if (busy || (active && !ready)) return;
        if (active) { void request('cancel'); return; }
        setSelected(null); setReceipt(null); setError('');
    }
    const minedCrystals = new Set([...(worldBossCrystals?.minedNodeIds ?? []), ...(locallyMinedCrystals[worldBossCrystals?.eventId ?? ''] ?? [])]);
    const visibleNodes = [
        ...RESOURCE_NODES,
        ...(worldBossCrystals?.active ? WORLD_BOSS_CRYSTAL_NODES.filter(candidate => !minedCrystals.has(candidate.id)) : []),
    ];
    return <>
        <div className="resource-node-layer" aria-label="Fishing, mining, and event crystal nodes">{visibleNodes.filter(candidate => candidate.sector === sector).map(candidate => {
            const remaining = 3 - resourceNodeState(state.nodes[candidate.id], now).attempts;
            const pos = resourceNodePosition(candidate);
            return <button type="button" key={candidate.id} className={`resource-world-node resource-world-node--${candidate.activity}${candidate.worldBossCrystal ? ' resource-world-node--world-boss-crystal' : ''}${remaining === 0 ? ' depleted' : ''}`}
                style={{ left: `${pos.left}%`, top: `${pos.top}%` }} aria-label={`${candidate.name}, ${candidate.activity}, ${remaining} attempts remaining, skill ${candidate.difficulty}`}
                title={candidate.name + ' · Skill ' + candidate.difficulty + (candidate.worldBossCrystal ? ' · yields one Hollow Shard for the World Boss event' : ' · ' + remaining + '/3 attempts')}
                onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setSelected(candidate); setReceipt(null); setError(''); }}>
                <span className="resource-node-medallion" aria-hidden="true">
                    <img className="resource-node-art" src={candidate.worldBossCrystal ? '/items/gather-stormglass-shard-v1.webp' : candidate.activity === 'fishing' ? '/items/gather-river-fish.svg' : '/items/tool-basic-pickaxe.svg'} alt="" draggable={false} />
                </span>
                <small className="resource-node-charges" aria-hidden="true">{candidate.worldBossCrystal ? 'EVENT' : `${remaining}/3`}</small>
            </button>;
        })}</div>
        <Modal open={Boolean(node || receipt)} onClose={close} title={node?.name ?? 'Gathering result'} className={`resource-dialog${receipt ? ' resource-dialog--report' : active ? ' resource-dialog--working' : ''}`} disableBackdropClose={Boolean(active)} disableEscapeClose={busy}>
            {!ready ? <div className="resource-node-intro">
                <p role="status">{recovery.status === 'failed' ? 'Gathering could not be checked. Your attempt has not been restarted.' : 'Checking your gathering attempt…'}</p>
                {recovery.status === 'failed' && <button type="button" className="resource-primary" onClick={() => { setRecovery({ name: character.name, status: 'checking' }); setError(''); setRecoveryRetry(value => value + 1); }}>Check gathering again</button>}
            </div> : receipt ? <GatheringResult character={character} receipt={receipt} node={node} charges={charges} today={today} busy={busy}
                onBack={close} onAgain={() => { void request('start').then(started => { if (started) setReceipt(null); }); }} /> : active ? <><div className="resource-attempt-strip"><span>Action spent · {today}/100 today</span><span>{Math.max(0, Math.min(Math.ceil((active.expiresAt - active.startedAt) / 1000), Math.ceil((active.expiresAt - now) / 1000)))}s remaining</span></div>
                {now >= active.expiresAt && <p role="status">This attempt expired. Close it to return to the map.</p>}
                <ResourceMinigame key={active.id} attempt={active} busy={busy || now >= active.expiresAt} resolve={input => void request('resolve', input)} />
                <button type="button" className="resource-cancel" disabled={busy} onClick={() => void request('cancel')}>{now >= active.expiresAt ? 'Close expired attempt' : 'Abandon attempt (action stays spent)'}</button>
            </> : node && <div className="resource-node-intro">
                <p className="resource-kicker">{node.worldBossCrystal ? 'World threat · Hollow Shard' : node.activity === 'mining' ? 'Mountain seam · Fracture Chain' : 'Water shoal · Cast and reel'}</p>
                <div className="resource-node-stats"><span>Your skill <strong>{level}</strong></span><span>Attempts <strong>{charges}/3</strong></span><span>Baseline success <strong>{resourceSuccessRate(level, node.difficulty)}%</strong></span></div>
                <p>{node.difficulty === 1 ? 'Basic' : node.difficulty === 4 ? 'Rich' : 'Master'} site · Requires skill {node.difficulty} · Quality up to {RESOURCE_GRADES[node.ceiling]}</p>
                {node.worldBossCrystal && <p>This vein is shared across the world. A successful mine stores one Hollow Shard for you. Turn it in on the World Bosses screen for contribution points and to fill the world's weakening meter.</p>}
                <p>Explore, fishing and mining share 100 total actions per UTC day. Failures and abandoned attempts count. Empty nodes replenish after 10 minutes.</p>
                <p><strong>{100 - Math.min(100, today)} actions left today</strong></p>
                {charges === 0 ? <p role="status">Replenishes in {Math.max(1, Math.ceil((resourceNodeState(state.nodes[node.id], now).refillAt - now) / 60_000))} {Math.ceil((resourceNodeState(state.nodes[node.id], now).refillAt - now) / 60_000) <= 1 ? 'minute' : 'minutes'}.</p>
                    : level < node.difficulty ? <p role="status">Train your {node.activity} skill to {node.difficulty} to use this node.</p>
                    : !usableTool ? <p role="status">Equip a {toolSlot === 'pickaxe' ? 'pickaxe' : 'fishing pole'} in Inventory first. Basic tools are available at the Ryo Shop.</p>
                    : tile !== node.approach || sector !== node.sector ? <button type="button" className="resource-primary" onClick={() => { setSelected(null); requestAnimationFrame(() => walk(node.sector, node.approach)); }}>Approach {node.activity === 'mining' ? 'rock base' : 'shore'}</button>
                    : <><fieldset className="resource-mode"><legend>Gathering style</legend><label><input type="radio" name="gather-mode" checked={mode === 'active'} onChange={() => setMode('active')} />Play minigame · up to +10% success</label><label><input type="radio" name="gather-mode" checked={mode === 'relaxed'} onChange={() => setMode('relaxed')} />Watch animation · baseline success</label></fieldset>
                        <button type="button" className="resource-primary" disabled={busy || today >= 100} onClick={() => void request('start')}>{busy ? 'Starting…' : node.activity === 'mining' ? 'Begin mining · 1 action' : 'Cast line · 1 action'}</button></>}
            </div>}
            {receipt && node?.worldBossCrystal && receipt.outcome === 'success' && worldBossHollowShard && <p className="resource-world-boss-receipt" role="status">{worldBossHollowShard.harvested ? 'Hollow Shard secured' : 'This Hollow Shard was already claimed'} · You hold {worldBossHollowShard.heldHollowShards} · {worldBossHollowShard.pointsPerShard.toLocaleString()} points per shard when turned in.</p>}
            {error && <p className="resource-warning" role="alert">{error}</p>}
        </Modal>
    </>;
}

function clearAttemptInput(id: string) {
    try {
        sessionStorage.removeItem(`outpost-fishing:${id}`);
        sessionStorage.removeItem(`outpost-mining:${id}`);
    } catch { /* optional recovery storage */ }
}
