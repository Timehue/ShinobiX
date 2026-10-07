// Festival styles load before the lazy race screen in the production shell.
import '../../src/index.css';
import '../../src/styles/sunscar-modes.css';
import '../../src/styles/sunscar-responsive.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RallyRace } from '../../src/features/sunscar/RallyRace';
import { RallySession } from '../../src/features/sunscar/RallySession';
import { createRallyRace } from '../../../shared/sunscar/rally-simulation';
import { RALLY_TRACKS } from '../../../shared/sunscar/rally-tracks';
import { RALLY_RIVALS } from '../../../shared/sunscar/rally-rivals';

const initial = createRallyRace(123, RALLY_TRACKS[1].id, Array.from({ length: 4 }, (_, index) => ({
    id: index === 0 ? 'player' : `rival-${index}`,
    rivalId: index === 0 ? null : RALLY_RIVALS[index - 1].id,
    pet: { id: `pet-${index}`, templateId: 'starter-water', name: index === 0 ? 'Ripple Seal' : `Companion ${index + 1}`, element: 'Water' as const,
        profile: { speed: 60, acceleration: 60, agility: 60, endurance: 60, stability: 60, archetype: 'endurance' as const } },
})));

export function Fixture() {
    const [racing, setRacing] = useState(true);
    return <main>{racing ? <RallySession><RallyRace initial={initial} difficulty={0} official={false} title="Open practice"
        onExit={() => setRacing(false)} onFinished={() => {}} /></RallySession>
        : <button onClick={() => setRacing(true)}>Start practice</button>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
