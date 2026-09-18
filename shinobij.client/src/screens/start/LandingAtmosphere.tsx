import { useEffect, useRef, useState, type CSSProperties } from 'react';

// Fixed seeds keep the composition stable between renders. Only opacity and
// transforms animate; no canvas, animation loop, image download, or dependency.
const EMBERS = Array.from({ length: 44 }, (_, index) => ({
    '--ember-x': `${32 + ((index * 23) % 67)}%`,
    '--ember-x-mobile': `${(index * 29 + 9) % 98}%`,
    '--ember-y': `${48 + ((index * 17) % 49)}%`,
    '--ember-size': `${index % 5 === 0 ? 4 : 1.5 + (index % 3) * 0.65}px`,
    '--ember-drift': `${35 + ((index * 19) % 100)}px`,
    '--ember-rise': `${220 + ((index * 37) % 220)}px`,
    '--ember-duration': `${12 + ((index * 7) % 13)}s`,
    '--ember-delay': `${-((index * 4.7) % 25)}s`,
    '--ember-opacity': 0.35 + (index % 4) * 0.15,
}) as CSSProperties);

// The upper-right canopy sheds its own flecks down and into the breeze.
// Kept separate from the rising embers so both sources read naturally.
const CANOPY_FLECKS = Array.from({ length: 18 }, (_, index) => ({
    '--canopy-x': `${61 + ((index * 13) % 38)}%`,
    '--canopy-y': `${-2 + ((index * 7) % 17)}%`,
    '--canopy-size': `${4 + (index % 4) * 1.5}px`,
    '--canopy-drift': `${-65 - ((index * 23) % 180)}px`,
    '--canopy-fall': `${170 + ((index * 31) % 240)}px`,
    '--canopy-duration': `${11 + ((index * 3) % 10)}s`,
    '--canopy-delay': `${-((index * 3.7) % 22)}s`,
    '--canopy-opacity': 0.5 + (index % 3) * 0.15,
}) as CSSProperties);

export function LandingAtmosphere() {
    const atmosphereRef = useRef<HTMLDivElement>(null);
    const [inView, setInView] = useState(false);
    const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');

    useEffect(() => {
        const element = atmosphereRef.current;
        if (!element) return;
        const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
        observer.observe(element);
        const onVisibilityChange = () => setPageVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            observer.disconnect();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, []);

    return (
        <div ref={atmosphereRef} className="landing-atmosphere" aria-hidden="true" data-running={inView && pageVisible}>
            <div className="landing-atmosphere-glow" />
            <div className="landing-valley-mist landing-valley-mist--far" />
            <div className="landing-valley-mist landing-valley-mist--near" />
            <div className="landing-tail-aura" />
            {EMBERS.map((style, index) => <span key={index} className="landing-ember" style={style} />)}
            {CANOPY_FLECKS.map((style, index) => <span key={index} className="landing-canopy-fleck" style={style} />)}
        </div>
    );
}
