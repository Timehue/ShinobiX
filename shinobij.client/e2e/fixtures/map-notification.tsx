import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MapNotificationBanner } from '../../src/components/MapNotificationBanner';
import '../../src/styles/index/15-world-map-territory.css';

export function MapNotificationFixture() {
    const [lesson, setLesson] = useState(1), [sector, setSector] = useState(14), [visible, setVisible] = useState(true);
    return <>
        <button onClick={() => setLesson(value => value + 1)}>New lesson</button>
        <button onClick={() => setSector(value => value === 14 ? 15 : 14)}>Change sector</button>
        <button onClick={() => setVisible(value => !value)}>Toggle notice presence</button>
        <div className="map-instance" style={{ position: 'relative', width: 'min(90vw, 400px)', height: 300, background: '#394435' }}>
            {visible && <MapNotificationBanner identity={`${sector}:${lesson}`} label="field lesson notice" className="pet-mentor-road-prompt">
                <button className="mentor-action">Study lesson {lesson} in sector {sector}</button>
            </MapNotificationBanner>}
        </div>
    </>;
}
createRoot(document.getElementById('root')!).render(<MapNotificationFixture />);
