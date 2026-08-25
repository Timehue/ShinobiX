import { useEffect, useState } from "react";
import type { Screen } from "../types/core";
import type { AnnouncementView } from "../lib/legacy";
import { Modal } from "./ui/Modal";
import stormveilArt from "../assets/map-landmarks/stormveil.webp";
import ashenLeafArt from "../assets/map-landmarks/ashen-leaf.webp";
import frostfangArt from "../assets/map-landmarks/frostfang.webp";
import moonshadowArt from "../assets/map-landmarks/moonshadow.webp";
import "./WorldCrisisNewsEntry.css";

export type WorldCrisisNewsFrame = Readonly<{ kicker: string; title: string; body: string }>;

export function WorldCrisisNewsReport({ announcement, setScreen, frames, variant = "breach", heroArt, cardKicker, ariaLabel, reporterHeading, playerPrefix, reporterFallback, finalLabel }: {
    announcement: AnnouncementView;
    setScreen: (screen: Screen) => void;
    frames: readonly WorldCrisisNewsFrame[];
    variant?: "breach" | "reckoning";
    heroArt?: string;
    cardKicker: string;
    ariaLabel: string;
    reporterHeading: string;
    playerPrefix: string;
    reporterFallback: string;
    finalLabel: string;
}) {
    const [open, setOpen] = useState(false);
    const [frame, setFrame] = useState(0);
    const lastFrame = frames.length - 1;
    useEffect(() => {
        if (!open || frame >= lastFrame) return;
        const timer = window.setTimeout(() => setFrame((value) => Math.min(lastFrame, value + 1)), 5_200);
        return () => window.clearTimeout(timer);
    }, [frame, lastFrame, open]);
    const reckoning = variant === "reckoning";
    const current = frames[frame];
    function deploy() {
        if (reckoning) try { sessionStorage.setItem("worldCrisis.focus", "80"); } catch { /* best effort */ }
        setOpen(false);
        setScreen("worldCrisis");
    }
    return <>
        <article className={`crisis-news-card${reckoning ? " crisis-news-card--reckoning" : ""}`}>
            <button type="button" className="crisis-news-card__open" onClick={() => { setFrame(0); setOpen(true); }} aria-label={`Watch ${announcement.title} world news report`}>
                <span className="crisis-news-card__signal" aria-hidden="true"><i /><i /><i /><i /></span>
                <span className="crisis-news-card__copy"><small>{cardKicker}</small><strong>{announcement.title}</strong><span>{announcement.message}</span></span>
                <span className="crisis-news-card__meta"><b>▶ PLAY REPORT</b><time dateTime={new Date(announcement.ts).toISOString()}>{new Date(announcement.ts).toLocaleString()}</time></span>
            </button>
        </article>
        <Modal open={open} onClose={() => setOpen(false)} bare size="lg" ariaLabel={ariaLabel} className="crisis-cinematic-modal" backdropClassName="crisis-cinematic-backdrop">
            <div className={`crisis-cinematic${reckoning ? " crisis-cinematic--reckoning" : ""} crisis-cinematic--frame-${frame}`} key={frame}>
                {heroArt && <img className="crisis-cinematic__reckoning-art" src={heroArt} alt="" />}
                <div className="crisis-cinematic__villages" aria-hidden="true">{[stormveilArt, ashenLeafArt, frostfangArt, moonshadowArt].map((art, index) => <span key={art} style={{ backgroundImage: `url(${art})`, animationDelay: `${index * 90}ms` }} />)}</div>
                <div className="crisis-cinematic__veil" aria-hidden="true"><i /><i /><i /><i /></div>
                <button type="button" className="crisis-cinematic__close" onClick={() => setOpen(false)} aria-label="Close report">×</button>
                <div className="crisis-cinematic__reporter"><span>{reporterHeading}</span><b>{announcement.player ? `${playerPrefix}: ${announcement.player}` : reporterFallback}</b></div>
                <div className="crisis-cinematic__copy"><small>{current.kicker}</small><h2>{current.title}</h2><p>{current.body}</p></div>
                <div className="crisis-cinematic__controls">
                    <div className="crisis-cinematic__steps" aria-label={`Report scene ${frame + 1} of ${frames.length}`}>{frames.map((entry, index) => <button key={entry.title} type="button" className={index === frame ? "is-active" : ""} onClick={() => setFrame(index)} aria-label={`Scene ${index + 1}: ${entry.title}`} />)}</div>
                    {frame < lastFrame ? <button type="button" onClick={() => setFrame(frame + 1)}>Continue report →</button> : <button type="button" className="is-primary" onClick={deploy}>{finalLabel} →</button>}
                </div>
            </div>
        </Modal>
    </>;
}
