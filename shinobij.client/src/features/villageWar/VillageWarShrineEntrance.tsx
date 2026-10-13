import { useEffect, useState } from 'react';
import type { CampaignView, CampaignObjective } from '../../../../shared/village-war-campaign';
import './war-shrine-room.css';

/** The landmark exists only in the declaration's sealed random sector. */
export function VillageWarShrineEntrance({ campaign, sector, present, blocked, onEnter }: {
    campaign: CampaignView; sector: number; present: boolean; blocked: boolean; onEnter: (objective: CampaignObjective) => void;
}) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
    const objective = campaign.shrine.find(o => o.sector === sector && now < o.closesAt);
    if (!objective || now >= campaign.endsAt) return null;
    const locked = now < objective.opensAt;
    const status = locked ? `Locked · opens in ${Math.max(1, Math.ceil((objective.opensAt - now) / 60_000))}m`
        : `Open · ${Math.max(1, Math.ceil((objective.closesAt - now) / 60_000))}m left`;
    return <button type='button' className='sector-war-shrine-standee' disabled={!present || blocked || locked}
        aria-label={`Golden War Shrine · ${status}`} title={!present ? `Travel to Sector ${sector} to enter the golden war shrine.` : status}
        onClick={() => onEnter(objective)}>
        <img src='/ui/village-war/war-shrine-landmark-gold-v1.webp' alt='' draggable={false} />
        <span>Golden War Shrine<br />{status}</span>
    </button>;
}
