/*
 * SageWhisper — the themed delivery for the Legacy system's atmospheric beats
 * (pre-50 rumors, "the Sage has appeared", "the Sage has moved on"). These are
 * the system's two most atmospheric moments and they used to render as native
 * alert() OS dialogs (depth-audit finding). A quiet card slides up with the
 * Sage's face; tap or wait to dismiss. Portaled to <body>.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import sageFace from "../assets/wanderers/legacy/wandering-sage.webp";

const AUTO_DISMISS_MS = 9000;

export function SageWhisper({ text, kicker = "A whisper on the road", onClose }: {
    text: string;
    kicker?: string;
    onClose: () => void;
}) {
    useEffect(() => {
        const t = setTimeout(onClose, AUTO_DISMISS_MS);
        return () => clearTimeout(t);
    }, [onClose]);

    return createPortal(
        <div
            role="status"
            onClick={onClose}
            style={{
                position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
                zIndex: 3000, maxWidth: "min(440px, calc(100vw - 28px))",
                display: "flex", gap: 12, alignItems: "center", cursor: "pointer",
                padding: "12px 16px", borderRadius: 14,
                background: "linear-gradient(160deg, rgba(30,20,60,.96), rgba(2,6,23,.96))",
                border: "1px solid rgba(192,132,252,.5)",
                boxShadow: "0 8px 30px rgba(0,0,0,.55), 0 0 24px rgba(192,132,252,.25)",
                animation: "sage-whisper-in .45s ease-out",
            }}
        >
            <img
                src={sageFace} alt=""
                style={{ width: 52, height: 52, borderRadius: "50%", border: "2px solid rgba(192,132,252,.6)", flexShrink: 0, objectFit: "cover" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: ".72rem", letterSpacing: ".08em", textTransform: "uppercase", color: "#c084fc", fontWeight: 700, marginBottom: 2 }}>
                    {kicker}
                </div>
                <div style={{ fontSize: ".8rem", color: "#e2e8f0", fontStyle: "italic", lineHeight: 1.45 }}>
                    “{text}”
                </div>
            </div>
            <style>{`@keyframes sage-whisper-in { from { opacity: 0; transform: translateX(-50%) translateY(14px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }`}</style>
        </div>,
        document.body,
    );
}
