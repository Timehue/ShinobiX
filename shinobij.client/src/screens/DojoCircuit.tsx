import { useEffect, useRef, useState } from 'react';
import type { Character } from '../types/character';
import type { Screen } from '../types/core';
import type { CircuitDiscipline, CircuitResponse } from '../../../shared/dojo-circuit';
import { CircuitExperience } from '../features/dojo-circuit/CircuitExperience';
import { useCircuit } from '../features/dojo-circuit/useCircuit';
import { fetchCircuit, rememberCircuitTrial } from '../features/dojo-circuit/client';
import { requestAiFight } from '../lib/ai-fight-request';
import { publishedPracticeOpponentForLevel } from '../lib/creator-event-practice';
import { playGameSfx, primeGameAudio } from '../lib/game-audio';

export function DojoCircuit({ character, setScreen }: { character: Character; setScreen: (screen: Screen) => void }) {
    const { data, error, busy, act, refresh } = useCircuit();
    const [past, setPast] = useState<CircuitResponse | null>(null);
    const [localError, setLocalError] = useState('');
    const historyRequest = useRef<AbortController | null>(null);
    const cancelHistory = () => { historyRequest.current?.abort(); historyRequest.current = null; };
    useEffect(() => cancelHistory, [character.name]);
    const loadHistory = async (id: string) => {
        cancelHistory(); setLocalError('');
        const controller = new AbortController(); historyRequest.current = controller;
        try {
            const result = await fetchCircuit(undefined, undefined, id, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]));
            if (historyRequest.current === controller && !controller.signal.aborted) setPast(result);
        } catch (error) {
            if (historyRequest.current === controller && !controller.signal.aborted) setLocalError(error instanceof Error ? error.message : 'Unable to open this Circuit.');
        } finally { if (historyRequest.current === controller) historyRequest.current = null; }
    };
    useEffect(() => { if (data) rememberCircuitTrial(character.name, data.attempt?.discipline ?? null); }, [data, character.name]);
    const onAction = async (action: string, discipline?: CircuitDiscipline) => {
        primeGameAudio(); setLocalError('');
        const next = await act({ action, eventId: data?.event?.id, discipline });
        if (next && action === 'check') playGameSfx('victory-seal', { gain: .65 });
        else if (next && action === 'join') playGameSfx('paper', { gain: .6 });
        return next;
    };
    const launch = async (discipline: CircuitDiscipline) => {
        const next = await onAction('begin', discipline);
        if (!next?.attempt) return;
        rememberCircuitTrial(character.name, discipline);
        if (discipline === 'combat') {
            if (!requestAiFight({ opponentId: publishedPracticeOpponentForLevel(character.level), opponentLevel: character.level, battleKind: 'practice', opponentName: 'Dojo Circuit challenger', returnScreen: 'dojoCircuit' })) {
                setLocalError('The combat arena is busy. Your trial is ready; try entering again when your current activity ends.');
            }
        } else setScreen(discipline === 'cards' ? 'shinobiTiles' : 'petColiseum');
    };
    return <CircuitExperience character={character} data={past ?? data} error={localError || error} busy={busy} archive={!!past}
        onBack={() => { cancelHistory(); setLocalError(''); if (past) setPast(null); else setScreen('village'); }}
        onAction={(action, discipline) => { void onAction(action, discipline); }}
        onLaunch={d => { void launch(d); }} onRefresh={() => { setLocalError(''); if (past?.event) void loadHistory(past.event.id); else void refresh(); }}
        onHistory={id => { void loadHistory(id); }} />;
}
