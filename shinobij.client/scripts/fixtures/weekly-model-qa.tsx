import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { SectorWeeklyBossActor } from '../../src/components/SectorWeeklyBossActor';
import { wandererAvatar } from '../../src/lib/wanderer-art';

const mode = new URLSearchParams(location.search).get('portrait');
const custom = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="purple"/></svg>');
const portrait = mode === 'canonical' ? wandererAvatar('hollow-warden')
    : mode === 'public' ? '/portraits/hollow-warden.webp' : mode === 'custom' ? custom : undefined;

export function Fixture() {
    const [playerIndex, setPlayerIndex] = useState(125);
    const [engagements, setEngagements] = useState(0);
    return <main>
        <h1>Weekly encounter renderer</h1>
        <div className="pixel-map" style={{ position: 'relative', width: 'min(540px, 94vw)', aspectRatio: '1',
            padding: 8, gap: 1, border: '1px solid #789', background: '#52645a', overflow: 'visible' }}>
            <SectorWeeklyBossActor playerIndex={playerIndex} biome="forest" portrait={portrait}
                name="Hollow Warden" onEngage={() => { setEngagements(n => n + 1); return true; }} />
        </div>
        <button onClick={() => setPlayerIndex(0)}>Move northwest</button>
        <button onClick={() => setPlayerIndex(143)}>Move southeast</button>
        <output data-testid="engagements">{engagements}</output>
    </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
