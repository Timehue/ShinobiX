import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GameAlertHost, GameConfirmHost, gameConfirm } from '../../src/components/GameAlert';
import { useHollowGateEntryPreview } from '../../src/lib/use-hollow-gate-entry-preview';
import { enterHollowGateShrineFlow } from '../../src/lib/hollow-gate-entry';
import type { Character, HollowGateEventConfig } from '../../src/types/character';
import type { Screen } from '../../src/types/core';
import '../../src/index.css';

const initial = { name: 'PreviewRunner', village: 'Moonshadow Village', hp: 10000, maxHp: 10000,
    level: 100, itemStacks: [], equipment: {}, stats: {}, dailyHollowGateRuns: 0,
    ...(new URLSearchParams(location.search).has('resume') ? { hollowGateRun: { runToken: 'resume-rift-token' } } : {}),
    ...(new URLSearchParams(location.search).has('marker') ? { lastHollowGateStart: { token: 'resume-rift-token', requestId: 'resume-rift-request' } } : {}),
} as unknown as Character;
const cfg = { id: 'rift-mirror-shard', label: 'Mirror-Shard Warden', keyCost: 0, requiresUnlock: false,
    maxFloor: 3, bossName: 'Mirror-Shard Warden' } as HollowGateEventConfig;

export function Fixture() {
    const [screen, setScreen] = useState<Screen>('worldMap');
    const [account, setAccount] = useState('PreviewRunner');
    const [combat, setCombat] = useState(false);
    const [encounter, setEncounter] = useState(false);
    const [finished, setFinished] = useState(0);
    const [otherConfirmed, setOtherConfirmed] = useState(false);
    const [character, setCharacter] = useState(initial);
    const current = useRef({ screen, account, combat });
    useLayoutEffect(() => { current.current = { screen, account, combat }; }, [screen, account, combat]);
    const preview = useHollowGateEntryPreview(screen, account, combat);
    const enter = () => {
        void preview.run(signal => enterHollowGateShrineFlow({ character, eventCfg: cfg, signal,
            isCurrent: () => current.current.account === account,
            canEnter: () => current.current.screen === 'worldMap' && !current.current.combat,
            currentRunToken: () => character.hollowGateRun?.runToken ?? character.lastHollowGateStart?.token,
            commitCharacter: next => { setCharacter(next); return true; }, setCharacter,
            setScreen, setCurrentBiome: () => undefined, setCurrentWeather: () => undefined,
            setHollowGateRun: () => undefined, setHollowGateLog: () => undefined, setHollowGateEvent: () => undefined,
            setHollowGateHiddenChamber: () => undefined, setHollowGateIntroPage: () => undefined, pushHollowGateLog: () => undefined,
        })).finally(() => { setFinished(n => n + 1); });
    };
    Object.assign(window, { queueOtherPrompt: () => { void gameConfirm('An unrelated confirmation', { title: 'Other action' }).then(setOtherConfirmed); }, interruptPreview: (kind: string) => {
        if (kind === 'encounter') { preview.onEncounterActiveChange(true); setEncounter(true); }
        if (kind === 'combat') setCombat(true);
        if (kind === 'screen') setScreen('village');
        if (kind === 'account') setAccount('OtherRunner');
    } });
    return <main style={{ color: 'white', padding: 16 }}><GameAlertHost /><GameConfirmHost />
        <h1>Rift entry</h1><button onClick={enter}>Preview descent</button>
        <button onClick={() => { preview.onEncounterActiveChange(false); setEncounter(false); setCombat(false); setScreen('worldMap'); }}>Return to map</button>
        <button onClick={() => { void gameConfirm('An unrelated confirmation', { title: 'Other action' }); }}>Other prompt</button>
        <output data-testid="entry-finished">{finished}</output>
        <output data-testid="entry-count">{character.dailyHollowGateRuns ?? 0}</output>
        <output data-testid="entry-token">{character.hollowGateRun?.runToken ?? character.lastHollowGateStart?.token ?? 'none'}</output>
        <output data-testid="entry-screen">{screen}</output>
        <output data-testid="other-confirmed">{String(otherConfirmed)}</output>
        {encounter && <section role="dialog" aria-label="Kano encounter"><h2>Kano</h2><button onClick={() => { setEncounter(false); preview.onEncounterActiveChange(false); setCombat(true); }}>Fight</button></section>}
        {combat && <section aria-label="Active combat">Combat continues</section>}
    </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
