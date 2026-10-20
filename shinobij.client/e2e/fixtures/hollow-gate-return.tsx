import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CardClashDuel } from '../../src/screens/CardClashDuel';
import { finishHollowGateCardAmbushFlow, leaveHollowGateCardAmbushFlow } from '../../src/lib/hollow-gate-card-return';
import type { Character, HollowGateShrineRun } from '../../src/types/character';
import type { Screen } from '../../src/types/core';
import type { HollowGateEventModal } from '../../src/lib/hollow-gate-tile';
import '../../src/index.css';
import '../../src/styles/late-normalize.css';
import '../../src/styles/veiled-steel.css';
import '../../src/styles/layout/adaptive-shell.css';
import '../../src/styles/layout/adaptive-stages.css';
import '../../src/styles/input-accessibility.css';

// Production duel and return helpers; API results are supplied by Playwright.
// The handler integration tests separately exercise real KV/save settlement.
const binding = { token: 'return-qa', nodeId: 'floor:1:ambush:threat-v20', matchId: 'return-match' };
const initial = { name: 'ReturnDiver', hp: 100, maxHp: 10000, hollowGateRun: { runToken: binding.token } } as Character;
function Fixture() {
    const [character, setCharacter] = useState(initial);
    const [run, setRun] = useState({ runToken: binding.token, floor: 1, threat: 100,
        tiles: Array.from({ length: 9 }, () => ({ kind: 'empty' })),
    } as HollowGateShrineRun | null);
    const [screen, setScreen] = useState<Screen>('hollowGateTiles');
    const [open, setOpen] = useState(true);
    const [event, setEvent] = useState<HollowGateEventModal>(null);
    const finish = () => finishHollowGateCardAmbushFlow({ character, binding, isCurrent: () => true,
        commitCharacter: next => { setCharacter(next); return true; }, setRun,
        closeMatch: () => setOpen(false), clearRun: () => setRun(null), pushLog: () => undefined, setScreen });
    const leave = () => leaveHollowGateCardAmbushFlow({ binding, closeMatch: () => setOpen(false),
        showShrine: () => setScreen('hollowGateShrine'), setEvent, resume: () => setOpen(true), forfeit: () => undefined });
    if (open) return <CardClashDuel character={character} creatorCards={[]} hollowGateCardMatchId={binding.matchId}
        onDungeonWin={finish} onDungeonLose={finish} onDungeonDraw={finish} onDungeonLeave={leave} />;
    return <main style={{ color: 'white', padding: 24 }}><h1 data-testid="returned-screen">{screen}</h1>
        <p data-testid="returned-hp">{character.hp}</p><p data-testid="board-tiles">{run?.tiles.length ?? 0}</p>
        {event && <section><h2>{event.title}</h2><p>{event.body}</p>
            {event.choices?.map(choice => <button key={choice.label} onClick={choice.onSelect}>{choice.label}</button>)}</section>}
    </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
