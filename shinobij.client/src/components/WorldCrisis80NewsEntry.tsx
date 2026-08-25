import { useEffect, useState } from "react";
import type { Screen } from "../types/core";
import type { AnnouncementView } from "../lib/legacy";
import { Modal } from "./ui/Modal";
import stormveilArt from "../assets/map-landmarks/stormveil.webp";
import ashenLeafArt from "../assets/map-landmarks/ashen-leaf.webp";
import frostfangArt from "../assets/map-landmarks/frostfang.webp";
import moonshadowArt from "../assets/map-landmarks/moonshadow.webp";
import reckoningOutskirtsArt from "../assets/world-crisis-80/reckoning-outskirts.webp";
import "./WorldCrisisNewsEntry.css";
import "./WorldCrisis80NewsEntry.css";

const FRAMES = [
    { kicker: "THE FIRST WITNESS", title: "Four reports became one record", body: "When the first new shinobi reached level 80, the villages compared the bargains Kite Harrow had traced. Four quartered copies reconciled into one admissible witness record." },
    { kicker: "SUNKEN COURT INFRASTRUCTURE", title: "Hollow Gate is not a creature", body: "The Gate is the Court's civic lattice: machinery built to measure choices and turn instability into repeatable patterns. People still serving its claims moved before the villages could publish the proof." },
    { kicker: "COLLECTION ORDER · ALL OUTSKIRTS", title: "Three agents converged on every ledger", body: "Each Collection Cell fields a vanguard, hunter, and assessor. At the same time, pursuit packs entered the lower routes used by companion handlers." },
    { kicker: "TWO FRONTS · ONE DEFENSE", title: "Every player can answer", body: "Break a three-person cell as a shinobi or field three companions against a pursuit pack. Either server-verified victory advances your village's witness ledger." },
] as const;

export function WorldCrisis80NewsEntry({ announcement, setScreen }: { announcement: AnnouncementView; setScreen: (screen: Screen) => void }) {
    const [open, setOpen] = useState(false);
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        if (!open || frame >= FRAMES.length - 1) return;
        const timer = window.setTimeout(() => setFrame((value) => Math.min(FRAMES.length - 1, value + 1)), 5_200);
        return () => window.clearTimeout(timer);
    }, [frame, open]);
    function deploy() {
        try { sessionStorage.setItem("worldCrisis.focus", "80"); } catch { /* best effort */ }
        setOpen(false); setScreen("worldCrisis");
    }
    const current = FRAMES[frame];
    return <>
        <article className="crisis-news-card crisis-news-card--reckoning">
            <button type="button" className="crisis-news-card__open" onClick={() => { setFrame(0); setOpen(true); }} aria-label={`Watch ${announcement.title} world news report`}>
                <span className="crisis-news-card__signal" aria-hidden="true"><i /><i /><i /><i /></span>
                <span className="crisis-news-card__copy"><small>MYTHIC WORLD REPORT · CLICK TO WATCH</small><strong>{announcement.title}</strong><span>{announcement.message}</span></span>
                <span className="crisis-news-card__meta"><b>▶ PLAY REPORT</b><time dateTime={new Date(announcement.ts).toISOString()}>{new Date(announcement.ts).toLocaleString()}</time></span>
            </button>
        </article>
        <Modal open={open} onClose={() => setOpen(false)} bare size="lg" ariaLabel="The Hollow Gate Reckoning world news report" className="crisis-cinematic-modal" backdropClassName="crisis-cinematic-backdrop">
            <div className={`crisis-cinematic crisis-cinematic--reckoning crisis-cinematic--frame-${frame}`} key={frame}>
                <img className="crisis-cinematic__reckoning-art" src={reckoningOutskirtsArt} alt="" />
                <div className="crisis-cinematic__villages" aria-hidden="true">{[stormveilArt, ashenLeafArt, frostfangArt, moonshadowArt].map((art, index) => <span key={art} style={{ backgroundImage: `url(${art})`, animationDelay: `${index * 90}ms` }} />)}</div>
                <div className="crisis-cinematic__veil" aria-hidden="true"><i /><i /><i /><i /></div>
                <button type="button" className="crisis-cinematic__close" onClick={() => setOpen(false)} aria-label="Close report">×</button>
                <div className="crisis-cinematic__reporter"><span>WORLD HERALD // WITNESS TRANSMISSION</span><b>{announcement.player ? `FIRST WITNESS: ${announcement.player}` : "THE FOUR REPORTS AGREE"}</b></div>
                <div className="crisis-cinematic__copy"><small>{current.kicker}</small><h2>{current.title}</h2><p>{current.body}</p></div>
                <div className="crisis-cinematic__controls"><div className="crisis-cinematic__steps" aria-label={`Report scene ${frame + 1} of ${FRAMES.length}`}>{FRAMES.map((entry, index) => <button key={entry.title} type="button" className={index === frame ? "is-active" : ""} onClick={() => setFrame(index)} aria-label={`Scene ${index + 1}: ${entry.title}`} />)}</div>{frame < FRAMES.length - 1 ? <button type="button" onClick={() => setFrame(frame + 1)}>Continue report →</button> : <button type="button" className="is-primary" onClick={deploy}>Choose a defense front →</button>}</div>
            </div>
        </Modal>
    </>;
}
