import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Modal } from "./ui/Modal";
import { playGameSfx } from "../lib/game-audio";
import "../styles/bloodline-ritual.css";

export type BloodlineRitualRank = "B Rank" | "A Rank" | "S Rank";

const RITUALS = {
    "B Rank": { mark: "B", color: "111, 209, 166", art: "/assets/awakening-bone-altar-v1.webp", material: "Bone Charms", rate: 0.9 },
    "A Rank": { mark: "A", color: "83, 159, 235", art: "/assets/awakening-aura-altar-v1.webp", material: "Aura Stones", rate: 1 },
    "S Rank": { mark: "S", color: "241, 202, 73", art: "/assets/awakening-mythic-altar-v1.webp", material: "Mythic Seals", rate: 0.8 },
} as const;

/** Runs only after the forge response has been committed. Finishing changes screens, never spends materials. */
export function BloodlineAwakeningCinematic({ rank, resumed, onFinished }: {
    rank: BloodlineRitualRank;
    resumed: boolean;
    onFinished: () => void;
}) {
    const ritual = RITUALS[rank];
    const titleId = useId();
    const descriptionId = useId();
    const [phase, setPhase] = useState<"binding" | "surge" | "revealed" | "leaving">("binding");
    const [reduceMotion] = useState(() => typeof window !== "undefined"
        && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
    const [opener] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement : null);
    const returnFocusRef = useRef(opener);
    const finished = useRef(false);
    const leaving = useRef(false);
    const timers = useRef<number[]>([]);
    const onFinishedRef = useRef(onFinished);
    useEffect(() => { onFinishedRef.current = onFinished; }, [onFinished]);

    const clearTimers = useCallback(() => {
        timers.current.forEach(window.clearTimeout);
        timers.current = [];
    }, []);
    const complete = useCallback(() => {
        if (finished.current) return;
        finished.current = true;
        clearTimers();
        onFinishedRef.current();
    }, [clearTimers]);
    const leave = useCallback(() => {
        if (finished.current || leaving.current) return;
        leaving.current = true;
        clearTimers();
        setPhase("leaving");
        timers.current.push(window.setTimeout(complete, 360));
    }, [clearTimers, complete]);

    useEffect(() => {
        if (reduceMotion) {
            // Scheduling also makes the mount/cleanup cycle safe under StrictMode.
            timers.current.push(window.setTimeout(complete, 0));
            return clearTimers;
        }
        playGameSfx("omen", { gain: 0.65, playbackRate: ritual.rate });
        timers.current.push(
            window.setTimeout(() => {
                setPhase("surge");
                playGameSfx("chakra-positive", { gain: 0.7, playbackRate: ritual.rate });
            }, 800),
            window.setTimeout(() => {
                setPhase("revealed");
                playGameSfx(rank === "S Rank" ? "mythic" : "reveal", { gain: 0.8, playbackRate: ritual.rate });
            }, 1700),
            window.setTimeout(leave, 3500),
        );
        return clearTimers;
    }, [clearTimers, complete, leave, rank, reduceMotion, ritual.rate]);

    if (reduceMotion) return null;
    return (
        <Modal open bare size="lg" disableBackdropClose onClose={leave}
            returnFocusRef={returnFocusRef}
            ariaLabelledBy={titleId} ariaDescribedBy={descriptionId}
            className="bl-ritual-dialog" backdropClassName="bl-ritual-backdrop">
            <div className="bl-ritual" data-rank={ritual.mark} data-phase={phase}
                style={{ "--ritual-rgb": ritual.color } as CSSProperties}>
                <img className="bl-ritual-art" src={ritual.art} alt="" aria-hidden="true" />
                <div className="bl-ritual-shade" aria-hidden="true" />
                <div className="bl-ritual-seal" aria-hidden="true">
                    <i /><i /><i /><span>{ritual.mark}</span>
                </div>
                <div className="bl-ritual-motes" aria-hidden="true">
                    {Array.from({ length: 18 }, (_, i) => <i key={i} style={{
                        "--mote-angle": `${i * 20}deg`, "--mote-delay": `${(i % 6) * 90}ms`,
                    } as CSSProperties} />)}
                </div>
                <header className="bl-ritual-heading">
                    <span>Bloodline Awakening</span>
                    <small>{resumed ? "Your ancestral bond endures" : `${ritual.material} · ancestral offering`}</small>
                </header>
                <div className="bl-ritual-copy">
                    <span className="bl-ritual-stage" aria-hidden="true">
                        {phase === "binding" ? "Binding the ancestral offering" : phase === "surge" ? "The seal answers your chakra" : "Your legacy awaits"}
                    </span>
                    <h2 id={titleId}>{rank} {resumed ? "Rekindled" : "Attuned"}</h2>
                    <p id={descriptionId}>Shape your bloodline. Inherit its power.</p>
                    <div className="bl-ritual-progress" aria-hidden="true"><i /></div>
                </div>
                <button type="button" className="bl-ritual-skip" onClick={leave} disabled={phase === "leaving"}>
                    Skip to builder <span aria-hidden="true">→</span>
                </button>
            </div>
        </Modal>
    );
}
