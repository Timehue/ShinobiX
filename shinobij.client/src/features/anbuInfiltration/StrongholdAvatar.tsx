import { useLayoutEffect, useRef } from 'react';
import { SectorModelFigure, type SectorModelHandle } from '../../components/SectorModelFigure';
import { isPlayerModel, starterModel, type PlayerModel, type SprintStyle } from '../../lib/player-model';

/** Presentation only. The parent still submits and reconciles every stronghold step. */
export function StrongholdAvatar({ tileX, tileY, tileSize, size, stepMs, name, portrait,
    artBase, playerGaits, playerModel, sprintStyle, overview = false, count = 1,
    onSelect, disabled, title, tile }: {
    tileX: number; tileY: number; tileSize: number; size: number; stepMs: number;
    name: string; portrait?: string | null; artBase: string | null; playerGaits: boolean;
    playerModel?: PlayerModel; sprintStyle?: SprintStyle; overview?: boolean; count?: number;
    onSelect?: () => void; disabled?: boolean; title?: string; tile?: number;
}) {
    const root = useRef<HTMLElement | null>(null);
    const model = useRef<SectorModelHandle>(null);
    const position = useRef({ x: tileX, y: tileY });
    const tail = useRef({ x: tileX, y: tileY });
    const queue = useRef<Array<{ x: number; y: number }>>([]);
    const frame = useRef(0);
    const previousTime = useRef(0);
    const lastTravel = useRef(0);
    const metrics = useRef({ tileSize, stepMs });
    const equipped = isPlayerModel(playerModel) ? playerModel : undefined;
    const kind = starterModel(portrait || '');
    const useModel = !!artBase && playerGaits && count === 1;

    useLayoutEffect(() => {
        metrics.current = { tileSize, stepMs };
        function paint(snap = false, moving = false) {
            const { tileSize: px } = metrics.current;
            const x = (position.current.x + .5) * px;
            const y = (position.current.y + .5) * px;
            if (root.current) {
                root.current.style.left = `${x}px`;
                root.current.style.top = `${y}px`;
            }
            if (snap) model.current?.snap(x, y, px * 12);
            else model.current?.place(x, y, px * 12, moving, 'walk', moving);
        }
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        const snap = () => {
            cancelAnimationFrame(frame.current);
            frame.current = 0;
            previousTime.current = 0;
            position.current = { ...tail.current };
            queue.current = [];
            paint(true);
        };
        const onVisibility = () => { if (document.hidden) snap(); };
        const onMotion = () => { if (reduced.matches) snap(); };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', snap);
        reduced.addEventListener('change', onMotion);
        paint(true);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', snap);
            reduced.removeEventListener('change', onMotion);
            snap();
        };
    }, [tileSize, stepMs, artBase, useModel, kind, equipped?.assetId, equipped?.version, sprintStyle]);

    useLayoutEffect(() => {
        const next = { x: tileX, y: tileY };
        const prior = tail.current;
        const distance = Math.abs(next.x - prior.x) + Math.abs(next.y - prior.y);
        tail.current = next;
        const snap = overview || document.hidden
            || window.matchMedia('(prefers-reduced-motion: reduce)').matches
            // Presence provides positions, not the missing route through walls.
            || distance > 1.01 || queue.current.length >= 8;
        if (snap) {
            cancelAnimationFrame(frame.current);
            frame.current = 0;
            previousTime.current = 0;
            queue.current = [];
            position.current = next;
        } else if (distance > .001) queue.current.push(next);

        const paint = (moving: boolean, immediate = false) => {
            const { tileSize: px } = metrics.current;
            const x = (position.current.x + .5) * px;
            const y = (position.current.y + .5) * px;
            if (root.current) {
                root.current.style.left = `${x}px`;
                root.current.style.top = `${y}px`;
            }
            if (immediate) model.current?.snap(x, y, px * 12);
            else model.current?.place(x, y, px * 12, moving, 'walk', moving);
        };
        if (snap || queue.current.length === 0 && !frame.current) paint(false, snap);
        if (frame.current || queue.current.length === 0) return;
        const tick = (now: number) => {
            const dt = previousTime.current ? Math.min(100, now - previousTime.current) : 0;
            previousTime.current = now;
            const head = queue.current[0];
            if (head) {
                const p = position.current;
                const dx = head.x - p.x, dy = head.y - p.y;
                const remaining = Math.hypot(dx, dy);
                const step = dt / metrics.current.stepMs * (queue.current.length > 1 ? 1.3 : 1);
                if (remaining <= step || remaining < .001) {
                    position.current = head;
                    queue.current.shift();
                } else position.current = { x: p.x + dx / remaining * step, y: p.y + dy / remaining * step };
                paint(true);
                lastTravel.current = now;
            } else if (now - lastTravel.current > 1000 / 30 && !model.current?.stop()) {
                frame.current = 0;
                previousTime.current = 0;
                return;
            }
            frame.current = requestAnimationFrame(tick);
        };
        previousTime.current = 0;
        frame.current = requestAnimationFrame(tick);
    }, [tileX, tileY, tileSize, overview]);

    const Element = onSelect ? 'button' : 'div';
    return <Element ref={(node: HTMLButtonElement | HTMLDivElement | null) => { root.current = node; }}
        className={`stronghold-motion-avatar ${onSelect ? 'stronghold-peer' : 'stronghold-player'}`}
        // The own marker is a div: role="img" lets "Your position" name it (an aria-label on a role-less div is ignored).
        data-tile={tile} role={onSelect ? undefined : 'img'} aria-label={onSelect ? `Inspect ${count > 1 ? `${count} shinobi` : name}` : 'Your position'}
        title={title} disabled={onSelect ? disabled : undefined} onClick={onSelect}
        style={{ width: onSelect ? Math.max(44, size) : size, height: onSelect ? Math.max(44, size) : size }}>
        <span className={`stronghold-avatar${onSelect ? ' stronghold-peer-avatar' : ''}`} style={{ width: size, height: size }}>
            {count > 1 ? <b>{count}</b> : portrait ? <img src={portrait} alt="" /> : <b>{name.slice(0, 2)}</b>}
        </span>
        {useModel && <SectorModelFigure key={kind} ref={model} kind={kind} equipped={equipped}
            artBase={artBase!} style={sprintStyle} />}
        {onSelect && <span className="stronghold-peer-label">{count > 1 ? `${count} shinobi` : name}</span>}
    </Element>;
}
