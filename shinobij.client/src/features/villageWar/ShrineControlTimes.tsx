import type { CampaignObjective } from '../../../../shared/village-war-campaign';
import './shrine-control-times.css';

function duration(ms: number) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}
export function ShrineControlTimes({ objective, villages }: { objective: CampaignObjective; villages: string[] }) {
    return <div className='shrine-control-times' aria-label='Uncontested control time'>
        {villages.map(village => <span key={village}><strong>{village}</strong> {duration(objective.controlTimeMs?.[village] ?? 0)}</span>)}
    </div>;
}
