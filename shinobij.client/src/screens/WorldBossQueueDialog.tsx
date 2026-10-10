/* eslint-disable react-hooks/set-state-in-effect -- refreshes server-authoritative queue state on open and while waiting. */
import { useCallback, useEffect, useState } from 'react';
import type { BattleHistoryEntry, Character, VersionedCharacterCommit } from '../types/character';
import type { TowerHostLoadout } from '../lib/towers-api';
import { BattleTowerFight } from './BattleTowerFight';
import {
    fetchWorldBossEvent,
    mutateWorldBossQueue,
    settleWorldBossEvent,
    type WorldBossEventClientState,
} from '../lib/world-boss-event-api';
import { WORLD_BOSS_QUEUE_REJOIN_COOLDOWN_MS, worldBossDefinition } from '../../../shared/world-boss-event';
import { sectorName } from '../../../shared/sector-geo';
import { visiblePoll } from '../lib/poll';
import '../styles/world-boss-queue-dialog.css';

function formatQueueClock(ms: number): string {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function WorldBossQueueDialog({
    character,
    currentSector,
    hostLoadout,
    sharedImages,
    onVersionedCharacter,
    onRecordBattle,
    onClose,
}: {
    character: Character;
    currentSector: number;
    hostLoadout?: TowerHostLoadout;
    sharedImages?: Record<string, string>;
    onVersionedCharacter: VersionedCharacterCommit;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    onClose: () => void;
}) {
    const [view, setView] = useState<WorldBossEventClientState | null>(null);
    const [fight, setFight] = useState<{ runId: string; session: NonNullable<NonNullable<WorldBossEventClientState['queue']>['match']>['session'] } | null>(null);
    const [dismissedRunId, setDismissedRunId] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [now, setNow] = useState(() => Date.now());
    const [serverOffset, setServerOffset] = useState(0);

    const refresh = useCallback(async () => {
        const next = await fetchWorldBossEvent(character.name);
        if (!next) return;
        const receivedAt = Date.now();
        setView(next);
        setNow(receivedAt);
        setServerOffset((next.serverNow || receivedAt) - receivedAt);
        const match = next.queue?.match;
        if (!fight && match?.status === 'active' && match.session && match.runId !== dismissedRunId) {
            setFight({ runId: match.runId, session: match.session });
        }
    }, [character.name, dismissedRunId, fight]);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => visiblePoll(() => refresh(), fight ? 6_000 : 2_000, 0.08), [fight, refresh]);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 300);
        return () => window.clearInterval(timer);
    }, []);
    useEffect(() => {
        if (fight) return;
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [fight, onClose]);

    const event = view?.event ?? null;
    const queue = view?.queue;
    const match = queue?.match ?? null;
    const boss = worldBossDefinition(event?.bossId);
    const serverNow = now + serverOffset;
    const atBoss = !!event && event.currentSector === currentSector;
    const queueRemaining = queue?.queueClosesAt == null ? 0 : Math.max(0, queue.queueClosesAt - serverNow);
    const rejoinRemaining = queue?.rejoinAfter == null ? 0 : Math.max(0, queue.rejoinAfter - serverNow);
    const rejoinCooldownMinutes = Math.ceil(WORLD_BOSS_QUEUE_REJOIN_COOLDOWN_MS / 60_000);
    const hpPercent = event ? Math.max(0, Math.min(100, event.hp / Math.max(1, event.hpMax) * 100)) : 0;
    const activeMatch = match?.status === 'active' && match.session ? match : null;

    async function changeQueue(action: 'join' | 'leave') {
        if (busy) return;
        setBusy(true);
        setMessage('');
        const result = await mutateWorldBossQueue({ playerName: character.name, action, hostLoadout });
        if (!result.ok) setMessage(result.error ?? 'The queue could not be changed.');
        if (result.queue) setView(current => current ? { ...current, queue: result.queue, serverNow: result.serverNow ?? current.serverNow } : current);
        await refresh();
        setBusy(false);
    }

    const settle = useCallback((runId: string, playerName: string) => settleWorldBossEvent(runId, playerName), []);

    if (fight?.session) {
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

    return <div className="world-boss-queue-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
        <section className="world-boss-queue-dialog" role="dialog" aria-modal="true" aria-labelledby="world-boss-queue-title">
            <header className="world-boss-queue-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(5, 12, 22, .97), rgba(5, 12, 22, .69) 62%, rgba(5, 12, 22, .22)), url("${boss.keyArt}")` }}>
                <button type="button" className="world-boss-queue-close" aria-label="Close team queue" onClick={onClose}>×</button>
                <span className="world-boss-queue-kicker">WORLD BOSS · FIELD PARTY</span>
                <h2 id="world-boss-queue-title">{event?.bossName ?? boss.name}</h2>
                <p>{boss.traitName} · {boss.traitDescription}</p>
            </header>

            <div className="world-boss-queue-body">
                {!event && <div className="world-boss-queue-empty"><strong>Checking the world signal…</strong><span>Queue status will appear here.</span></div>}
                {event && <>
                    <div className="world-boss-queue-vitals">
                        <div><span>SHARED BOSS HEALTH</span><strong>{event.hp.toLocaleString()} <small>/ {event.hpMax.toLocaleString()} HP</small></strong></div>
                        <div className="world-boss-queue-sector"><span>CURRENT SECTOR</span><strong>{event.currentSector != null ? `${event.currentSector} · ${sectorName(event.currentSector) ?? 'Wild sector'}` : 'Location unknown'}</strong></div>
                    </div>
                    <div className="world-boss-queue-health"><span style={{ width: `${hpPercent}%` }} /></div>
                    {event.movementPaused && <div className="world-boss-queue-held"><span>⌖</span> The boss is holding position while a team forms.</div>}

                    <p className="world-boss-queue-instructions">Form a team of up to three. If fewer players are waiting, the 30-second timer launches a team of one or two.</p>

                    <div className="world-boss-queue-slots" aria-label={`${Math.min(3, queue?.waitingCount ?? 0)} of 3 players waiting`}>
                        {[0, 1, 2].map(index => <span key={index} className={index < Math.min(3, queue?.waitingCount ?? 0) ? 'is-filled' : ''}>{index < Math.min(3, queue?.waitingCount ?? 0) ? '✓' : index + 1}</span>)}
                        <small>{queue?.waitingCount ?? 0} shinobi waiting · MAX 3</small>
                    </div>

                    {queue?.queued && <div className="world-boss-queue-waiting" role="status" aria-live="polite">
                        <span className="world-boss-queue-spinner" />
                        <div><strong>Finding your team</strong><small>{queue.waitingCount} waiting · boss location held · launches in <b>{formatQueueClock(queueRemaining)}</b></small></div>
                    </div>}
                    {!queue?.queued && rejoinRemaining > 0 && <div className="world-boss-queue-message" role="status">Leaving ended PvP protection. You can rejoin in {formatQueueClock(rejoinRemaining)}.</div>}
                    {match?.status === 'preparing' && <div className="world-boss-queue-waiting" role="status"><span className="world-boss-queue-spinner" /><div><strong>Team assembled</strong><small>Sealing the encounter and loading the squad.</small></div></div>}
                    {match?.status === 'cancelled' && <div className="world-boss-queue-message" role="status">{match.error ?? 'That team could not be started. You can queue again.'}</div>}
                    {!atBoss && event.active && <div className="world-boss-queue-message">Travel to Sector {event.currentSector} to join the team.</div>}
                    {message && <div className="world-boss-queue-message" role="status">{message}</div>}

                    {queue?.queued
                        ? <button type="button" className="world-boss-queue-leave" disabled={busy} onClick={() => void changeQueue('leave')}>{busy ? 'Updating…' : 'Leave queue'}</button>
                        : match?.status === 'preparing'
                            ? <button type="button" className="world-boss-queue-join" disabled>Preparing your team…</button>
                        : activeMatch && activeMatch.runId === dismissedRunId
                            ? <button type="button" className="world-boss-queue-join" onClick={() => setFight({ runId: activeMatch.runId, session: activeMatch.session! })}>Resume team fight <span>→</span></button>
                            : activeMatch
                                ? <button type="button" className="world-boss-queue-join" onClick={() => setFight({ runId: activeMatch.runId, session: activeMatch.session! })}>Enter team fight <span>→</span></button>
                                : event.active
                                    ? <button type="button" className="world-boss-queue-join" disabled={!atBoss || busy || rejoinRemaining > 0} onClick={() => void changeQueue('join')}>{busy ? 'Joining…' : rejoinRemaining > 0 ? `Rejoin in ${formatQueueClock(rejoinRemaining)}` : atBoss ? 'Join the team queue' : 'Travel to the boss'} <span>→</span></button>
                                    : <div className="world-boss-queue-closed">This boss is no longer accepting new teams.</div>}

                    <p className="world-boss-queue-footnote">Closing this popup keeps your place in line. Leaving cancels the ticket, ends PvP protection, and starts a {rejoinCooldownMinutes}-minute rejoin cooldown.</p>
                </>}
            </div>
        </section>
    </div>;
}
