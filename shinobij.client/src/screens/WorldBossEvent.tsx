/* eslint-disable react-hooks/set-state-in-effect -- the screen polls server-owned event and matchmaking state; local clocks are presentation only. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Character, BattleHistoryEntry, VersionedCharacterCommit } from '../types/character';
import type { TowerHostLoadout, TowerSession } from '../lib/towers-api';
import { BattleTowerFight } from './BattleTowerFight';
import {
    fetchWorldBossEvent,
    depositWorldBossHollowShards,
    mutateWorldBossQueue,
    settleWorldBossEvent,
    type WorldBossEventClientState,
    type WorldBossSettlement,
} from '../lib/world-boss-event-api';
import { worldBossCrystalEffects, worldBossDefinition, WORLD_BOSS_ASHFALL_MS } from '../../../shared/world-boss-event';
import { sectorName } from '../../../shared/sector-geo';
import { visiblePoll } from '../lib/poll';
import '../styles/world-boss-event.css';

function formatClock(ms: number): string {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainder = seconds % 60;
    if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h`;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function eventStatusLabel(status: string, bossName: string): string {
    if (status === 'roaming') return 'Roaming the borderlands';
    if (status === 'final-stand') return `Final stand · ${bossName} holds its ground`;
    if (status === 'victory') return `${bossName} has fallen`;
    if (status === 'retreated') return `${bossName} has withdrawn`;
    if (status === 'stopped') return `${bossName} event has stopped`;
    return 'Awaiting the next muster';
}

type WorldBossRewardView = NonNullable<NonNullable<WorldBossEventClientState['queue']>['match']>['reward'];

function rewardLine(reward: WorldBossRewardView): string {
    if (!reward) return '';
    const contents = [...reward.itemIds.map(id => id.replace(/-/g, ' ')), ...(reward.gearDrop ? ['weapon or armor'] : [])];
    return `+${reward.ryo.toLocaleString()} Ryo · +${reward.statPoints} stats · +${reward.boneCharms} Bone Charms${contents.length ? ` · ${contents.join(' · ')}` : ''}`;
}

export function WorldBossEvent({
    character,
    currentSector,
    hostLoadout,
    sharedImages,
    onVersionedCharacter,
    onRecordBattle,
    onBack,
    backLabel = 'World map',
    worldBossTabs,
}: {
    character: Character;
    currentSector: number;
    hostLoadout?: TowerHostLoadout;
    sharedImages?: Record<string, string>;
    onVersionedCharacter: VersionedCharacterCommit;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    onBack: () => void;
    backLabel?: string;
    worldBossTabs?: ReactNode;
}) {
    const [view, setView] = useState<WorldBossEventClientState | null>(null);
    const [fight, setFight] = useState<{ runId: string; session: TowerSession } | null>(null);
    const [dismissedRunId, setDismissedRunId] = useState('');
    const [busy, setBusy] = useState(false);
    const [flash, setFlash] = useState('');
    const [receipt, setReceipt] = useState<WorldBossSettlement | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [serverOffset, setServerOffset] = useState(0);
    const appliedCacheSaveVersion = useRef(0);

    const refresh = useCallback(async () => {
        const next = await fetchWorldBossEvent(character.name);
        if (next) {
            const receivedAt = Date.now();
            if (next.character && Number.isSafeInteger(next._saveVersion)
                && Number(next._saveVersion) > appliedCacheSaveVersion.current) {
                const version = Number(next._saveVersion);
                if (onVersionedCharacter(next.character as unknown as Character, version)) appliedCacheSaveVersion.current = version;
            }
            setView(next);
            setNow(receivedAt);
            setServerOffset((next.serverNow || receivedAt) - receivedAt);
            const match = next.queue?.match;
            if (!fight && match?.status === 'active' && match.session && match.runId !== dismissedRunId) {
                setFight({ runId: match.runId, session: match.session });
            }
        }
    }, [character.name, dismissedRunId, fight, onVersionedCharacter]);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => visiblePoll(() => refresh(), fight ? 6_000 : 2_000, 0.08), [fight, refresh]);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 400);
        return () => window.clearInterval(timer);
    }, []);

    const event = view?.event ?? null;
    const boss = worldBossDefinition(event?.bossId);
    const bossName = event?.bossName ?? 'Roaming World Boss';
    const queue = view?.queue;
    const match = queue?.match ?? null;
    const serverNow = now + serverOffset;
    const atBoss = !!event && event.currentSector === currentSector;
    const queueClosesAt = queue?.queueClosesAt ?? null;
    const queueRemaining = queueClosesAt == null ? 0 : Math.max(0, queueClosesAt - serverNow);
    const rejoinRemaining = queue?.rejoinAfter == null ? 0 : Math.max(0, queue.rejoinAfter - serverNow);
    const eventRemaining = event ? Math.max(0, event.endsAt - serverNow) : 0;
    const hopRemaining = event ? event.movementPaused ? event.nextHopInMs : Math.max(0, event.nextHopInMs - (serverNow - (view?.serverNow ?? serverNow))) : 0;
    const hpPercent = event ? Math.max(0, Math.min(100, event.hp / Math.max(1, event.hpMax) * 100)) : 0;
    const crystalEffects = worldBossCrystalEffects(event?.hollowShardsDeposited ?? 0);
    const heldHollowShards = view?.personal?.hollowShardsHeld ?? 0;
    const activeMatch = match?.status === 'active' && match.session ? match : null;
    const ownReward = match?.reward ?? queue?.match?.reward;
    const receiptText = receipt?.rewardSummary || rewardLine(ownReward);
    const phaseCopy = useMemo(() => {
        if (event?.status === 'final-stand') return 'The creature has stopped moving. Every team can still challenge it until the event clock ends.';
        if (event?.status === 'roaming') return 'Follow its signal across the wild sectors. The next hop is shown on the map.';
        if (event?.status === 'victory') return 'Teams drove the creature back. Your shared contribution is recorded below.';
        if (event?.status === 'retreated') return 'The threat withdrew when the event clock expired. Your contribution remains on the record.';
        if (event?.status === 'stopped') return 'The event is closed. Contributions earned before closure remain recorded.';
        return 'A new world threat has not been called to the borderlands yet.';
    }, [event?.status]);
    const currentSectorLabel = event?.currentSector != null
        ? `Sector ${event.currentSector} · ${sectorName(event.currentSector) ?? 'Wilderness'}`
        : 'Position unknown';
    const locationDetails = event ? [
        event.movementPaused
            ? 'The boss holds its position while a team forms.'
            : event.destinationReached && event.targetVillage
                ? `At the outskirts of ${event.targetVillage}.`
                : phaseCopy,
        event.targetVillage && !event.destinationReached ? `Target: ${event.targetVillage}` : '',
        event.threatenedVillage ? `Threatened: ${event.threatenedVillage}` : '',
    ].filter(Boolean).join(' · ') : '';

    const mutateQueue = useCallback(async (action: 'join' | 'leave') => {
        if (busy) return;
        setBusy(true);
        setFlash('');
        const result = await mutateWorldBossQueue({ playerName: character.name, action, hostLoadout });
        if (!result.ok) setFlash(result.error ?? 'The queue could not be changed.');
        if (result.serverNow != null) {
            const receivedAt = Date.now();
            setNow(receivedAt);
            setServerOffset(result.serverNow - receivedAt);
        }
        if (result.queue) setView(current => current ? { ...current, queue: result.queue, serverNow: result.serverNow ?? current.serverNow } : current);
        await refresh();
        setBusy(false);
    }, [busy, character.name, hostLoadout, refresh]);

    async function depositCrystals() {
        if (busy || !event?.eventId || heldHollowShards < 1) return;
        setBusy(true);
        setFlash('');
        const result = await depositWorldBossHollowShards({ eventId: event.eventId, playerName: character.name });
        if (!result.ok) setFlash(result.error ?? 'The Hollow Shards could not be turned in.');
        else setFlash('Turned in ' + (result.deposited ?? 0) + ' Hollow Shards for ' + (result.points ?? 0).toLocaleString() + ' contribution points.');
        await refresh();
        setBusy(false);
    }

    const settle = useCallback(async (runId: string, playerName: string) => {
        const result = await settleWorldBossEvent(runId, playerName);
        setReceipt(result);
        await refresh();
        return result;
    }, [refresh]);

    if (fight) {
        return <BattleTowerFight
            character={character}
            onVersionedCharacter={onVersionedCharacter}
            sharedImages={sharedImages}
            hostLoadout={hostLoadout}
            runId={fight.runId}
            initialSession={fight.session}
            onExit={() => { setDismissedRunId(fight.runId); setFight(null); void refresh(); }}
            onLeaveActive={() => { setDismissedRunId(fight.runId); setFight(null); void refresh(); }}
            onRecordBattle={onRecordBattle}
            settleFn={settle}
            settleOnAnyDone
            variant="world-boss"
            enemyAvatarOverride={boss.keyArt}
        />;
    }

    return <main className="world-boss-event-screen">
        <div className="world-boss-event-backdrop" aria-hidden="true" />
        <header className="world-boss-event-topbar">
            <button type="button" className="world-boss-back" onClick={onBack}>← {backLabel}</button>
            <div className="world-boss-topbar-mark"><span /> WORLD EVENT</div>
            {event?.active && <div className="world-boss-live"><i /> LIVE</div>}
        </header>
        {worldBossTabs && <div className="world-boss-event-tabs">{worldBossTabs}</div>}

        <section className="world-boss-hero" aria-labelledby="world-boss-title" style={{ backgroundImage: `linear-gradient(90deg, rgba(4, 8, 17, .96) 0%, rgba(4, 8, 17, .72) 44%, rgba(4, 8, 17, .22) 100%), url("${boss.keyArt}")` }}>
            <div className="world-boss-hero-copy">
                <p className="world-boss-kicker">THE FOUR-VILLAGE MUSTER</p>
                <h1 id="world-boss-title">{bossName}</h1>
                <p className="world-boss-subtitle">One threat on the road. Three shinobi in the field. A world that answers together.</p>
                <p className="world-boss-trait"><strong>{boss.traitName}:</strong> {boss.traitDescription}</p>
                <div className="world-boss-status-line"><span className={`world-boss-status-dot status-${event?.status ?? 'idle'}`} />{eventStatusLabel(event?.status ?? '', bossName)}</div>
            </div>
            <div className="world-boss-hero-fade" />
            <div className="world-boss-hero-tag"><strong>72</strong><span>HOUR<br />MUSTER</span></div>
        </section>

        <div className="world-boss-event-content">
            {!event && <section className="world-boss-empty"><span className="world-boss-empty-icon">✦</span><h2>No active muster</h2><p>{phaseCopy}</p></section>}

            {event && <>
                <section className="world-boss-vitals" aria-label="Shared boss status">
                    <div className="world-boss-vitals-head">
                        <div><span className="world-boss-section-label">SHARED THREAT</span><strong>{event.hp.toLocaleString()} <small>/ {event.hpMax.toLocaleString()} HP</small></strong></div>
                        <div className="world-boss-clock"><span>EVENT CLOSES IN</span><strong>{formatClock(eventRemaining)}</strong></div>
                    </div>
                    <div className="world-boss-hp-track"><span style={{ width: `${hpPercent}%` }} /></div>
                    <div className="world-boss-location">
                        <span className="world-boss-location-icon">⌖</span>
                        <div>
                            <strong>{currentSectorLabel}</strong>
                            <span>{locationDetails}</span>
                        </div>
                        <div className="world-boss-hop">
                            {event.status === 'roaming' ? <>
                                <span>{event.movementPaused ? 'POSITION HELD' : event.destinationReached ? 'TARGET REACHED' : 'NEXT SIGNAL'}</span>
                                <strong>{event.movementPaused
                                    ? 'Team forming'
                                    : event.destinationReached
                                        ? event.targetVillage ?? 'Village outskirts'
                                        : `Sector ${event.nextSector ?? event.currentSector}`}</strong>
                                <small>{event.movementPaused
                                    ? 'Movement resumes when the queue clears'
                                    : event.destinationReached
                                        ? 'Holding at the village approach'
                                        : `Moves in ${formatClock(hopRemaining)}`}</small>
                            </> : <>
                                <span>TEAMS ASSEMBLED</span>
                                <strong>{event.participantCount.toLocaleString()}</strong>
                            </>}
                        </div>
                    </div>
                </section>

                <section className="world-boss-crystal-progress" aria-label="Hollow Shard deposit meter and boss weakening">
                    <div className="world-boss-crystal-summary">
                        <span className="world-boss-section-label">HOLLOW SHARDS · WORLD METER</span>
                        <strong>{event.hollowShardsDeposited}/{event.crystalNodeCount} deposited · {event.crystalNodesMined}/{event.crystalNodeCount} mined</strong>
                        <small>Every 6 turned in fills one tier · 1,000 contribution points per shard.</small>
                    </div>
                    <div className="world-boss-tier-meter" role="progressbar" aria-label="Hollow Shard weakening tiers"
                        aria-valuemin={0} aria-valuemax={crystalEffects.maxTiers}
                        aria-valuenow={crystalEffects.filledTiers + crystalEffects.tierProgressShards / crystalEffects.shardsPerTier}
                        aria-valuetext={crystalEffects.filledTiers + ' of ' + crystalEffects.maxTiers + ' tiers filled'}>
                        {Array.from({ length: crystalEffects.maxTiers }, (_, index) => {
                            const filled = index < crystalEffects.filledTiers;
                            const current = index === crystalEffects.filledTiers && crystalEffects.tierProgressShards > 0;
                            const width = filled ? 100 : current ? crystalEffects.tierProgressShards / crystalEffects.shardsPerTier * 100 : 0;
                            return <span key={index} className={'world-boss-tier' + (filled ? ' is-filled' : '') + (current ? ' is-current' : '')}>
                                <i style={{ width: width + '%' }} />
                            </span>;
                        })}
                    </div>
                    <div className="world-boss-crystal-effects">
                        <span>Tier {crystalEffects.filledTiers}/{crystalEffects.maxTiers} · boss deals <b>−{crystalEffects.damageDealtReductionPct}%</b></span>
                        <span>Boss takes <b>+{crystalEffects.damageReceivedBonusPct}%</b> damage · {crystalEffects.shardsToNextTier > 0 ? 'next tier in ' + crystalEffects.shardsToNextTier + ' shards' : 'maximum weakening reached'}</span>
                    </div>
                    <div className="world-boss-crystal-turnin">
                        <div><strong>You hold {heldHollowShards} Hollow Shards</strong><small>Turn them in here for leaderboard points.</small></div>
                        <button type="button" className="world-boss-secondary world-boss-deposit" disabled={busy || heldHollowShards < 1 || !event.active} onClick={() => void depositCrystals()}>
                            {event.active ? heldHollowShards > 0 ? 'Turn in ' + heldHollowShards + ' Hollow Shards' : 'No Hollow Shards to turn in' : 'Turn-ins closed'}
                        </button>
                    </div>
                    {event.threatenedVillage && event.status === 'final-stand' && <p>If the boss survives the event clock, {event.threatenedVillage} receives Ashfall for 24 hours: 5% lower training gains and 5% longer jutsu lessons.</p>}
                    {event.threatenedVillage && event.status === 'retreated' && <p className="is-failed">{event.threatenedVillage} received Ashfall until {new Date(event.retreatPenaltyUntil || (event.endsAt + WORLD_BOSS_ASHFALL_MS)).toLocaleString()}.</p>}
                </section>

                <section className="world-boss-play-grid">
                    <article className="world-boss-queue-card">
                        <div className="world-boss-card-overline">FIELD PARTY · CROSS-VILLAGE</div>
                        <h2>Answer the call</h2>
                        <p>Join the public queue at the boss's current sector. The squad launches when three players are ready. If the queue stays quiet, its 30-second timer releases a team of one or two.</p>
                        <div className="world-boss-party-slots" aria-label="Up to three players per team">
                            {[0, 1, 2].map(index => <span key={index} className={index < Math.min(3, queue?.waitingCount ?? 0) ? 'filled' : ''}>{index + 1}</span>)}
                            <span className="world-boss-party-caption">MAX 3 PLAYERS</span>
                        </div>
                        {queue?.queued && <div className="world-boss-queue-countdown"><span className="world-boss-spinner" /><div><strong>Finding your team</strong><span>{queue.waitingCount} shinobi in the queue · {event.movementPaused ? 'boss location held' : 'boss remains at this sector'} · launches in {formatClock(queueRemaining)}</span></div></div>}
                        {!queue?.queued && rejoinRemaining > 0 && <div className="world-boss-inline-message" role="status">Leaving ended PvP protection. You can rejoin the world boss queue in {formatClock(rejoinRemaining)}.</div>}
                        {match?.status === 'preparing' && <div className="world-boss-queue-countdown"><span className="world-boss-spinner" /><div><strong>Team assembled</strong><span>Sealing the encounter and loading the squad.</span></div></div>}
                        {match?.status === 'cancelled' && <div className="world-boss-inline-message">{match.error ?? 'That team could not be started. Queue again when ready.'}</div>}
                        {!atBoss && event.active && <div className="world-boss-travel-note">Travel to Sector {event.currentSector} to join the queue. The map marker shows the boss's live position.</div>}
                        {flash && <div className="world-boss-inline-message" role="status">{flash}</div>}
                        {activeMatch && activeMatch.runId === dismissedRunId && <button className="world-boss-primary" onClick={() => setFight({ runId: activeMatch.runId, session: activeMatch.session! })}>Resume team fight <span>→</span></button>}
                        {(!queue?.queued && !activeMatch && event.active) && <button className="world-boss-primary" disabled={!atBoss || busy || rejoinRemaining > 0} onClick={() => void mutateQueue('join')}>{busy ? 'Joining…' : rejoinRemaining > 0 ? `Rejoin in ${formatClock(rejoinRemaining)}` : atBoss ? 'Join the team queue' : 'Find the boss on the map'} <span>→</span></button>}
                        {queue?.queued && <button className="world-boss-secondary" disabled={busy} onClick={() => void mutateQueue('leave')}>Leave queue</button>}
                        {match?.status === 'active' && match.session && match.runId !== dismissedRunId && <button className="world-boss-primary" onClick={() => setFight({ runId: match.runId, session: match.session! })}>Enter your team fight <span>→</span></button>}
                        {receiptText && <div className="world-boss-receipt" role="status"><span>✦</span><div><strong>Raid reward secured</strong><p>{receiptText}</p></div></div>}
                    </article>

                    <article className="world-boss-contribution-card">
                        <div className="world-boss-card-overline">YOUR CONTRIBUTION</div>
                        <div className="world-boss-contribution-number">{(view?.personal?.damage ?? 0).toLocaleString()}<span>damage</span></div>
                        <div className="world-boss-contribution-stats">
                            <div><strong>{(view?.personal?.points ?? 0).toLocaleString()}</strong><span>contribution points</span></div>
                            <div><strong>{view?.personal?.hollowShardsDeposited ?? 0}</strong><span>shards turned in</span></div>
                            <div><strong>{view?.personal?.matches ?? 0}</strong><span>team fights</span></div>
                        </div>
                        {view?.personalRank && <div className="world-boss-rank-reveal">{event.active ? 'LIVE RANK' : 'FINAL RANK'} <strong>#{view.personalRank}</strong></div>}
                        {event.status === 'victory' && view?.personal?.hollowBeastCacheRank != null && <div className="world-boss-rank-reveal">TOP 15 HOLLOW BEAST CACHE <strong>#{view.personal.hollowBeastCacheRank}</strong> · {view.personal.hollowBeastCacheAwarded ? 'delivered' : 'delivery pending'}</div>}
                        {event.status === 'victory' && event.topCachesPending && <div className="world-boss-inline-message">Top 15 cache awards are being finalized after active team fights settle, with a six-hour recovery window.</div>}
                        {event.status === 'victory' && event.topCacheSnapshotExpired && <div className="world-boss-inline-message">Cache awards were locked after the six-hour recovery window; later team results remain on the leaderboard.</div>}
                    </article>
                </section>

                <section className="world-boss-reward-strip">
                    <div className="world-boss-reward-heading"><span>✦</span><div><strong>Raid rewards</strong><small>Contribution reward for meaningful combat or support; if defeated, the top 15 at final cache lock also receive a Hollow Beast Cache</small></div></div>
                    <div className="world-boss-reward-list"><span>Boss Core</span><span>Ryo</span><span>Stat points</span><span>Bone Charms</span><span>High-end material</span><span className="chance">Chance for weapon or armor</span></div>
                </section>

                {view?.standings && <section className="world-boss-standings">
                    <div className="world-boss-standings-title"><div><span className="world-boss-section-label">CONTRIBUTION LEADERBOARD</span><h2>Damage and Hollow Shard points</h2></div><span>{event.active ? 'LIVE STANDINGS' : 'FINAL RESULTS'}</span></div>
                    <div className="world-boss-standings-grid">
                        <div><h3>Shinobi · {event.status === 'victory' ? event.topCachesPending ? 'cache ranking pending' : 'cache recipients' : event.active ? 'projected top 15' : 'final standings'}</h3>{view.standings.individual.length ? view.standings.individual.slice(0, 15).map(row => <p key={row.name}><span>{row.rank.toString().padStart(2, '0')} · {row.name}<small>{row.damage.toLocaleString()} damage · {row.crystalPoints.toLocaleString()} shard pts · {row.supportPoints.toLocaleString()} support pts</small></span><strong>{row.points.toLocaleString()} pts</strong></p>) : <p><span>No contributions yet</span></p>}</div>
                        <div><h3>Villages</h3>{view.standings.villages.length ? view.standings.villages.map(row => <p key={row.name}><span>{row.rank.toString().padStart(2, '0')} · {row.name}<small>{row.damage.toLocaleString()} damage · {row.crystalPoints.toLocaleString()} shard pts · {row.supportPoints.toLocaleString()} support pts</small></span><strong>{row.points.toLocaleString()} pts</strong></p>) : <p><span>No village totals yet</span></p>}</div>
                        <div><h3>Clans</h3>{view.standings.clans.length ? view.standings.clans.slice(0, 5).map(row => <p key={row.name}><span>{row.rank.toString().padStart(2, '0')} · {row.name}<small>{row.damage.toLocaleString()} damage · {row.crystalPoints.toLocaleString()} shard pts · {row.supportPoints.toLocaleString()} support pts</small></span><strong>{row.points.toLocaleString()} pts</strong></p>) : <p><span>No clan totals yet</span></p>}</div>
                    </div>
                </section>}
            </>}
        </div>
    </main>;
}
