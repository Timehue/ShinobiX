/*
 * SparCoach — a READ-ONLY in-battle coaching banner for the onboarding "Academy
 * spar" (the guaranteed-first-win fight). It only renders during that fight and
 * never touches combat logic: it just reads two display-only flags (did the
 * player Basic Attack yet / cast a Jutsu yet) plus current AP and enemy HP, and
 * shows the next thing to do. Pinned to the TOP of the screen so it can never
 * cover the bottom action bar; always dismissible so it can never trap.
 */
import { useState } from "react";
import { createPortal } from "react-dom";

export function SparCoach({
    attacked, casted, ap, enemyHp, enemyMaxHp,
}: {
    attacked: boolean;
    casted: boolean;
    ap: number;
    enemyHp: number;
    enemyMaxHp: number;
}) {
    const [hidden, setHidden] = useState(false);
    if (hidden || enemyHp <= 0) return null;

    let msg: string;
    if (enemyMaxHp > 0 && enemyHp <= enemyMaxHp * 0.25) {
        msg = "🎯 Almost there — one more hit finishes the dummy!";
    } else if (!attacked) {
        msg = "⚔️ Tap Attack (bottom bar) to strike the training dummy.";
    } else if (!casted) {
        msg = "🔥 Nice hit! Now use one of your Jutsu from the bar below.";
    } else if (ap < 40) {
        msg = "⏳ Low on AP — tap Wait to end your turn and recover.";
    } else {
        msg = "💪 Keep attacking — drop the dummy's HP to zero to win.";
    }

    return createPortal(
        <div
            className="spar-coach-banner"
            style={{
                position: "fixed",
                left: "50%",
                top: "calc(8px + env(safe-area-inset-top, 0px))",
                transform: "translateX(-50%)",
                maxWidth: 460,
                width: "calc(100% - 24px)",
                background: "linear-gradient(180deg, rgba(12,18,34,0.96), rgba(6,10,22,0.98))",
                border: "1px solid var(--bsv2-gold-bright, #e8d496)",
                borderRadius: 12,
                color: "#f8fafc",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                zIndex: 60,
                boxShadow: "0 6px 24px rgba(0,0,0,0.55)",
                fontSize: 14,
            }}
        >
            <span style={{ flex: 1, lineHeight: 1.4 }}><strong>Academy Spar:</strong> {msg}</span>
            <button
                onClick={() => setHidden(true)}
                aria-label="Dismiss tutorial hint"
                style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
            >
                ×
            </button>
        </div>,
        document.body,
    );
}
