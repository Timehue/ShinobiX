import { useEffect, useState } from 'react';
import type { Screen } from '../../types/core';
import { loadDojoCircuitEnabled } from '../../lib/world-state';
import { visiblePoll } from '../../lib/poll';
import { CircuitMark } from './CircuitMark';
import { rememberedCircuitTrial } from './client';
import { DISCIPLINES, PHASE_LABELS, circuitTime, villageTone } from './presentation';
import { circuitPhase } from '../../../../shared/dojo-circuit';
import { useCircuit } from './useCircuit';
import './dojo-circuit.css';

export function CircuitNotice({ village, playerName, onOpen }: { village: string; playerName?: string; onOpen: () => void }) {
    const [enabled, setEnabled] = useState(loadDojoCircuitEnabled);
    useEffect(() => visiblePoll(() => setEnabled(loadDojoCircuitEnabled()), 5000, 0, { immediate: true }), []);
    if (!enabled) return null;
    return <CircuitInvitation village={village} playerName={playerName} onOpen={onOpen} />;
}

function CircuitInvitation({ village, playerName, onOpen }: { village: string; playerName?: string; onOpen: () => void }) {
    const { data, error } = useCircuit();
    if (data && !data.enabled) return null;
    const phase = circuitPhase(!!data?.enabled, data?.event ?? null, data?.serverNow ?? 0);
    const mine = data?.event?.entrants.find(e => e.name.toLowerCase() === playerName?.toLowerCase());
    const target = phase === 'upcoming' ? data?.event?.startsAt : phase === 'live' ? data?.event?.endsAt : null;
    const status = data ? `${PHASE_LABELS[phase]}${target ? ` · ${phase === 'upcoming' ? 'Starts' : 'Closes'} in ${circuitTime(target, data.serverNow)}` : ''}${mine ? ` · ${mine.seals.length} of 3 seals earned` : ''}` : error ? 'Open the event board to reconnect' : 'Opening the invitation…';
    return <button type="button" className="dc-notice" data-village-tone={villageTone(village)} onClick={onOpen}><CircuitMark /><span><small>A WORLD EVENT · YOUR VILLAGE INVITATION</small><strong>Dojo Circuit</strong><em>Combat. Cards. Companions. One shared gathering.</em><small className="dc-notice-status">{status}</small></span><span className="dc-notice-arrow" aria-hidden="true">↗</span></button>;
}

export function CircuitReturnRibbon({ name, screen, onReturn }: { name: string; screen: Screen; onReturn: () => void }) {
    const [trial, setTrial] = useState(() => rememberedCircuitTrial(name));
    useEffect(() => { const sync = () => setTrial(rememberedCircuitTrial(name)); sync(); window.addEventListener('dojo-trial-change', sync); return () => window.removeEventListener('dojo-trial-change', sync); }, [name]);
    if (!trial || !['shinobiTiles', 'cardClashFreePlay', 'petColiseum', 'petArena', 'battleArena'].includes(screen)) return null;
    return <div className="dc-return"><CircuitMark discipline={trial} /><div><strong>Dojo Circuit · {DISCIPLINES[trial].seal}</strong><small>Finish your activity, then return to the Circuit scribe.</small></div><button className="dc-primary" onClick={onReturn}>Return to Circuit</button></div>;
}
