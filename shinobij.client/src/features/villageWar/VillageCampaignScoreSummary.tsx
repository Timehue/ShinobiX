import type { VillageWar } from '../../lib/world-state';
export function VillageCampaignScoreSummary({ war }: { war: Pick<VillageWar, 'villages' | 'warPoints' | 'warGroundSector' | 'campaignEndsAt'> }) {
    return <>
        <div className='town-war-scoreboard' role='group' aria-label='Village war scores'>
            {war.villages.map(village => <p className='town-war-score' key={village}><strong>{village}</strong>
                <span>{(war.warPoints?.[village] ?? 0).toLocaleString()}{' '}<small>War Points</small></span></p>)}
        </div>
        <p className='town-war-shrine-location'>War Shrine · Sector {war.warGroundSector}</p>
    </>;
}
