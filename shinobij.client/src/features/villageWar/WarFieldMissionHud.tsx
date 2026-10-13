import { useEffect, useRef, useState } from 'react';
import type { CampaignFieldMissionView } from '../../../../shared/village-war-campaign';
import { campaignRequest } from '../../lib/village-war-campaign';
import { visiblePoll } from '../../lib/poll';
import { FieldMissionSummary } from './WarFieldOrders';
import './village-campaign.css';
export function WarFieldMissionHud({ name, warId, mission: initial, currentSector, onEnter }: {
    name: string; warId?: string; mission?: CampaignFieldMissionView | null; currentSector: number;
    onEnter: (target: { sector: number; village: string }) => void;
}) {
    const [snapshot, setMission] = useState<CampaignFieldMissionView | null>(null), [error, setError] = useState('');
    const mission = snapshot && snapshot.id === initial?.id && snapshot.serverNow >= initial.serverNow ? snapshot : initial;
    const order = initial?.id;
    const active = initial?.status === 'active';
    const inFlight = useRef(false);
    useEffect(() => {
        if (!warId || !order || !active) return;
        let alive = true;
        const stop = visiblePoll(async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            try { const response = await campaignRequest(name, warId, 'operation-progress', { missionId: order }); if (alive) { setMission(response.mission ?? null); setError(''); } }
            catch (e) { if (alive) setError(e instanceof Error ? e.message : 'Could not verify your field order.'); }
            finally { inFlight.current = false; }
        }, 3_000, 0, { immediate: true });
        return () => { alive = false; stop(); };
    }, [name, warId, order, active]);
    if (!mission || mission.status === 'abandoned') return null;
    return <details className='war-field-hud'><summary>{mission.kind.charAt(0).toUpperCase() + mission.kind.slice(1)} order · {mission.status !== 'active' ? mission.status : mission.kind === 'sabotage' ? `${mission.completedSectors.length}/3 sites` : mission.kind === 'supply' ? mission.pickedUp ? 'Deliver package' : 'Collect package' : `Sector ${mission.sectors[0]}`}{mission.holdSeconds > 0 && ` · ${mission.holdSeconds}/${mission.holdRequired}s`}</summary>
        <FieldMissionSummary mission={mission} />{error && <p role='alert'>{error}</p>}
        {mission.status === 'active' && mission.kind === 'espionage' && currentSector === mission.sectors[0] && <button onClick={() => onEnter({ sector: mission.sectors[0], village: mission.enemy })}>Enter mission stronghold</button>}
    </details>;
}
