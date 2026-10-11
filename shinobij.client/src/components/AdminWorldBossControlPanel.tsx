import { useCallback, useEffect, useState } from 'react';
import { WORLD_BOSS_DEFINITIONS, type WorldBossEventStatus, type WorldBossId } from '../../../shared/world-boss-event';
import { PLAYABLE_WILD_SECTOR_IDS, sectorName, VILLAGE_OUTSKIRTS } from '../../../shared/sector-geo';
import { gameConfirm } from './GameAlert';
import './AdminWorldBossControlPanel.css';

type AdminWorldBossEvent = {
    eventId: string;
    bossId: WorldBossId;
    bossName: string;
    status: WorldBossEventStatus;
    startedAt: number;
    endsAt: number;
    hp: number;
    hpMax: number;
    spawnSector?: number;
    targetVillage?: string;
    currentSector?: number | null;
    targetSector?: number | null;
    destinationReached?: boolean;
};

type AdminWorldBossPayload = {
    event?: AdminWorldBossEvent | null;
    active?: boolean;
    error?: string;
};

export function AdminWorldBossControlPanel({ adminPw }: { adminPw: string }) {
    const [event, setEvent] = useState<AdminWorldBossEvent | null>(null);
    const [active, setActive] = useState(false);
    const [hpMax, setHpMax] = useState('600000');
    const [spawnSector, setSpawnSector] = useState('42');
    const [targetVillage, setTargetVillage] = useState(Object.keys(VILLAGE_OUTSKIRTS)[0] ?? 'Stormveil Village');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [messageIsError, setMessageIsError] = useState(false);
    const [loadError, setLoadError] = useState('');

    const refresh = useCallback(async () => {
        try {
            const response = await fetch('/api/admin/world-boss-event', {
                headers: { 'x-admin-password': adminPw },
                cache: 'no-store',
            });
            const payload = await response.json().catch(() => ({})) as AdminWorldBossPayload;
            if (!response.ok) throw new Error(payload.error ?? `Could not load controls (${response.status}).`);
            setEvent(payload.event ?? null);
            setActive(payload.active === true);
            setLoadError('');
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : 'World boss controls are unavailable.');
        }
    }, [adminPw]);

    useEffect(() => {
        const initial = window.setTimeout(() => { void refresh(); }, 0);
        const poll = window.setInterval(() => { void refresh(); }, 20_000);
        return () => {
            window.clearTimeout(initial);
            window.clearInterval(poll);
        };
    }, [refresh]);

    async function act(action: 'start' | 'stop', bossId: WorldBossId) {
        const definition = WORLD_BOSS_DEFINITIONS.find(boss => boss.id === bossId)!;
        if (action === 'start') {
            const hp = Math.max(100_000, Math.min(3_000_000, Math.floor(Number(hpMax) || 600_000)));
            const spawnDescription = `Sector ${spawnSector}${sectorName(Number(spawnSector)) ? ` · ${sectorName(Number(spawnSector))}` : ''}`;
            const confirmed = await gameConfirm(
                `Release ${definition.name} in ${spawnDescription}, then send it toward ${targetVillage}, with ${hp.toLocaleString()} shared HP?`,
                { title: 'Release World Boss', confirmLabel: 'Release Boss' },
            );
            if (!confirmed) return;
        } else {
            const confirmed = await gameConfirm(
                `Stop ${event?.bossName ?? definition.name}? This closes the event and queue. Already formed fights can finish, but their damage will not affect the stopped event.`,
                { title: 'Stop World Boss', confirmLabel: 'Stop Boss', danger: true },
            );
            if (!confirmed) return;
        }

        setBusy(true);
        setMessage('');
        setMessageIsError(false);
        setLoadError('');
        try {
            const response = await fetch('/api/admin/world-boss-event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
                body: JSON.stringify({
                    action,
                    bossId,
                    hpMax: Math.max(100_000, Math.min(3_000_000, Math.floor(Number(hpMax) || 600_000))),
                    ...(action === 'start' ? { spawnSector: Number(spawnSector), targetVillage } : {}),
                    ...(action === 'stop' && event?.eventId ? { eventId: event.eventId } : {}),
                }),
            });
            const payload = await response.json().catch(() => ({})) as AdminWorldBossPayload & { stopped?: boolean };
            if (!response.ok) throw new Error(payload.error ?? `World boss action failed (${response.status}).`);
            setEvent(payload.event ?? null);
            setActive(payload.active === true);
            setMessage(action === 'start'
                ? `${definition.name} released in sector ${spawnSector}, heading for ${targetVillage}.`
                : payload.stopped === false ? 'There is no live world boss event to stop.' : 'The active world boss event has stopped.');
            await refresh();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'World boss action failed.');
            setMessageIsError(true);
            await refresh();
        } finally {
            setBusy(false);
        }
    }

    return <section className="admin-world-boss-control-panel">
        <div className="admin-world-boss-control-panel__heading">
            <div>
                <span className="admin-world-boss-control-panel__eyebrow">FIELD OPERATIONS</span>
                <h3>Roaming World Bosses</h3>
                <p>Choose where a boss appears and which village it targets, then release or stop the event. One roaming world boss can be active at a time.</p>
            </div>
            <button type="button" onClick={() => void refresh()} disabled={busy}>Refresh</button>
        </div>

        {event && <div className={'admin-world-boss-live-status' + (active ? ' is-active' : '')}>
            <span className="admin-world-boss-live-status__dot" />
            <div>
                <strong>{active ? 'LIVE' : 'LAST EVENT'} · {event.bossName}</strong>
                <span>
                    {event.status} · {event.hp.toLocaleString()} / {event.hpMax.toLocaleString()} HP
                    {' · current sector '}{event.currentSector ?? 'unknown'}
                    {' · spawn '}{event.spawnSector ?? 'legacy'}
                    {' → '}{event.targetVillage ?? 'nearest village'}
                    {event.targetSector ? ` (sector ${event.targetSector})` : ''}
                    {event.destinationReached ? ' · arrived' : ''}
                    {' · closes '}{new Date(event.endsAt).toLocaleString()}
                </span>
            </div>
        </div>}

        <div className="admin-world-boss-settings">
            <label className="admin-world-boss-setting">
                Starting shared HP
                <input type="number" min={100000} max={3000000} step={10000} value={hpMax} onChange={input => setHpMax(input.target.value)} disabled={busy || active} />
                <small>100,000–3,000,000 · default 600,000</small>
            </label>
            <label className="admin-world-boss-setting">
                Spawn sector
                <select value={spawnSector} onChange={input => setSpawnSector(input.target.value)} disabled={busy || active}>
                    {PLAYABLE_WILD_SECTOR_IDS.map(sector => <option key={sector} value={sector}>Sector {sector} · {sectorName(sector) ?? 'Wilderness'}</option>)}
                </select>
                <small>The event begins at this sector and follows connected roads.</small>
            </label>
            <label className="admin-world-boss-setting">
                Destination village
                <select value={targetVillage} onChange={input => setTargetVillage(input.target.value)} disabled={busy || active}>
                    {Object.keys(VILLAGE_OUTSKIRTS).map(village => <option key={village} value={village}>{village}</option>)}
                </select>
                <small>The boss advances toward this village’s outskirts.</small>
            </label>
        </div>

        <div className="admin-world-boss-choice-grid">
            {WORLD_BOSS_DEFINITIONS.map(boss => {
                const isCurrent = event?.bossId === boss.id && active;
                return <article className={'admin-world-boss-choice' + (isCurrent ? ' is-current' : '')} key={boss.id}>
                    <img src={boss.keyArt} alt="" />
                    <div className="admin-world-boss-choice__copy">
                        <span>{boss.roleLabel}</span>
                        <strong>{boss.name}</strong>
                    <small>{boss.traitName} · {boss.traitDescription}</small>
                    <small>{isCurrent ? 'Currently roaming' : 'Ready for release'}</small>
                    </div>
                    {isCurrent
                        ? <button type="button" className="danger-button" disabled={busy} onClick={() => void act('stop', boss.id)}>Stop Active Boss</button>
                        : <button type="button" disabled={busy || active || !!loadError} onClick={() => void act('start', boss.id)}>{busy ? 'Working…' : 'Release'}</button>}
                </article>;
            })}
        </div>
        {loadError && <p className="admin-world-boss-message is-error" role="alert">{loadError}</p>}
        {message && <p className={'admin-world-boss-message' + (messageIsError ? ' is-error' : '')} role="status">{message}</p>}
    </section>;
}
