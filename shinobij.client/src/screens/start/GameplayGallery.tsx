import { useEffect, useRef, useState } from "react";

type GameplayScreenshot = { id: string; label: string; alt: string; width: number; height: number };

const SCENES = [
    { id: "combat", label: "Jutsu combat", title: "Turn-Based Jutsu Combat", description: "Fights take place on a hex grid. Each jutsu costs action points and has a cooldown, so positioning and planning matter.", alt: "Actual tactical battle gameplay with a hex battlefield, shinobi opponents, and jutsu actions", width: 2200, height: 1013 },
    { id: "cards", label: "Card battles", title: "Card Battles", description: "Collect cards and build your own deck, then battle other players in the Card Hall.", alt: "Actual Card Hall card battle with a volcanic battlefield and a hand of illustrated cards", width: 2200, height: 1238 },
    { id: "pet-arena", label: "Pet Arena", title: "Pet Battles", description: "Build a team of pets and battle other players' teams in the Pet Arena.", alt: "Actual pet arena gameplay showing two teams of companions in a forest colosseum", width: 2200, height: 983 },
    { id: "story", label: "Story", title: "Story Chapters", description: "Each village has its own illustrated story, and your choices change what happens in later chapters.", alt: "Actual story gameplay showing the epilogue What Came Back and its narration", width: 1366, height: 768 },
    { id: "mobile-combat", label: "On mobile", title: "Play on Your Phone", description: "Play the full game in your phone's browser, with controls made for touch screens.", alt: "Actual mobile tactical battle screenshot with jutsu cards and touch controls", width: 1080, height: 2340 },
] as const;

const MOBILE_SCENES: readonly GameplayScreenshot[] = [
    { ...SCENES[4], label: "Jutsu combat" },
    { id: "mobile-cards", label: "Card battles", alt: "Mobile Card Hall card battle with monster zones, illustrated cards, and touch actions", width: 1080, height: 2340 },
    { id: "mobile-pet-arena", label: "Pet Arena", alt: "Mobile pet arena battle showing companions attacking in an icy colosseum", width: 605, height: 730 },
    { id: "mobile-story", label: "Story", alt: "Mobile story scene Ridge Post Four, with Captain Yura at a snowy lantern post and cinematic dialogue", width: 1080, height: 2340 },
];

export function GameplayGallery() {
    const [active, setActive] = useState(0);
    const [enlarged, setEnlarged] = useState<GameplayScreenshot | null>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const openerRef = useRef<HTMLButtonElement>(null);
    const scene = SCENES[active];

    useEffect(() => {
        if (enlarged && !dialogRef.current?.open) dialogRef.current?.showModal();
    }, [enlarged]);
    // The page stops scrolling under an open lightbox. A class, not
    // `html:has(.landing-lightbox[open])`: an attribute selector inside `:has()`
    // made Chrome re-check every page-level `:has()` on each DOM change.
    useEffect(() => {
        if (!enlarged) return undefined;
        document.documentElement.classList.add('landing-lightbox-open');
        return () => document.documentElement.classList.remove('landing-lightbox-open');
    }, [enlarged]);

    function openScreenshot(screenshot: GameplayScreenshot, opener: HTMLButtonElement) {
        // WebKit does not focus a button on pointer click, so the dialog's
        // native restoration can otherwise return to an unrelated old focus.
        openerRef.current = opener;
        setEnlarged(screenshot);
    }

    return (
        <section className="landing-gameplay landing-band" id="landing-gameplay" aria-labelledby="landing-gameplay-title" tabIndex={-1}>
            <div className="landing-section-head" data-landing-reveal><h2 id="landing-gameplay-title" className="landing-section-title">See the Game in Action</h2></div>
            <div className="landing-gallery-tabs" role="tablist" aria-label="Gameplay scenes">
                {SCENES.map((item, index) => <button key={item.id} type="button" role="tab" id={`scene-tab-${item.id}`} aria-controls="landing-gallery-panel" aria-selected={index === active} tabIndex={index === active ? 0 : -1} onClick={() => setActive(index)} onKeyDown={(event) => {
                    const next = event.key === 'ArrowRight' ? (index + 1) % SCENES.length : event.key === 'ArrowLeft' ? (index + SCENES.length - 1) % SCENES.length : event.key === 'Home' ? 0 : event.key === 'End' ? SCENES.length - 1 : null;
                    if (next !== null) { event.preventDefault(); setActive(next); document.getElementById(`scene-tab-${SCENES[next].id}`)?.focus(); }
                }}>{item.label}</button>)}
            </div>
            <div className="landing-gallery-panel" data-landing-reveal role="tabpanel" id="landing-gallery-panel" aria-labelledby={`scene-tab-${scene.id}`} tabIndex={0}>
                {scene.id === 'mobile-combat' ? <div className="landing-mobile-gallery">
                    {MOBILE_SCENES.map((item) => <button key={item.id} type="button" className="landing-mobile-scene" aria-label={`Enlarge mobile ${item.label} screenshot`} onClick={(event) => openScreenshot(item, event.currentTarget)}>
                        <span className={`landing-mobile-screen${item.id === 'mobile-pet-arena' ? ' landing-mobile-screen--arena' : ''}`}><img src={`/landing/${item.id}.webp`} alt={item.alt} width={item.width} height={item.height} loading="lazy" decoding="async" /></span>
                        <span className="landing-mobile-label">{item.label}</span>
                    </button>)}
                </div> : <button type="button" className="landing-gallery-image" aria-label={`Enlarge ${scene.label} screenshot`} onClick={(event) => openScreenshot(scene, event.currentTarget)}>
                    <img key={scene.id} src={`/landing/${scene.id}.webp`} alt={scene.alt} width={scene.width} height={scene.height} loading="lazy" decoding="async" />
                    <span className="landing-gallery-enlarge" aria-hidden="true">View full size</span>
                </button>}
                <div className="landing-gallery-caption"><h3>{scene.title}</h3><p>{scene.description}</p></div>
            </div>
            <dialog ref={dialogRef} className="landing-lightbox" aria-label={enlarged ? `${enlarged.label} screenshot` : 'Gameplay screenshot'} onClose={() => { setEnlarged(null); openerRef.current?.focus({ preventScroll: true }); }} onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
                {enlarged && <>
                    <div className="landing-lightbox-bar"><span>{enlarged.label} · Actual gameplay</span><button type="button" aria-label="Close screenshot" onClick={() => dialogRef.current?.close()}>✕</button></div>
                    <img src={`/landing/${enlarged.id}.webp`} alt={enlarged.alt} width={enlarged.width} height={enlarged.height} />
                </>}
            </dialog>
        </section>
    );
}
