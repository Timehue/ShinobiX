import { useEffect, useRef, useState } from 'react';
import { SectorModelFigure, type SectorModelHandle } from './SectorModelFigure';
import { starterModel, type PlayerModel } from '../lib/player-model';
import { playerGaitTilesPerSecond } from '../../../shared/sector-gait-rates';

// The preview places the figure on the same 12-tile reference map as the sector.
const previewMapWidth = 1080;
const walkPixelsPerSecond = playerGaitTilesPerSecond.walk * (previewMapWidth / 12);

export function ProfileModelPreview({ artBase, avatar, model, starterWorldModel, self = false }: {
    artBase: string; avatar: string; model?: PlayerModel;
    /** The viewer's own model: decode it ahead of any figures still loading behind. */
    self?: boolean;
    starterWorldModel?: import('../../../shared/player-model-ref').StarterWorldModel;
}) {
    const figure = useRef<SectorModelHandle>(null);
    const x = useRef(0);
    const [walking, setWalking] = useState(false);
    const [slow, setSlow] = useState(false);
    useEffect(() => {
        figure.current?.place(0, 0, previewMapWidth, false);
        const timer = window.setTimeout(() => setSlow(true), 8000);
        return () => window.clearTimeout(timer);
    }, []);
    useEffect(() => {
        let frame = 0, last = performance.now();
        function tick(now: number) {
            if (!walking) {
                if (figure.current?.stop()) frame = requestAnimationFrame(tick);
                return;
            }
            if (!document.hidden) {
                x.current += Math.min(0.1, (now - last) / 1000) * walkPixelsPerSecond;
                figure.current?.place(x.current, 0, previewMapWidth, true, 'walk', true);
            }
            last = now;
            frame = requestAnimationFrame(tick);
        }
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [walking]);
    return <>
        <div className="profile-model-stage" role="img" aria-label={walking ? 'World model walking' : 'World model standing'}>
            <span className="profile-model-actor"><SectorModelFigure ref={figure} artBase={artBase} kind={starterModel(avatar, starterWorldModel)} equipped={model} self={self} /></span>
            <span className="profile-model-loading">{slow ? 'Preview unavailable' : 'Loading preview…'}</span>
        </div>
        <button type="button" aria-pressed={walking} onClick={() => setWalking(value => !value)}>Preview walk</button>
    </>;
}
