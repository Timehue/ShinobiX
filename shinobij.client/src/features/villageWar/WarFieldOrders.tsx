import type { CampaignView, CampaignFieldMissionView, WarOperation } from '../../../../shared/village-war-campaign';
import { WAR_INTEL_MAX, WAR_INTEL_THRESHOLDS, WAR_OPERATION_CAPS, WAR_OPERATION_REWARDS } from '../../../../shared/village-war-campaign';
import { supportPoints } from '../../../../shared/war-preparations';
const labels = { supply: 'Supply', sabotage: 'Sabotage', espionage: 'Espionage' } as const;
export function FieldMissionSummary({ mission }: { mission: CampaignFieldMissionView }) {
    const active = mission.status === 'active';
    const target = mission.kind === 'supply' && !mission.pickedUp ? mission.pickupSector : mission.sectors.find(s => !mission.completedSectors.includes(s));
    return <div className='war-field-mission' aria-label='Your field order'>
        <strong>{labels[mission.kind]} · {active ? 'In progress' : mission.status}</strong>
        {active && <>
            <p>{mission.kind === 'espionage' ? mission.insideStronghold ? 'Defeat the stronghold sentry or an enemy player inside to recover intelligence.' : `Enter the enemy stronghold in Sector ${target} and defeat its sentry or an enemy player inside.`
                : mission.kind === 'supply' ? !mission.pickedUp ? `Collect the sealed package at your village outskirts, Sector ${target}. Stand still for 10 seconds.`
                    : `Package collected. Deliver it to the allied depot in Sector ${target}. Stand still for 20 seconds.`
                : `Disrupt 3 distinct enemy-held sectors. Stand still outside for 20 seconds in each. ${mission.completedSectors.length}/3 complete.`}</p>
            {mission.kind === 'sabotage' && <small>Eligible sectors: {mission.sectors.map(s => `${s}${mission.completedSectors.includes(s) ? ' ✓' : ''}`).join(' · ')}</small>}
            {mission.holdRequired > 0 && <><progress aria-label='Stationary objective progress' max={mission.holdRequired} value={Math.min(mission.holdSeconds, mission.holdRequired)} /><small>{Math.min(mission.holdSeconds, mission.holdRequired)}/{mission.holdRequired} seconds · Movement, travel, combat or a lost connection resets this hold.</small></>}
        </>}
        {mission.status === 'complete' && <p>Order complete · {mission.earnedPoints ?? WAR_OPERATION_REWARDS[mission.kind].points} support points earned · +{mission.earnedIntel ?? WAR_OPERATION_REWARDS[mission.kind].intel} shared intel.</p>}
        {mission.status === 'failed' && <p>Order failed. Its daily attempt remains used.</p>}
    </div>;
}
export function WarFieldOrders({ campaign, mission, name, busy, live, command }: {
    campaign: CampaignView; mission: CampaignFieldMissionView | null; name: string; busy: boolean; live: boolean;
    command: (action: string, extra?: Record<string, unknown>) => Promise<void>;
}) {
    const usage = campaign.operationAllowance;
    const playerKey = name.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    const personal = Object.hasOwn(usage.players, playerKey) ? usage.players[playerKey] : undefined;
    return <section className='war-field-orders' aria-label='Field missions and intelligence'>
        <h4>Shared war intelligence</h4>
        <div className='war-intel-heading'><strong>{campaign.intel}/{WAR_INTEL_MAX} intel</strong><span>{3 - campaign.hiddenStrongholds}/3 enemy strongholds identified</span></div>
        <progress aria-label='Shared war intelligence' max={WAR_INTEL_MAX} value={campaign.intel} />
        <div className='war-intel-milestones'>{WAR_INTEL_THRESHOLDS.map((threshold, i) => <span key={threshold} data-revealed={campaign.intel >= threshold}>{threshold} · Stronghold {i + 1} {campaign.intel >= threshold ? 'revealed' : 'unknown'}</span>)}</div>
        <p>Each reveal identifies the sector, its PvP / pet / card specialty, scoring progress and defense availability. Enemy assignments stay hidden until your village earns enough intel.</p>
        <h4>Field missions</h4>
        <p>Your attempts today: {personal?.total ?? 0}/{WAR_OPERATION_CAPS.player}. Resets {new Date(campaign.operationResetAt).toLocaleString()}.</p>
        <div className='village-campaign-grid'>{(['supply', 'sabotage', 'espionage'] as WarOperation[]).map(kind => {
            const typeCaps = WAR_OPERATION_CAPS.byType[kind];
            const disabled = busy || !live || mission?.status === 'active' || (personal?.total ?? 0) >= WAR_OPERATION_CAPS.player
                || (personal?.categories[kind] ?? 0) >= typeCaps.player;
            return <article className='war-operation-card' key={kind}><h5>{labels[kind]}</h5>
                <p>{kind === 'supply' ? 'Collect a package at your village outskirts, then deliver it to an allied field depot.' : kind === 'sabotage' ? 'Hold 3 different enemy-controlled sectors or village outskirts for 20 seconds each.' : 'Enter an assigned enemy stronghold and defeat its sentry or an enemy player inside.'}</p>
                <strong>{supportPoints(WAR_OPERATION_REWARDS[kind].points, campaign.supportTiers?.warAcademy ?? 0)} support points · +{WAR_OPERATION_REWARDS[kind].intel} intel</strong>
                {kind === 'espionage' && !!campaign.supportTiers?.watchtower && <small>Watchtower: +{campaign.supportTiers.watchtower} intel on your first successful Espionage order today{campaign.espionageBonusUsed ? ' · bonus already used' : ''}.</small>}
                <small>You {personal?.categories[kind] ?? 0}/{typeCaps.player} attempts</small>
                <button disabled={!!disabled} onClick={() => void command('operation-start', { operation: kind })}>Accept {labels[kind]}</button>
            </article>;
        })}</div>
        {mission && <><FieldMissionSummary mission={mission} />{mission.status === 'active' && <button disabled={busy || !!mission.battleRunId} onClick={() => void command('operation-abandon', { missionId: mission.id })}>Abandon order</button>}</>}
        <p>Travel on the World Map to advance your order. One field order at a time. Attempts are spent on acceptance; abandoning or losing does not refund them. ANBU fallback assaults share the Sabotage allowance. Support points count up to 20% of the final war score.</p>
    </section>;
}
