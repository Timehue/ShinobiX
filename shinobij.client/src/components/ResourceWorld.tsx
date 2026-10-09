import { useEffect, useRef, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { RESOURCE_NODES, resourceNode, resourceNodePosition, type ResourceNode } from '../../../shared/resource-nodes';
import { readResourceGathering, resourceNodeState, resourceSkillLevel, resourceSuccessRate, resourceActionsToday, RESOURCE_GRADES, type ResourceReceipt } from '../../../shared/resource-gathering';
import { resourceRequest } from '../lib/resource-api';
import { Modal } from './ui/Modal';
import { ResourceMinigame } from './ResourceMinigames';
import { GatheringResult } from './GatheringResult';
import { serverNow } from '../lib/server-clock';
import { gatheringTool, gatheringToolRemaining } from '../../../shared/gathering-tools';
import './resource-gathering.css';

export function ResourceWorld({ character, sector, tile, commit, walk }: { character: Character; sector: number; tile: number; commit: VersionedCharacterCommit; walk: (sector: number, tile: number) => void }) {
    const [selected, setSelected] = useState<ResourceNode | null>(null), [mode, setMode] = useState<'active' | 'relaxed'>('active');
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [receipt, setReceipt] = useState<ResourceReceipt | null>(null);
    const [now, setNow] = useState(() => serverNow());
    const inFlight = useRef(false), commitRef = useRef(commit); useEffect(() => { commitRef.current = commit; }, [commit]);
    useEffect(() => {
        let alive = true;
        void resourceRequest({ action: 'status', playerName: character.name }).then(result => {
            if (alive && result.character) commitRef.current(result.character, result._saveVersion);
        });
        return () => { alive = false; };
    }, [character.name]);
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
        if (inFlight.current || !node) return;
        inFlight.current = true; setBusy(true); setError('');
        try {
            const result = await resourceRequest({ action, playerName: character.name, nodeId: node.id, mode, requestId: active?.id, ...input });
            if (result.character && !commitRef.current(result.character, result._saveVersion)) { setError('A newer save arrived. Reopen this node to recover its result.'); return false; }
            if (!result.ok) { setError(result.error ?? 'Gathering is unavailable.'); return false; }
            if (result.receipt) {
                // A restored attempt has no clicked selection. Keep its node for the
                // receipt's remaining charges and repeat action after active clears.
                setSelected(node);
                try { sessionStorage.removeItem(`outpost-fishing:${result.receipt.id}`); } catch { /* optional recovery storage */ }
                setReceipt(result.receipt);
            }
            return true;
        } finally { inFlight.current = false; setBusy(false); }
    }
    function close() {
        if (busy) return;
        if (active) { void request('cancel'); return; }
        setSelected(null); setReceipt(null); setError('');
    }
    return <>
        <div className="resource-node-layer" aria-label="Fishing and mining nodes">{RESOURCE_NODES.filter(candidate => candidate.sector === sector).map(candidate => {
            const remaining = 3 - resourceNodeState(state.nodes[candidate.id], now).attempts;
            const pos = resourceNodePosition(candidate);
            return <button type="button" key={candidate.id} className={`resource-world-node resource-world-node--${candidate.activity}${remaining === 0 ? ' depleted' : ''}`}
                style={{ left: `${pos.left}%`, top: `${pos.top}%` }} aria-label={`${candidate.name}, ${candidate.activity}, ${remaining} attempts remaining, skill ${candidate.difficulty}`}
                title={`${candidate.name} · Skill ${candidate.difficulty} · ${remaining}/3 attempts`}
                onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setSelected(candidate); setReceipt(null); setError(''); }}>
                <span className="resource-node-medallion" aria-hidden="true">
                    <img className="resource-node-art" src={candidate.activity === 'fishing' ? '/items/gather-river-fish.svg' : '/items/tool-basic-pickaxe.svg'} alt="" draggable={false} />
                </span>
                <small className="resource-node-charges" aria-hidden="true">{remaining}/3</small>
            </button>;
        })}</div>
        <Modal open={Boolean(node || receipt)} onClose={close} title={node?.name ?? 'Gathering result'} className={`resource-dialog${receipt ? ' resource-dialog--report' : active ? ' resource-dialog--working' : ''}`} disableBackdropClose={Boolean(active)} disableEscapeClose={busy}>
            {receipt ? <GatheringResult character={character} receipt={receipt} node={node} charges={charges} today={today} busy={busy}
                onBack={close} onAgain={() => { void request('start').then(started => { if (started) setReceipt(null); }); }} /> : active ? <><div className="resource-attempt-strip"><span>Action spent · {today}/100 today</span><span>{Math.max(0, Math.min(Math.ceil((active.expiresAt - active.startedAt) / 1000), Math.ceil((active.expiresAt - now) / 1000)))}s remaining</span></div>
                {now >= active.expiresAt && <p role="status">This attempt expired. Close it to return to the map.</p>}
                <ResourceMinigame key={active.id} attempt={active} busy={busy || now >= active.expiresAt} resolve={input => void request('resolve', input)} />
                <button type="button" className="resource-cancel" disabled={busy} onClick={() => void request('cancel')}>{now >= active.expiresAt ? 'Close expired attempt' : 'Abandon attempt (action stays spent)'}</button>
            </> : node && <div className="resource-node-intro">
                <p className="resource-kicker">{node.activity === 'mining' ? 'Mountain seam · Fracture Chain' : 'Water shoal · Cast and reel'}</p>
                <div className="resource-node-stats"><span>Your skill <strong>{level}</strong></span><span>Attempts <strong>{charges}/3</strong></span><span>Baseline success <strong>{resourceSuccessRate(level, node.difficulty)}%</strong></span></div>
                <p>{node.difficulty === 1 ? 'Basic' : node.difficulty === 4 ? 'Rich' : 'Master'} site · Requires skill {node.difficulty} · Quality up to {RESOURCE_GRADES[node.ceiling]}</p>
                <p>Explore, fishing and mining share 100 total actions per UTC day. Failures and abandoned attempts count. Empty nodes replenish after 10 minutes.</p>
                <p><strong>{100 - Math.min(100, today)} actions left today</strong></p>
                {charges === 0 ? <p role="status">Replenishes in {Math.max(1, Math.ceil((resourceNodeState(state.nodes[node.id], now).refillAt - now) / 60_000))} minutes.</p>
                    : level < node.difficulty ? <p role="status">Train your {node.activity} skill to {node.difficulty} to use this node.</p>
                    : !usableTool ? <p role="status">Equip a {toolSlot === 'pickaxe' ? 'pickaxe' : 'fishing pole'} in Inventory first. Basic tools are available at the Ryo Shop.</p>
                    : tile !== node.approach || sector !== node.sector ? <button type="button" className="resource-primary" onClick={() => { setSelected(null); requestAnimationFrame(() => walk(node.sector, node.approach)); }}>Approach {node.activity === 'mining' ? 'rock base' : 'shore'}</button>
                    : <><fieldset className="resource-mode"><legend>Gathering style</legend><label><input type="radio" name="gather-mode" checked={mode === 'active'} onChange={() => setMode('active')} />Play minigame · up to +10% success</label><label><input type="radio" name="gather-mode" checked={mode === 'relaxed'} onChange={() => setMode('relaxed')} />Watch animation · baseline success</label></fieldset>
                        <button type="button" className="resource-primary" disabled={busy || today >= 100} onClick={() => void request('start')}>{busy ? 'Starting…' : node.activity === 'mining' ? 'Begin mining · 1 action' : 'Cast line · 1 action'}</button></>}
            </div>}
            {error && <p className="resource-warning" role="alert">{error}</p>}
        </Modal>
    </>;
}
