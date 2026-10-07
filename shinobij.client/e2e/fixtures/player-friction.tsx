import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorldToast } from '../../src/components/WorldToast';
import { HunterBoard } from '../../src/screens/HunterBoard';
import type { Character } from '../../src/types/character';
import '../../src/index.css';
import '../../src/styles/veiled-steel.css';

export default function Fixture() {
    const [, setFrame] = useState(0);
    const [notice, setNotice] = useState(true);
    const params = new URLSearchParams(location.search);
    const [character, setCharacter] = useState<Character | null>({ name: 'FixtureHunter', level: Number(params.get('level') ?? 16),
        hunterRank: Number(params.get('rank') ?? 3), dailyHuntsCompleted: params.has('claim') ? 0 : 23, lastHuntReset: new Date().toISOString().slice(0, 10), village: 'Stormveil Village',
        stats: {}, inventory: [], itemStacks: [], equipment: {}, pets: [], ryo: 1000, stamina: 100,
    } as Character);
    const [accepted, setAccepted] = useState(params.has('claim') ? ['hunt-wild-boar'] : []);
    const [progress, setProgress] = useState<Record<string, number>>(params.has('claim') ? { 'hunt-wild-boar': 999 } : {});
    useEffect(() => { const timer = setInterval(() => setFrame(frame => frame + 1), 100); return () => clearInterval(timer); }, []);
    return <main><h1>Player feedback checks</h1>{params.has('toast') ? <>
        <button onClick={() => setNotice(true)}>Show update</button>
        {notice && <WorldToast kicker="The trail closes" icon={<span>!</span>} text="Follow the paw marker to Sector 22 to find the beast." onClose={() => setNotice(false)} />}
    </> : character && <HunterBoard character={character} updateCharacter={setCharacter} onVersionedCharacter={next => { setCharacter(next); return true; }}
        onServerVersion={() => true} creatorAis={[]} acceptedMissionIds={accepted} setAcceptedMissionIds={setAccepted}
        missionProgress={progress} setMissionProgress={setProgress} setScreen={() => {}} />}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
