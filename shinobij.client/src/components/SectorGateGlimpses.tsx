import type { CSSProperties } from 'react';
import { sectorExitById, type SectorExit } from '../../../shared/sector-links';
import { sectorFloorImage } from '../lib/sector-floor-layout';
import { gateGlimpseBand } from '../lib/sector-gate-glimpse';

/** A six-pixel inset frame previews actual neighbor art without changing tile geometry. */
export function SectorGateGlimpses({ exits }: { exits: readonly SectorExit[] }) {
    return <div className="sector-gate-glimpses" aria-hidden="true">
        {exits.map(exit => {
            const reverse = sectorExitById(exit.destinationSector, exit.destinationExitId);
            if (!reverse) return null;
            const band = gateGlimpseBand(exit, exits), { horizontal } = band;
            const lane = horizontal ? reverse.tile % 12 : Math.floor(reverse.tile / 12);
            const across = (lane - 1) / 9 * 100;
            const depth = reverse.direction === 'south' || reverse.direction === 'east' ? 100 : 0;
            const style: CSSProperties = {
                backgroundImage: `url("${sectorFloorImage(exit.destinationSector)}")`,
                backgroundSize: horizontal ? '400% 1200%' : '1200% 400%',
                backgroundPosition: horizontal ? `${across}% ${depth}%` : `${depth}% ${across}%`,
                clipPath: horizontal ? `inset(0 ${band.clipEnd}% 0 ${band.clipStart}%)` : `inset(${band.clipStart}% 0 ${band.clipEnd}% 0)`,
                [horizontal ? 'left' : 'top']: `${(lane - 1) / 12 * 100}%`,
            };
            return <span key={exit.id} className={`sector-gate-glimpse sector-gate-glimpse-${exit.direction}`}
                data-neighbor-sector={exit.destinationSector} data-reverse-exit={reverse.id} style={style} />;
        })}
    </div>;
}
