import '../styles/world-boss-tabs.css';

export type WorldBossTab = 'weekly' | 'hollow-beast';

export function WorldBossTabs({ active, onSelect }: { active: WorldBossTab; onSelect: (tab: WorldBossTab) => void }) {
    return <nav className="world-boss-tabs" aria-label="World Boss tabs">
        <button type="button" aria-pressed={active === 'weekly'} className={active === 'weekly' ? 'is-active' : ''} onClick={() => onSelect('weekly')}>
            <span>01</span> Weekly Boss
        </button>
        <button type="button" aria-pressed={active === 'hollow-beast'} className={active === 'hollow-beast' ? 'is-active' : ''} onClick={() => onSelect('hollow-beast')}>
            <span>02</span> Roaming Boss
        </button>
    </nav>;
}
