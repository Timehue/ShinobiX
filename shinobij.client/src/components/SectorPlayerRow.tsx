import { memo, useRef, useState } from 'react';
import type { WorldSectorCommandPlayer } from './WorldSectorCommandPanel.types';
import { sectorContestLabel } from '../lib/sector-war-engagement';
import { sectorPlayerKey } from '../lib/sector-player-roster';
import type { SectorPlayerIntent } from '../lib/use-sector-player-action';

function Portrait({ src, name }: { src: string; name: string }) {
    const [failed, setFailed] = useState(false);
    return <span className="sector-roster-portrait" aria-hidden="true">
        <span>{name.slice(0, 2).toUpperCase()}</span>
        {src && !failed && <img src={src} alt="" width={38} height={38} loading="lazy" decoding="async"
            onError={() => setFailed(true)} />}
    </span>;
}

export const SectorPlayerRow = memo(function SectorPlayerRow({ player, pending, busy, error, onAction }: {
    player: WorldSectorCommandPlayer; pending: boolean; busy: boolean; error?: string;
    onAction: (key: string, intent: SectorPlayerIntent) => void;
}) {
    const pointerAccount = useRef<string | null>(null);
    const key = sectorPlayerKey(player.name);
    const spectating = player.status === 'Fighting';
    const intent = spectating ? 'spectate' : player.sleeping ? 'strike' : 'attack';
    const label = spectating ? 'Spectate' : player.sleeping ? 'Strike Down' : player.attackLabel.kind === 'contest'
        ? sectorContestLabel(player.attackLabel.winCondition) : 'Attack';
    const gestureKey = `${key}:${label}`;
    return <li className="sector-player-row" data-player-key={key}>
        <Portrait key={player.avatarSrc} src={player.avatarSrc} name={player.name} />
        <div className="sector-roster-person">
            <strong title={player.name}>{player.name}</strong>
            <span>Lv {player.level} <span className={`sector-roster-status is-${player.status.toLowerCase()}`}>{player.status}</span></span>
        </div>
        <button type="button" className={`sector-roster-action${spectating ? ' is-spectate' : ''}`} disabled={busy || (spectating ? player.spectateDisabled : player.actionDisabled)}
            aria-label={`${label} ${player.name}`} aria-busy={pending}
            onPointerDown={() => { pointerAccount.current = gestureKey; }}
            onPointerCancel={() => { pointerAccount.current = null; }}
            onClick={event => {
                if (event.detail > 0 && pointerAccount.current !== gestureKey) return;
                pointerAccount.current = null;
                onAction(key, intent);
            }}>{pending ? (spectating ? 'Opening…' : 'Starting…') : label}</button>
        {(error || (player.disabledReason && player.status !== 'Traveling' && player.status !== 'Fighting')) && <p className="sector-row-feedback" role={error ? 'status' : undefined}>
            {error || player.disabledReason}
        </p>}
    </li>;
});
