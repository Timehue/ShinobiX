import './world-standing-figure.css';
import { peerStandingKind } from '../lib/peer-standing-kind';

// These previously shipped at the same URL in gray and can be cached for a week.
const repainted = new Set(['captain-yura', 'elder-vanta', 'hollow-warden', 'medic', 'nightblade', 'nyx', 'shade-master-iro', 'underground-patrol']);

/** The front standing pose ships with the map so every actor can appear before its motion pages arrive. */
export function WorldStandingFigure({ kind = 'starter-one', name = '', accountName = name, className = '' }: {
    kind?: string; name?: string; accountName?: string; className?: string;
}) {
    const figure = peerStandingKind(accountName, kind);
    return <img className={`world-standing-figure ${className}`.trimEnd()} src={`/world-figures/v1/${figure}.webp${repainted.has(figure) ? '?v=2' : ''}`}
        alt={name} decoding="async" draggable={false} />;
}
