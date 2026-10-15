import { useEffect, useState } from 'react';
import { VILLAGE_CAMPAIGN_DURATION_MS, shrineRules } from '../../../../shared/village-war-campaign';
import { GameArtIcon } from '../../components/GameArtIcon';
import { WAR_CREST } from '../../data/war-ui-images';
import { visiblePoll } from '../../lib/poll';
import { activeVillageWarsFor, villageWarHpMax } from '../../lib/world-state';
import { contestVillageUnfed, fetchWarMap, type SectorWarContest } from '../../lib/village-war-map';
import type { Screen } from '../../types/core';
import { VillageCampaignScoreSummary } from './VillageCampaignScoreSummary';
import { ShrineSchedule } from './ShrineSchedule';
import './town-hall-war-display.css';

const remaining = (ms: number) => {
    const minutes = Math.max(0, Math.ceil(ms / 60_000));
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes / 60) % 24;
    return days ? `${days}d ${hours}h ${minutes % 60}m` : hours ? `${hours}h ${minutes % 60}m` : `${minutes % 60}m`;
};

export function TownHallWarDisplay({ village, sectorMapOpen, sectorMapStatus, setScreen, onDefend }: {
    village: string; sectorMapOpen: boolean; sectorMapStatus: string;
    setScreen: (screen: Screen) => void; onDefend: () => void;
}) {
    const [now, setNow] = useState(() => Date.now());
    const [contests, setContests] = useState<SectorWarContest[] | null>(null);
    const [readFailed, setReadFailed] = useState(false);
    useEffect(() => {
        let alive = true;
        let reading = false;
        const refresh = async () => {
            setNow(Date.now());
            if (!sectorMapOpen || reading) return;
            reading = true;
            try {
                const data = await fetchWarMap();
                if (!alive) return;
                setContests((data.contests ?? []).filter(c => c.attackerVillage === village || c.defenderVillage === village));
                setReadFailed(false);
            } catch { if (alive) setReadFailed(true); }
            finally { reading = false; }
        };
        const stop = visiblePoll(refresh, 15_000, 0.1, { immediate: true });
        return () => { alive = false; stop(); };
    }, [village, sectorMapOpen]);
    // App's world-state poll owns this cache; the local clock refreshes its display
    // even when the village treasury and leadership records have not changed.
    const primaryVillageWar = activeVillageWarsFor(village)[0];
    const enemy = primaryVillageWar?.villages.find(side => side !== village);
    const endsAt = primaryVillageWar?.campaignEndsAt;
    const startsAt = endsAt ? endsAt - VILLAGE_CAMPAIGN_DURATION_MS : primaryVillageWar?.pendingUntil;
    const preparing = !!startsAt && now < startsAt;
    const settling = !!endsAt && now >= endsAt;
    const activeContests = (contests ?? []).filter(c => !c.flipped && c.endsAt > now).sort((a, b) => a.endsAt - b.endsAt);
    const isCampaign = primaryVillageWar?.campaignVersion === 2 || primaryVillageWar?.campaignVersion === 3;
    const rules = shrineRules({ version: primaryVillageWar?.campaignVersion ?? 3 });
    const limit = primaryVillageWar?.campaignVersion === 2 ? 15 : 10;
    const window = primaryVillageWar?.shrineWindows?.find(o => now < o.closesAt);
    const shrineStatus = window ? now < window.opensAt ? `Shrine window opens in ${remaining(window.opensAt - now)}`
        : `Shrine window closes in ${remaining(window.closesAt - now)}` : 'No remaining shrine windows';
    return <section className='town-war-display' aria-label='War operations'>
        <div className='town-section-heading'><p className='act-label'>Village war room</p><h3>War operations</h3>
            <p>Choose a campaign, learn its rules, and find your next contribution.</p></div>
        <div className='town-war-display-grid'>
            <article className='town-war-display-card' aria-label='Village war display'>
                <div className='town-war-display-shrine-banner'><img src='/ui/village-war/war-shrine-landmark-gold-v1.webp'
                    width={512} height={384} alt='Golden war shrine' loading='lazy' decoding='async' /><span>The Shrine</span></div>
                <div className='town-war-display-copy'><h4>Village War</h4><p className='town-war-display-status'>
                    {!primaryVillageWar ? 'No active village war' : preparing ? `Preparing against ${enemy}` : settling ? 'Final results settling' : `At war with ${enemy}`}</p>
                    {isCampaign ? <>
                        <p>{preparing ? `Starts in ${remaining(startsAt! - now)}` : settling ? 'Five-day campaign complete' : endsAt ? `Ends in ${remaining(endsAt - now)}` : 'Five-day campaign'}</p>
                        <VillageCampaignScoreSummary war={primaryVillageWar!} />
                        {!settling && <p className='town-war-display-schedule'>{shrineStatus}</p>}
                        {primaryVillageWar?.shrineWindows && <ShrineSchedule windows={primaryVillageWar.shrineWindows} />}
                    </> : primaryVillageWar ? <p>{village} · {primaryVillageWar.hp[village].toLocaleString()} / {villageWarHpMax(primaryVillageWar, village).toLocaleString()} HP</p>
                        : <p>A five-day clash between villages, won by War Points. The timed shrine is the main objective.</p>}
                    <div className='town-war-actions'><button type='button' className='town-war-control' onClick={() => setScreen('villageWar')}><GameArtIcon kind='attack' size={18} /> War Hall</button>
                        {isCampaign && !settling && <button type='button' className='town-war-control' aria-label='Choose war defense' onClick={onDefend}><GameArtIcon kind='roleDefender' size={18} /> War defense</button>}</div>
                    <details><summary>How village war works</summary><ol>
                        <li>Travel to the shrine’s sector during a scoring window and enter its golden shrine. The first {limit} victories award {rules.winPoints} {primaryVillageWar?.campaignVersion === 2 ? 'points' : 'extra points'} each, shared across both villages. Combat continues until closing. {primaryVillageWar?.campaignVersion !== 2 && 'Normal role victory points and enemy score deductions continue after the extra-point cap. '}The village with the most uncontested time earns {rules.controlBonus.toLocaleString()} points at closing. Empty and contested time does not count; tied or zero totals award no bonus. New declarations have one two-hour window per campaign day, five hours later each day. The locked schedule shows all opening and closing times in your local time.</li>
                        <li>Find the enemy’s three strongholds through Supply, Sabotage and Espionage. Each stronghold permits only its assigned combat, pet or card battle type.</li>
                        <li>From level 15, queue from Town Hall’s Guard tab to defend a matching stronghold and stay online and available. Attacking its ANBU calls a queued defender; strongholds use ANBU fallback when nobody can defend. Shrine fighters must physically enter the shrine.</li>
                        <li>Enemy player wins anywhere in the world count. Spars and ranked matches do not. PvE missions have personal daily caps and contribute at most 20% of the final score.</li>
                    </ol></details>
                </div>
            </article>
            <article className='town-war-display-card' aria-label='Sector war display'>
                <div className='town-war-display-sector-banner'><img src={WAR_CREST} width={80} height={80} alt='' loading='lazy' /><span>Hold the Border</span></div>
                <div className='town-war-display-copy'><h4>Sector Wars</h4>
                    <p className='town-war-display-status'>{!sectorMapOpen ? 'Sector operations unavailable' : contests === null ? readFailed ? 'Sector war status unavailable' : 'Checking sector wars…'
                        : `${activeContests.length} active sector war${activeContests.length === 1 ? '' : 's'}`}</p>
                    {sectorMapOpen && readFailed && contests !== null && <p role='status'>Refresh unavailable. Showing the last reported sector scores.</p>}
                    {sectorMapOpen && activeContests.length > 0 && <ul className='town-war-display-contests'>{activeContests.map(contest => {
                        const attacking = contest.attackerVillage === village;
                        return <li key={contest.id}><strong>Sector {contest.sector} · {contest.winCondition === 'combat' ? 'Shinobi combat' : contest.winCondition === 'pet' ? 'Pet battle' : 'Card battle'}</strong>
                            <span>{attacking ? 'Attacking' : 'Defending'} against {attacking ? contest.defenderVillage : contest.attackerVillage}</span>
                            <span>Our points {attacking ? contest.attackerPoints : contest.defenderPoints} · Enemy points {attacking ? contest.defenderPoints : contest.attackerPoints}</span>
                            <span>Closes in {remaining(contest.endsAt - now)}{contestVillageUnfed(contest, village) ? ' · Our village is unfed' : ''}</span></li>;
                    })}</ul>}
                    {sectorMapOpen && contests !== null && activeContests.length === 0 && <p>No sectors are contested by our village. Review the map for holdings and opportunities.</p>}
                    <div className='town-war-actions'><button type='button' className='town-war-control' onClick={() => setScreen('villageWarMap')} disabled={!sectorMapOpen} title={!sectorMapOpen ? sectorMapStatus : undefined}><GameArtIcon kind='worldMap' size={18} /> Sector Map</button></div>
                    {!sectorMapOpen && <p className='hint' role='status'>{sectorMapStatus}</p>}
                    <details><summary>How sector war works</summary><ol>
                        <li>The Kage declares a 72-hour contest over one enemy-held sector.</li>
                        <li>Fight in that sector’s chosen shinobi combat, pet or card mode. The most kill points at closing wins the sector; a tie keeps it with the defender.</li>
                        <li>Use the Sector Map to join battles and manage defenses. Combat sectors can offer an ANBU garrison assault after two hours without live player battles.</li>
                        <li>Donate Provisions and Materials in Treasury to support the war. The Kage manages structures and spending; ANBU can manage garrison feeding.</li>
                    </ol></details>
                </div>
            </article>
        </div>
    </section>;
}
