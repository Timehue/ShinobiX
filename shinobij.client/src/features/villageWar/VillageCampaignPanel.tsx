import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../../types/character';
import type { CampaignView, CampaignObjective, CampaignFieldMissionView } from '../../../../shared/village-war-campaign';
import { WarFieldOrders } from './WarFieldOrders';
import { ShrineControlTimes } from './ShrineControlTimes';
import { ShrineSchedule } from './ShrineSchedule';
import { shrineRules } from '../../../../shared/village-war-campaign';
import { campaignRequest, currentVillageCampaign, type CampaignBattle } from '../../lib/village-war-campaign';
import { visiblePoll } from '../../lib/poll';
import './village-campaign.css';
const Battle = lazy(() => import('./VillageCampaignBattle'));
const duration = (ms: number) => `${Math.max(0, Math.floor(ms / 3_600_000))}h ${Math.max(0, Math.floor(ms / 60_000) % 60)}m`;
export function VillageCampaignPanel({ character, warId: initialWarId, sharedImages = {}, onVersionedCharacter,
    defenseOnly = false, sector, onExit }: {
    character: Character; warId?: string; sharedImages?: Record<string, string>; onVersionedCharacter: VersionedCharacterCommit;
    defenseOnly?: boolean; sector?: number; onExit?: () => void;
}) {
    const [warId, setWarId] = useState(initialWarId ?? '');
    const [campaign, setCampaign] = useState<CampaignView | null>(null);
    const [mission, setMission] = useState<CampaignFieldMissionView | null>(null);
    const [defense, setDefense] = useState('');
    const [run, setRun] = useState<CampaignBattle | null>(null);
    const [battle, setBattle] = useState<CampaignBattle | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const refresh = useCallback(async () => {
        try {
            let id = initialWarId || '';
            const found = id ? { warId: id, response: await campaignRequest(character.name, id, 'view') }
                : await currentVillageCampaign(character.name, character.village);
            if (!found) { setCampaign(null); setWarId(''); setDefense(''); setRun(null); return; }
            id = found.warId; setWarId(id); setCampaign(found.response.campaign ?? null);
            setMission(found.response.mission ?? null);
            setDefense(found.response.defense?.objectiveId ?? ''); setRun(found.response.run ?? null);
            setNow(Date.now());
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'War unavailable.'); }
    }, [character.name, character.village, initialWarId]);
    useEffect(() => visiblePoll(refresh, 10_000, 0.1, { immediate: true }), [refresh]);
    useEffect(() => {
        if (!defense || !warId) return;
        return visiblePoll(() => campaignRequest(character.name, warId, 'defend', { objectiveId: defense }).catch(() => undefined), 60_000);
    }, [character.name, warId, defense]);
    async function command(action: string, extra: Record<string, unknown> = {}) {
        if (busy) return;
        setBusy(true); setError('');
        try {
            const response = await campaignRequest(character.name, warId, action, extra);
            if (response.runId) setBattle(response);
            await refresh();
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'War action failed.'); }
        finally { setBusy(false); }
    }
    if (battle) return <Suspense fallback={<p>Loading the battle…</p>}><Battle key={battle.runId} character={character}
        warId={warId} run={battle} sharedImages={sharedImages} onVersionedCharacter={onVersionedCharacter}
        onBack={() => { setBattle(null); void refresh(); }} /></Suspense>;
    if (!campaign) return defenseOnly ? null : <p>{error || (warId ? 'Loading village war objectives…' : 'No active village campaign. Field orders become available during a village war.')}</p>;
    const live = now >= campaign.startsAt && now < campaign.endsAt;
    const ended = now >= campaign.endsAt;
    const currentShrine = campaign.shrine.find(o => now < o.closesAt);
    const rules = shrineRules(campaign);
    function objectiveCard(objective: CampaignObjective) {
        const own = objective.village === character.village;
        const locked = now < objective.opensAt;
        const closed = now >= objective.closesAt || (!!objective.village && objective.bouts >= objective.limit);
        if (!objective.village) return <article className='village-campaign-objective' key={objective.id} aria-label='War shrine overview'>
            <div className='village-campaign-shrine-layout'>
                <div>
                    <span className='village-campaign-mode'>Shinobi PvP</span>
                    <h4>War Shrine · Sector {objective.sector}</h4>
                    <p>{closed ? 'Scoring complete' : locked ? `Locked · opens in ${duration(objective.opensAt - now)}` : `Open · closes in ${duration(objective.closesAt - now)}`}</p>
                    <small>Travel to Sector {objective.sector} and enter its golden shrine from the sector map. Town Hall shows the shrine's status only.</small>
                </div>
                <img className='village-campaign-art village-campaign-shrine-art' src='/ui/village-war/war-shrine-landmark-gold-v1.webp'
                    width={512} height={384} alt='Golden war shrine' loading='lazy' decoding='async' />
                <div className='village-campaign-shrine-stats'>
                    <p>{objective.bouts}/{objective.limit} {campaign!.version === 3 ? 'extra-point victories' : 'scored live battles'}</p>
                    <small>{rules.winPoints} {campaign!.version === 3 ? 'extra points' : 'points'} per win · First {objective.limit} shared wins</small>
                    {campaign!.version === 3 && <small>Normal role victory points and enemy score deductions continue after the extra-point cap.</small>}
                    <h5>Uncontested control time</h5>
                    <ShrineControlTimes objective={objective} villages={Object.keys(campaign!.scores)} />
                    <small>{rules.controlBonus.toLocaleString()} points for the most uncontested time at closing. Tied or zero totals award no bonus.</small>
                </div>
            </div>
        </article>;
        return <article className='village-campaign-objective' key={objective.id}>
            <img className='village-campaign-art' src={`/ui/village-war/stronghold-${objective.mode}-v1.webp`}
                width={640} height={360} alt='' loading='lazy' decoding='async' />
            <span className='village-campaign-mode'>{objective.mode === 'combat' ? 'Shinobi PvP' : objective.mode === 'pet' ? 'Pet battles only' : 'Card battles only'}</span>
            <h4>{objective.village ? `${own ? 'Our' : 'Enemy'} stronghold · Sector ${objective.sector}` : `War Shrine · Sector ${objective.sector}`}</h4>
            <p>{closed ? 'Scoring complete' : locked ? `Locked · opens in ${duration(objective.opensAt - now)}` : `Open · closes in ${duration(objective.closesAt - now)}`}</p>
            <p>{objective.bouts}/{objective.limit} scored live battles</p>
            {objective.village && own && <button disabled={busy || ended || closed || !live}
                onClick={() => void command(defense === objective.id ? 'dequeue' : 'defend', { objectiveId: objective.id })}>
                {defense === objective.id ? 'Leave defense queue' : 'Queue to defend'}</button>}
            {!defenseOnly && !own && objective.village && sector === objective.sector && <button disabled={busy || closed || locked || !live}
                onClick={() => void command('start', { objectiveId: objective.id })}>{objective.village ? 'Attack the ANBU defense' : 'Contest the shrine'}</button>}
            {objective.village && !own && <small>Travel to Sector {objective.sector} and enter its stronghold. A queued player takes the defense; otherwise its ANBU stands in.</small>}
        </article>;
    }
    return <section className='village-campaign' aria-label='Village war campaign'>
        <h3>{defenseOnly ? 'Village War Defense' : 'Five-day Village War'}</h3>
        {defenseOnly && <p>Choose a battle type below. Your queue lasts up to 24 hours; you must stay online and available to be dispatched.</p>}
        <p>{ended ? 'War finished. Final results are being settled.' : live ? `War ends in ${duration(campaign.endsAt - now)}` : `War starts in ${duration(campaign.startsAt - now)}`}</p>
        {error && <p role='alert' className='village-campaign-error'>{error}</p>}
        {run && <div className='village-campaign-resume'><span>{run.status === 'done' ? 'Previous battle' : 'Battle assigned'} · {run.mode}</span>
            <button onClick={() => setBattle(run)}>{run.status === 'done' ? 'View battle' : 'Enter battle'}</button></div>}
        {!defenseOnly && <>
            <div className='village-campaign-scores'>{Object.entries(campaign.scores).map(([village, score]) => <article key={village}>
                <strong>{village}</strong><b>{score.total.toLocaleString()} War Points</b><small>{score.pvp} PvP + {score.pve} PvE ({score.rawPve} earned)</small>
            </article>)}</div>
            <p>Enemy player victories anywhere in the world count. Spars and ranked matches are excluded. PvE can provide up to 20% of your total score.</p>
        </>}
        {sector === undefined && currentShrine && <><h4>The central War Shrine</h4>{objectiveCard(currentShrine)}
            {!defenseOnly && <p>Five daily windows · First {currentShrine.limit} wins award {rules.winPoints} {campaign.version === 3 ? 'extra points' : 'points'} each · Combat continues until closing · {rules.controlBonus.toLocaleString()} points for the village with the most uncontested time.</p>}</>}
        {sector === undefined && !defenseOnly && <ShrineSchedule windows={campaign.shrine} />}
        <h4>{defenseOnly ? 'Choose a stronghold to defend' : 'Sector strongholds'}</h4>
        <div className='village-campaign-grid'>{campaign.strongholds.filter(o => (sector === undefined || o.sector === sector) && (!defenseOnly || o.village === character.village)).map(objectiveCard)}</div>
        {!defenseOnly && sector === undefined && <>
            <WarFieldOrders campaign={campaign} mission={mission} name={character.name} busy={busy} live={live} command={command} />
        </>}
        {onExit && <button onClick={onExit}>Leave stronghold</button>}
    </section>;
}
