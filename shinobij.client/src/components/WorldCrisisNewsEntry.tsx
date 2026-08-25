import { useEffect, useState } from "react";
import type { Screen } from "../types/core";
import type { AnnouncementView } from "../lib/legacy";
import { Modal } from "./ui/Modal";
import stormveilArt from "../assets/map-landmarks/stormveil.webp";
import ashenLeafArt from "../assets/map-landmarks/ashen-leaf.webp";
import frostfangArt from "../assets/map-landmarks/frostfang.webp";
import moonshadowArt from "../assets/map-landmarks/moonshadow.webp";
import "./WorldCrisisNewsEntry.css";

const FRAMES = [
    {
        kicker: "THE FIRST OMEN",
        title: "A field record crossed the line",
        body: "The four villages had already uncovered the machinery beneath their own walls. When one shinobi reached level 37, those separate records matched for the first time.",
    },
    {
        kicker: "CIVIC WORKS · RECALL ORDER",
        title: "The quartered seal lit",
        body: "The Sunken Court did not rise as a creature or open a portal. Its old civic network issued one human-made recall order through four village anchors.",
    },
    {
        kicker: "FOUR OUTSKIRTS · ONE WORLD",
        title: "The old wardens began to march",
        body: "Storm Engine Warden. First Flame Sentinel. Oathbound Ice Captain. Contract-Bound Shadow. Each village faces the consequence it uncovered at level 35.",
    },
    {
        kicker: "GLOBAL DEFENSE ORDER",
        title: "Every shinobi is called",
        body: "The event is open to everyone at the same time. Your opponent scales to your level, and every server-verified victory restores your village outskirts.",
    },
] as const;

export function WorldCrisisNewsEntry({ announcement, setScreen }: { announcement: AnnouncementView; setScreen: (screen: Screen) => void }) {
    const [open, setOpen] = useState(false);
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        if (!open || frame >= FRAMES.length - 1) return;
        const timer = window.setTimeout(() => setFrame((value) => Math.min(FRAMES.length - 1, value + 1)), 5_200);
        return () => window.clearTimeout(timer);
    }, [frame, open]);

    function watch() { setFrame(0); setOpen(true); }
    function defend() { setOpen(false); setScreen("worldCrisis"); }
    const current = FRAMES[frame];

    return (
        <>
            <article className="crisis-news-card">
                <button type="button" className="crisis-news-card__open" onClick={watch} aria-label={`Watch ${announcement.title} world news report`}>
                    <span className="crisis-news-card__signal" aria-hidden="true"><i /><i /><i /><i /></span>
                    <span className="crisis-news-card__copy">
                        <small>BREAKING WORLD REPORT · CLICK TO WATCH</small>
                        <strong>{announcement.title}</strong>
                        <span>{announcement.message}</span>
                    </span>
                    <span className="crisis-news-card__meta">
                        <b>▶ PLAY REPORT</b>
                        <time dateTime={new Date(announcement.ts).toISOString()}>{new Date(announcement.ts).toLocaleString()}</time>
                    </span>
                </button>
            </article>

            <Modal open={open} onClose={() => setOpen(false)} bare size="lg" ariaLabel="The Fourfold Breach world news report" className="crisis-cinematic-modal" backdropClassName="crisis-cinematic-backdrop">
                <div className={`crisis-cinematic crisis-cinematic--frame-${frame}`} key={frame}>
                    <div className="crisis-cinematic__villages" aria-hidden="true">
                        {[stormveilArt, ashenLeafArt, frostfangArt, moonshadowArt].map((art, index) => <span key={art} style={{ backgroundImage: `url(${art})`, animationDelay: `${index * 90}ms` }} />)}
                    </div>
                    <div className="crisis-cinematic__veil" aria-hidden="true"><i /><i /><i /><i /></div>
                    <button type="button" className="crisis-cinematic__close" onClick={() => setOpen(false)} aria-label="Close report">×</button>
                    <div className="crisis-cinematic__reporter">
                        <span>WORLD HERALD // EMERGENCY TRANSMISSION</span>
                        <b>{announcement.player ? `FIRST SIGNAL: ${announcement.player}` : "FIRST SIGNAL CONFIRMED"}</b>
                    </div>
                    <div className="crisis-cinematic__copy">
                        <small>{current.kicker}</small>
                        <h2>{current.title}</h2>
                        <p>{current.body}</p>
                    </div>
                    <div className="crisis-cinematic__controls">
                        <div className="crisis-cinematic__steps" aria-label={`Report scene ${frame + 1} of ${FRAMES.length}`}>
                            {FRAMES.map((entry, index) => <button key={entry.title} type="button" className={index === frame ? "is-active" : ""} onClick={() => setFrame(index)} aria-label={`Scene ${index + 1}: ${entry.title}`} />)}
                        </div>
                        {frame < FRAMES.length - 1
                            ? <button type="button" onClick={() => setFrame(frame + 1)}>Continue report →</button>
                            : <button type="button" className="is-primary" onClick={defend}>Defend your outskirts →</button>}
                    </div>
                </div>
            </Modal>
        </>
    );
}
