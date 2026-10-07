import { useEffect } from "react";
import { createPortal } from "react-dom";
import { GameArtIcon } from "./GameArtIcon";
import { starterItems } from "../data/starter-items";
import { gearStepSummary } from "../lib/items";
import "./GearDropToasts.css";

const SHOW_MS = 7000;
const MAX_VISIBLE = 3;

const ACCENT: Record<string, string> = {
    common: "#b8c0cc",
    uncommon: "#7bd88f",
    rare: "#5aa9ff",
    epic: "#c77dff",
    legendary: "#ffb347",
    mythic: "#ff6b6b",
};

type Drop = { key: number; itemId: string; extra?: number };

function GearDropToast({ drop, onDismiss }: { drop: Drop; onDismiss: (key: number) => void }) {
    useEffect(() => {
        const timer = window.setTimeout(() => onDismiss(drop.key), SHOW_MS);
        return () => window.clearTimeout(timer);
    }, [drop.key, onDismiss]);

    if (drop.extra) {
        return (
            <div className="gear-drop-toast" onClick={() => onDismiss(drop.key)}>
                <div className="gear-drop-icon">
                    <GameArtIcon className="gear-drop-fallback" kind="crown" size={34} />
                </div>
                <div className="gear-drop-body">
                    <span className="gear-drop-label">Gear received</span>
                    <strong>{drop.extra} more gear pieces</strong>
                    <small>They are in your bag.</small>
                </div>
            </div>
        );
    }
    const item = starterItems.find((candidate) => candidate.id === drop.itemId);
    if (!item) return null;
    // The new number, and what it improves on, so the card says why it is an upgrade.
    const detail = gearStepSummary(item) ?? "";
    const rarity = item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1);
    return (
        <div
            className="gear-drop-toast"
            style={{ ["--gear-accent" as string]: ACCENT[item.rarity] ?? ACCENT.common }}
            onClick={() => onDismiss(drop.key)}
        >
            <div className="gear-drop-icon">
                <GameArtIcon className="gear-drop-fallback" kind="crown" size={34} />
                {item.image && (
                    <img
                        src={item.image}
                        alt=""
                        onLoad={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = ""; }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                    />
                )}
            </div>
            <div className="gear-drop-body">
                <span className="gear-drop-label">{rarity} gear received</span>
                <strong>{item.name}</strong>
                <small>{detail}</small>
            </div>
        </div>
    );
}

/**
 * Portaled to the body so no side menu or shell stacking context can cover it.
 * It sits above modal dialogs on purpose: a drop is often earned in the same
 * moment a result dialog opens, and it must still be seen.
 */
export function GearDropToasts({ drops, onDismiss }: { drops: Drop[]; onDismiss: (key: number) => void }) {
    return createPortal(
        <div className="gear-drop-stack" role="status" aria-live="polite">
            {drops.slice(0, MAX_VISIBLE).map((drop) => (
                <GearDropToast key={drop.key} drop={drop} onDismiss={onDismiss} />
            ))}
        </div>,
        document.body,
    );
}
