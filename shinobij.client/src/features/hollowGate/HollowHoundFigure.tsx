import { useState } from 'react';
import { WorldStandingFigure } from '../../components/WorldStandingFigure';
import art from '../../data/hollow-hound-encounter.json';
import './hollow-hound-figure.css';

export function HollowHoundFigure({ artBase }: { artBase: string | null }) {
    const folder = artBase && artBase.replace(/\/$/, '') + '/hollow-hound/';
    const [loaded, setLoaded] = useState(false);
    return <>
        {!loaded && <WorldStandingFigure kind="hollow-hound" className="hg-hound-standing" />}
        {folder && <picture className="hg-hound-figure" aria-hidden="true" hidden={!loaded}>
            <source media="(prefers-reduced-motion: reduce)" srcSet={folder + art.still} />
            <source srcSet={folder + art.idle} />
            <img alt="" draggable={false} decoding="async"
                onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} />
        </picture>}
    </>;
}
