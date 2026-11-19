import './world-standing-figure.css';

/** The front standing pose ships with the map so every actor can appear before its motion pages arrive. */
export function WorldStandingFigure({ kind = 'starter-one', name = '', className = '' }: {
    kind?: string; name?: string; className?: string;
}) {
    return <img className={`world-standing-figure ${className}`.trimEnd()} src={`/world-figures/v1/${kind}.webp`}
        alt={name} decoding="async" draggable={false} />;
}
