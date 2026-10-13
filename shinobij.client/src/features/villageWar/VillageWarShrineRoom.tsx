import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { CampaignObjective } from '../../../../shared/village-war-campaign';
import { ShrineControlTimes } from './ShrineControlTimes';
import type { Character, VersionedCharacterCommit } from '../../types/character';
import { campaignRequest, type CampaignBattle, type CampaignResponse } from '../../lib/village-war-campaign';
import { visiblePoll } from '../../lib/poll';
import { resolveOwnAvatar } from '../../lib/own-avatar';
import './war-shrine-room.css';
const Battle = lazy(() => import('./VillageCampaignBattle'));
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);

export function VillageWarShrineRoom({ character, warId, objective, sharedImages, onVersionedCharacter, onExit }: {
    character: Character; warId: string; objective: CampaignObjective; sharedImages: Record<string, string>;
    onVersionedCharacter: VersionedCharacterCommit; onExit: () => void;
}) {
    const [room, setRoom] = useState<CampaignResponse['room']>();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [battle, setBattle] = useState<CampaignBattle | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const alive = useRef(false), pending = useRef(false), polling = useRef(false), entered = useRef(false), walking = useRef(false);
    const current = useRef<CampaignResponse['room']>(undefined);
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const element = dialog.current;
        if (!element || battle) return;
        element.showModal();
        return () => element.close();
    }, [battle]);
    const adopt = useCallback((response: CampaignResponse) => { if (response.room && alive.current) { current.current = response.room; setRoom(response.room); setNow(response.room.serverNow); setError(''); } }, []);
    useEffect(() => {
        alive.current = true; entered.current = false;
        const stop = visiblePoll(async () => {
            if (pending.current || polling.current) return;
            polling.current = true;
            try {
                const response = await campaignRequest(character.name, warId, entered.current ? 'shrine-state' : 'shrine-enter', { objectiveId: objective.id });
                entered.current = true; adopt(response);
            } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'The shrine could not be reached.'); }
            finally { polling.current = false; }
        }, 5_000, 0.1, { immediate: true });
        const timer = setInterval(() => setNow(value => value + 1000), 1000);
        return () => { alive.current = false; stop(); clearInterval(timer);
            void campaignRequest(character.name, warId, 'shrine-leave', { objectiveId: objective.id }).catch(() => undefined); };
    }, [character.name, warId, objective.id, adopt]);
    const me = room?.players.find(p => p.name === slug(character.name));
    const target = room?.objective ?? objective;
    const closed = now >= target.closesAt;
    const enemies = room?.players.filter(p => p.village !== character.village) ?? [];
    const avatar = resolveOwnAvatar(character, sharedImages);
    async function act(action: string, extra: Record<string, unknown> = {}) {
        if (pending.current) return;
        pending.current = true; setBusy(true);
        try { const response = await campaignRequest(character.name, warId, action, { objectiveId: objective.id, ...extra }); adopt(response); return response; }
        catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Shrine action failed.'); }
        finally { pending.current = false; if (alive.current) setBusy(false); }
    }
    async function walkTo(tile: number) {
        if (walking.current || busy || error || !entered.current || closed || me?.inBattle) return;
        walking.current = true;
        try { while (alive.current) {
            const from = current.current?.players.find(p => p.name === slug(character.name))?.tile;
            if (from === undefined || from === tile) return;
            const x = from % 12, y = Math.floor(from / 12), tx = tile % 12, ty = Math.floor(tile / 12);
            const next = x !== tx ? from + Math.sign(tx - x) : from + Math.sign(ty - y) * 12;
            if (!await act('shrine-step', { tile: next })) return;
        } } finally { walking.current = false; }
    }
    async function leave() {
        const response = await act('shrine-leave');
        if (response) onExit();
    }
    if (battle) return <Suspense fallback={<p>Opening shrine combat…</p>}><Battle character={character} warId={warId} run={battle}
        sharedImages={sharedImages} onVersionedCharacter={onVersionedCharacter} onBack={() => setBattle(null)} /></Suspense>;
    return <dialog ref={dialog} className='war-shrine-dialog' aria-label='Golden shrine interior'
        onCancel={event => { event.preventDefault(); if (!busy && !me?.inBattle) void leave(); }}>
        <section className='war-shrine-room' aria-label='Golden war shrine room'>
        <header className='war-shrine-header'><h2>Golden War Shrine</h2>
            <button className='war-shrine-leave' aria-label='Leave shrine' disabled={busy || !!me?.inBattle} onClick={() => void leave()}>Leave</button>
            <p className='war-shrine-meta'>Sector {objective.sector} · Shinobi PvP · {target.bouts}/{target.limit} scored wins</p></header>
        <p className='war-shrine-window' role='status'>{closed ? 'This scoring window is complete.' : `Window closes in ${Math.max(0, Math.ceil((target.closesAt - now) / 60_000))} minutes.`}</p>
        {error && <div><p role='alert'>{error}</p><button disabled={busy || closed}
            onClick={async () => { const response = await act('shrine-enter'); if (response) entered.current = true; }}>Re-enter shrine</button></div>}
        {!room && !error && <p>Entering the golden shrine…</p>}
        <div className='war-shrine-room-body'><div className='war-shrine-floor' role='group' aria-label='Shrine floor' onKeyDown={event => {
            if (!me) return;
            const delta = ({ ArrowUp: -12, ArrowDown: 12, ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[event.key];
            if (delta === undefined) return;
            event.preventDefault(); const tile = me.tile + delta, x = tile % 12, y = Math.floor(tile / 12);
            if (x >= 1 && x <= 10 && y >= 1 && y <= 10) void walkTo(tile);
        }} tabIndex={0}>
            <img className='war-shrine-floor-art' src='/ui/village-war/war-shrine-floor-gold-v1.webp' alt='Overhead golden shrine courtyard with a central seal and stone paths' />
            <div className='war-shrine-tiles'>{Array.from({ length: 144 }, (_, tile) => <button key={tile}
                aria-label={`Walk to shrine tile ${tile % 12 + 1}, ${Math.floor(tile / 12) + 1}`} tabIndex={-1}
                disabled={busy || closed || !me || tile % 12 < 1 || tile % 12 > 10 || Math.floor(tile / 12) < 1 || Math.floor(tile / 12) > 10}
                onClick={() => void walkTo(tile)} />)}</div>
            {room?.players.map((player, i) => <span key={player.name} className={`war-shrine-player ${player.village === character.village ? 'is-ally' : 'is-enemy'}`}
                style={{ left: `${((player.tile % 12 + .5) / 12) * 100}%`, top: `${((Math.floor(player.tile / 12) + .5) / 12) * 100}%`, transform: `translate(-50%, -50%) translateX(${i * 6}px)` }}>
                {player.name === slug(character.name) && avatar ? <img src={avatar} alt='' /> : <b>{player.displayName.slice(0, 2).toUpperCase()}</b>}
                <small>{player.name === slug(character.name) ? 'You' : player.displayName}</small></span>)}
        </div>
        <aside aria-label='Shrine control'><p className='war-shrine-input-hint'>Choose a tile or use arrow keys to move.</p>
        <p className='war-shrine-control' role='status'>{target.bonusSettled ? target.bonusWinner
            ? `${target.bonusWinner} held the most uncontested time and earned 1,000 War Points.` : 'Uncontested time was tied or zero. No window bonus was awarded.'
            : enemies.length ? 'Both villages are inside. The shrine is contested.'
                : me && target.controlVillage === character.village ? 'Your village controls the shrine and is adding uncontested time.' : 'Hold the shrine uncontested to add time for your village.'}</p>
        <ShrineControlTimes objective={target} villages={[...new Set([character.village, ...Object.keys(target.controlTimeMs ?? {}), ...(room?.players.map(p => p.village) ?? [])])]} />
        {enemies.length > 0 && <div className='war-shrine-opponents'>{enemies.map(player => <button key={player.name} disabled={busy || closed || !!me?.inBattle || player.inBattle}
            onClick={async () => { const response = await act('start', { target: player.name }); if (response?.runId) setBattle(response); }}>
            {player.inBattle ? `${player.displayName} is fighting` : `Fight ${player.displayName}`}</button>)}</div>}
        <details className='war-shrine-rules'><summary>Controls and scoring</summary>
            <p>Choose a floor tile or use arrow keys to move. The first 15 enemy-player victories inside earn 100 War Points each, shared across both villages. Combat stays open until the window closes.</p>
            <p>The village with the most uncontested time across the window earns 1,000 points at closing, even if it has left. Empty and contested time does not count. Tied or zero totals award no bonus.</p>
        </details></aside></div>
    </section></dialog>;
}
