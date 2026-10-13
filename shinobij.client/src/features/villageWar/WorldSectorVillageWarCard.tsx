import { GiCrossedSwords } from '../../components/icons/LightweightGameIcons';
import type { WorldSectorCommandWar } from '../../components/WorldSectorCommandPanel.types';
export function WorldSectorVillageWarCard({ war, present, admissionOpen, onRaid }: {
    war: WorldSectorCommandWar; present: boolean; admissionOpen: boolean; onRaid: () => void;
}) {
    if (war.campaign) return <div className='summary-box sector-panel-card sector-war-card'>
        <h4>Village War Shrine</h4><p>{war.playerVillage} vs {war.enemyVillage}</p>
        <p>{war.playerVillage}: {war.campaign.ourPoints.toLocaleString()} War Points</p>
        <p>{war.enemyVillage}: {war.campaign.enemyPoints.toLocaleString()} War Points</p>
        <p>Enter this sector’s golden shrine during an open window. Shrine fighters must be inside; the War Hall shows its schedule.</p>
    </div>;
    return <div className='summary-box sector-panel-card sector-war-card'>
        <div className='sector-panel-card-head'><h4><GiCrossedSwords aria-hidden='true' />War Ground</h4></div>
        <p>{war.playerVillage} vs {war.enemyVillage}</p>
        <div className='sector-meter-block'><div className='sector-meter-row'><span>Ground HP</span>
            <strong>{war.warGroundHp.toLocaleString()} / {war.warGroundHpMax.toLocaleString()}</strong></div>
            <div className='sector-meter sector-meter-hp'><span style={{ width: `${(war.warGroundHp / war.warGroundHpMax) * 100}%` }} /></div></div>
        <div className='sector-meter-block'><div className='sector-meter-row'><span>{war.enemyVillage ?? 'Enemy'} HP</span>
            <strong>{war.enemyVillageHp.toLocaleString()} / {war.enemyVillageHpMax.toLocaleString()}</strong></div>
            <div className='sector-meter sector-meter-hp'><span style={{ width: `${(war.enemyVillageHp / war.enemyVillageHpMax) * 100}%` }} /></div></div>
        <button type='button' className='danger-button sector-action-btn is-danger' disabled={!present || !admissionOpen || war.warGroundHp <= 0 || war.ended} onClick={onRaid}>
            <span className='sector-action-icon' aria-hidden='true'><GiCrossedSwords /></span><span>Raid Enemy Village</span>
        </button>
    </div>;
}
