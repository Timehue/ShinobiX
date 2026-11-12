import { useState, type ReactNode } from 'react';
import art from '../../data/hollow-hound-encounter.json';
import './hollow-hound-figure.css';

export function HollowHoundFigure({ artBase, children }: { artBase: string; children: ReactNode }) {
    const folder = artBase.replace(/\/$/, '') + '/hollow-hound/';
    const [loaded, setLoaded] = useState(false);
    return <>
        {!loaded && children}
        <picture className="hg-hound-figure" aria-hidden="true" hidden={!loaded}>
            <source media="(prefers-reduced-motion: reduce)" srcSet={folder + art.still} />
            <source srcSet={folder + art.idle} />
            <img alt="" draggable={false} decoding="async"
                onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} />
        </picture>
    </>;
}
