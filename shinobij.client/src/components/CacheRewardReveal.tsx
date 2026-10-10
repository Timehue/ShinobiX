import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { GameArtIcon, type GameArtIconKind } from "./GameArtIcon";
import { Modal } from "./ui/Modal";
import crateClosed from "../assets/festival/bm-crate-closed.webp";
import crateOpen from "../assets/festival/bm-crate-open.webp";
import "../styles/cache-reward-reveal.css";

export type CacheRevealReward = {
    id: string;
    name: string;
    quantity: number;
    prefix?: "+" | "×";
    detail?: string;
    iconSrc?: string;
    iconKind?: GameArtIconKind;
};

export function CacheRewardReveal({
    open,
    title,
    rewards,
    onClose,
    rewardKey,
    returnFocusRef,
    intro = "A sealed cache rattles in your hands…",
    deliveryCopy = "These rewards have been added to your inventory.",
    revealLabel = "Open the cache",
    collectLabel = "Collect rewards",
    emptyCopy = "No items were found.",
    accent = "#f5c56e",
    glow = "rgba(245, 197, 110, .55)",
    jackpot = false,
    autoRevealAfterMs,
}: {
    open: boolean;
    title: string;
    rewards: CacheRevealReward[];
    onClose: () => void;
    rewardKey?: string;
    returnFocusRef?: RefObject<HTMLElement | null>;
    intro?: string;
    deliveryCopy?: string;
    revealLabel?: string;
    collectLabel?: string;
    emptyCopy?: string;
    accent?: string;
    glow?: string;
    jackpot?: boolean;
    autoRevealAfterMs?: number;
}) {
    const [revealedForKey, setRevealedForKey] = useState<string | null>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const theme = { "--cache-reveal-accent": accent, "--cache-reveal-glow": glow } as CSSProperties;
    const revealKey = rewardKey ?? title;
    const revealed = open && revealedForKey === revealKey;

    useEffect(() => {
        if (!open || autoRevealAfterMs == null) return;
        const timeout = window.setTimeout(() => {
            setRevealedForKey(revealKey);
            requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
        }, Math.max(0, autoRevealAfterMs));
        return () => window.clearTimeout(timeout);
    }, [autoRevealAfterMs, open, revealKey]);

    function reveal() {
        setRevealedForKey(revealKey);
        requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    }

    function close() {
        setRevealedForKey(null);
        onClose();
    }

    return (
        <Modal
            open={open}
            onClose={close}
            bare
            ariaLabel={`${title} reward reveal`}
            className="cache-reveal-dialog"
            backdropClassName="cache-reveal-overlay"
            returnFocusRef={returnFocusRef}
        >
            <section className={`cache-reveal-stage${jackpot ? " cache-reveal-stage--jackpot" : ""}`} style={theme}>
                <p className="cache-reveal-overline">REWARD CACHE</p>
                {!revealed ? (
                    <>
                        <h2 className="cache-reveal-title">{title}</h2>
                        <div className="cache-reveal-chest-wrap">
                            <img src={crateClosed} alt="" className="cache-reveal-chest cache-reveal-chest--closed" />
                        </div>
                        <p className="cache-reveal-copy">{intro}</p>
                        <button type="button" className="cache-reveal-action" onClick={reveal}>{revealLabel}</button>
                        <button type="button" className="cache-reveal-skip" onClick={close}>Close</button>
                    </>
                ) : (
                    <>
                        <h2 ref={titleRef} tabIndex={-1} className="cache-reveal-title cache-reveal-title--result">{title}</h2>
                        <div className="cache-reveal-chest-wrap cache-reveal-chest-wrap--open">
                            <img src={crateOpen} alt="" className="cache-reveal-chest cache-reveal-chest--open" />
                        </div>
                        <div className="cache-reveal-rewards" role="status" aria-label="Items received">
                            {rewards.length ? rewards.map((reward, index) => (
                                <div className="cache-reveal-reward" key={`${reward.id}-${index}`} style={{ animationDelay: `${index * 70}ms` }}>
                                    <span className="cache-reveal-reward-icon">
                                        {reward.iconSrc
                                            ? <img src={reward.iconSrc} alt="" />
                                            : <GameArtIcon kind={reward.iconKind ?? "reward"} size={34} />}
                                    </span>
                                    <span className="cache-reveal-reward-copy">
                                        <strong className="cache-reveal-reward-name">{reward.name}</strong>
                                        {reward.detail && <small className="cache-reveal-reward-detail">{reward.detail}</small>}
                                    </span>
                                    <strong className="cache-reveal-reward-count">{reward.prefix ?? "×"}{reward.quantity.toLocaleString()}</strong>
                                </div>
                            )) : <p className="cache-reveal-empty">{emptyCopy}</p>}
                        </div>
                        <p className="cache-reveal-copy cache-reveal-copy--credited">{deliveryCopy}</p>
                        <button type="button" className="cache-reveal-action" onClick={close}>{collectLabel}</button>
                    </>
                )}
            </section>
        </Modal>
    );
}
