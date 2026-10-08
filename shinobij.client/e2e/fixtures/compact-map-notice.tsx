import { createRoot } from 'react-dom/client';
import { MapNotificationBanner } from '../../src/components/MapNotificationBanner';
import '../../src/styles/index/15-world-map-territory.css';
export function CompactMapNoticeFixture() {
    return <div className="map-instance" style={{ position: 'relative', width: 186, height: 200, background: '#394435' }}>
        <MapNotificationBanner identity="14:lesson" label="field lesson notice" className="pet-mentor-road-prompt">
            <button className="pet-mentor-road-action">
                <span className="pet-mentor-road-art" aria-hidden="true" />
                <span><small>Field lesson ready</small><strong>Tamer Tomoe &amp; Kuro</strong><em>Kuro found your companion's trail. Come hear what Tomoe wrote down.</em></span>
                <b>Study →</b>
            </button>
        </MapNotificationBanner>
    </div>;
}
createRoot(document.getElementById('root')!).render(<CompactMapNoticeFixture />);
