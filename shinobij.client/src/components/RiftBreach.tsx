import { useId } from 'react';
import type { CSSProperties } from 'react';
import type { RiftBreachSite } from '../lib/rift-breach-layout';

export function RiftBreach({ site, active }: { site: RiftBreachSite; active: boolean }) {
    const id = useId().replaceAll(':', '');
    return <g className={`rift-breach${active ? ' is-awake' : ''}`} data-room={site.roomId} data-anchor-cells={site.cells.join(',')}
        transform={`translate(${site.x} ${site.y}) rotate(${site.angle})`} opacity={active ? 1 : .3}>
        <defs>
            <radialGradient id={`${id}-spill`}><stop stopColor="var(--hg-floor-accent)" stopOpacity=".3" /><stop offset="1" stopColor="var(--hg-floor-accent)" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse className="rift-breach-spill" cy=".45" rx={site.width * .65} ry="1.1" fill={`url(#${id}-spill)`} />
        <image className="rift-breach-art" href="/underground/rift-breach-v2.webp" x={-site.width / 2} y={-site.height / 2}
            width={site.width} height={site.height} preserveAspectRatio="none" />
    </g>;
}

/** Animate cached painted sprites with opacity/transform. SVG path animation
 * would repeatedly rasterize the effect instead of reusing its bitmap. */
export function RiftEnergyOverlay({ site, tilePx }: { site: RiftBreachSite; tilePx: number }) {
    const style: CSSProperties = { left: (site.x - 2) * tilePx, top: (site.y - 2) * tilePx,
        width: 4 * tilePx, height: 3.5 * tilePx, transform: `rotate(${site.angle}deg)`, transformOrigin: '50% 57.142857%',
        '--rift-wisp-rise': `${-tilePx * .45}px`, '--rift-mote-rise': `${-tilePx * .85}px` } as CSSProperties;
    return <div className="rift-energy-overlay" style={style} aria-hidden="true">
        <span className="rift-breach-spill" />
        {Array.from({ length: 3 }, (_, i) => <span key={i} className="rift-energy-ribbon" style={{
            left: `${(2 + (i - 1) * .36) / 4 * 100 - 11}%`, animationDelay: `${-i * 2}s` }}>
            <img src="/underground/rift-energy-plume-v2.webp" alt="" draggable={false} style={i === 1 ? { transform: 'scaleX(-1)' } : undefined} />
        </span>)}
        {Array.from({ length: 7 }, (_, i) => <i key={i} className="rift-energy-mote" style={{
            left: `${(2 + (i % 4 - 1.5) * .32) / 4 * 100}%`, top: `${(2.15 - (i % 3) * .24) / 3.5 * 100}%`, animationDelay: `${-i * .9}s` }} />)}
    </div>;
}
