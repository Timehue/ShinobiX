import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HollowGateShrineView } from '../../src/features/hollowGate/HollowGateShrineView';
import { useHollowGateAppFlow } from '../../src/lib/hollow-gate-app-flow';
import { generateHollowGateShrineRun } from '../../src/lib/hollow-gate-dungeon';
import { computeHollowGateSight } from '../../src/lib/hollow-gate-visibility';
import type { Character, HollowGateShrineRun } from '../../src/types/character';
import type { HollowGatePetFightRef } from '../../src/components/HollowGatePetFight';
import '../../src/index.css';

const initialRun = { ...generateHollowGateShrineRun(1, undefined, 'paid-eye-combat'), runToken: 'paid-eye-run' };
const initialCharacter = { name: 'RelicDiver', hp: 100, maxHp: 100, pets: [], inventory: [], hollowShards: 100 } as unknown as Character;
const noop = () => undefined;

// Real shrine and victory flow; the arena result and purchase API are fixtures.
// Like App, the owner survives while either fight unmounts the entire shrine.
export function Fixture() {
    const [run, setRun] = useState<HollowGateShrineRun | null>(initialRun);
    const [character, setCharacter] = useState(initialCharacter);
    const [fight, setFight] = useState<'pve' | 'pet' | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [receipts, setReceipts] = useState(0);
    const current = useRef({ run, character });
    useLayoutEffect(() => { current.current = { run, character }; }, [run, character]);
    const currentScope = () => {
        const live = current.current;
        return live.run ? { run: live.run, playerName: live.character.name } : null;
    };
    const pushLog = (line: string) => setLogs(prev => [...prev, line]);
    const commitCharacter = (next: Character) => { setCharacter(next); setReceipts(prev => prev + 1); return true; };
    const flow = useHollowGateAppFlow({ character, run, sharedImages: {}, commitCharacter,
        captureSessionScope: name => ({ isCurrent: () => current.current.character.name === name }),
        setRun, setEvent: noop, setHiddenChamber: noop, setPetFight: noop, setScreen: noop,
        clearRunState: () => setRun(null), clearLog: noop, pushLog, buildRunSummary: () => '' });
    const settle = useRef(noop);
    function enter(mode: 'pve' | 'pet') {
        if (!run) return;
        const gate = { token: run.runToken!, floor: run.floor, nodeId: 'floor:1:ambush:fixture', kind: 'ambush', mode, runId: 'paid-eye-fight' } as HollowGatePetFightRef;
        setRun({ ...run, activeCombat: { ...gate, mode } });
        setFight(mode);
        // A combat component can retain the callback it had when settlement began.
        settle.current = () => {
            if (mode === 'pet') flow.onPetBattleEnd({ ok: true, won: true }, gate);
            else flow.onBattleWin({ isAmbush: true, nodeId: gate.nodeId });
            setFight(null);
        };
    }
    return <main>
        <output hidden data-testid="relic-state">{JSON.stringify({ run, character, receipts, logs,
            sight: run ? computeHollowGateSight(run).size : 0 })}</output>
        <button onClick={() => enter('pve')}>Enter PvE fight</button>
        <button onClick={() => enter('pet')}>Enter pet fight</button>
        <button onClick={() => setRun(prev => prev && { ...prev, floor: 2, diviner: false, keys: 7, torch: 9 })}>Descend fixture</button>
        <button onClick={() => setRun(prev => prev && { ...prev, runToken: 'replacement-run', diviner: false })}>Replace run fixture</button>
        <button onClick={() => setCharacter({ ...initialCharacter, name: 'OtherDiver' })}>Switch account fixture</button>
        <button onClick={() => setRun(null)}>Close run fixture</button>
        {fight && <section aria-label="Active combat"><p>{fight}</p><button onClick={() => settle.current()}>Win and return</button></section>}
        {!fight && run && <HollowGateShrineView character={character} hollowGateRun={run} hollowGateLog={logs}
            currentConsumableScope={currentScope} sharedImages={{}} hollowGateIntroPage={null} setHollowGateIntroPage={noop}
            hollowGateEvent={null} hollowGateHiddenChamber={null} moveHollowGatePlayer={noop} onTileClick={noop}
            walkTarget={null} setHollowGateRun={setRun} onVersionedCharacter={commitCharacter} pushHollowGateLog={pushLog}
            petEligible={false} exitPending={false} onEmergencyForfeit={noop} onSearchHiddenChamber={noop}
            onTakeHiddenChamberRelic={noop} onCloseHiddenChamber={noop} />}
    </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
