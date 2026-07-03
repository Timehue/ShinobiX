/*
 * The Wandering Sage's offer sheet — shown after his VN introduction
 * (lib/legacy-sage-vn.ts). This is where the PERMANENT choice happens:
 * accepting runs the server's one-legacy-forever transaction
 * (api/legacy/sage.ts), guarded here by a double confirmation
 * (explicit warning card + gameConfirm danger dialog). Declining is always
 * free — the Sage simply leaves, and may return.
 *
 * Acceptance opens the LegacyMoment ceremony (the server auto-starts the
 * Trial of Awakening and returns it with the Sage's charge) and points the
 * player at Profile → Legacy — the system's most prestigious moment must not
 * land as a native alert() (polish-audit finding).
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { gameConfirm } from "./GameAlert";
import {
    sageAccept, sageDecline,
    type SageOfferView, type CharacterLegacy,
} from "../lib/legacy";
import { LegacyMoment, type LegacyMomentData } from "./LegacyMoment";
import wanderingSagePortrait from "../assets/wanderers/legacy/wandering-sage.webp";

export function SageOfferModal({ offer, playerName, onClose, onAccepted, onDeclined, onDismissed }: {
    offer: SageOfferView;
    playerName: string;
    onClose: () => void;
    onAccepted: (legacy: CharacterLegacy) => void;
    /** Fired after a server-confirmed decline so the caller can despawn the
     *  Sage and play the departure beat. */
    onDeclined: () => void;
    /** Fired when the offer turns out DEAD (expired/sealed) — despawn without
     *  the "I will find you again" departure whisper, which would lie to a
     *  sealed player (final-gate finding). Falls back to onDeclined. */
    onDismissed?: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    // The acceptance ceremony; while set, the modal waits behind it and closes
    // when the player continues.
    const [moment, setMoment] = useState<(LegacyMomentData & { legacy: CharacterLegacy }) | null>(null);

    async function handleDecline() {
        if (busy) return;
        setBusy(true);
        await sageDecline(playerName);
        setBusy(false);
        onDeclined();
        onClose();
    }

    async function handleAccept(legacyId: string) {
        if (busy) return;
        const picked = offer.offers.find((o) => o.legacyId === legacyId);
        if (!picked) return;
        const sure = await gameConfirm(
            `There is no undoing this — no respec, no exchange, ever. Accept the ${picked.name} and it is yours for life.`,
            { title: "The Point of No Return", confirmLabel: "I Accept This Path Forever", cancelLabel: "Go Back", danger: true },
        );
        if (!sure) return;
        setBusy(true);
        const result = await sageAccept(playerName, legacyId);
        setBusy(false);
        if (result?.ok && result.legacy) {
            setMoment({
                mode: "trial-start",
                kindName: "Trial of Awakening",
                legacyName: picked.name,
                rarity: picked.rarity,
                text: (result as { intro?: string }).intro
                    ?? "Then walk forward. Your first trial has already begun — the path is watching.",
                hint: "Your trial is already underway — track it anytime in Profile → 🌠 Legacy.",
                legacy: result.legacy,
            });
        } else if (result?.reason === "no-offer") {
            // The offer expired or was consumed elsewhere — retrying can never
            // succeed, so close cleanly and despawn the Sage (polish finding).
            setNote("“Ah… the moment has passed, shinobi. Do not mourn it — I found you once, and I will find you again.”");
            setTimeout(() => { (onDismissed ?? onDeclined)(); onClose(); }, 3500);
        } else if (result?.reason === "sealed") {
            setNote("Your path was already sealed to another Legacy. The Sage bows and departs.");
            setTimeout(() => { (onDismissed ?? onDeclined)(); onClose(); }, 3500);
        } else {
            setNote("The Sage pauses — the threads are tangled. Give it a moment, then choose again.");
        }
    }

    return createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgba(0,0,0,.65)", padding: 12 }}>
            <div className="card" style={{ maxWidth: 460, width: "94%", maxHeight: "88dvh", overflowY: "auto", padding: 16 }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
                    <img src={wanderingSagePortrait} alt="Wandering Sage" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "50%", border: "2px solid #c084fc" }} />
                    <div>
                        <h3 style={{ margin: 0 }}>The Wandering Sage</h3>
                        <p style={{ margin: 0, fontSize: ".75rem", color: "#9aa3b2" }}>“Your path has opened these legacies to you.”</p>
                    </div>
                </div>

                <div style={{ background: "rgba(192,132,252,.08)", border: "1px solid rgba(192,132,252,.35)", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
                    <p style={{ margin: 0, fontSize: ".78rem", color: "#e9d5ff" }}>
                        ⚠ A Legacy is <b>permanent</b>. You may only ever accept <b>one</b> — forever. Turning the Sage down is always free.
                    </p>
                </div>

                {offer.offers.map((o) => (
                    <div
                        key={o.legacyId}
                        onClick={() => setSelected(selected === o.legacyId ? null : o.legacyId)}
                        style={{
                            border: `1px solid ${selected === o.legacyId ? "#c084fc" : "rgba(148,163,184,.25)"}`,
                            borderRadius: 10, padding: "10px 12px", marginBottom: 8, cursor: "pointer",
                            background: selected === o.legacyId ? "rgba(148,163,184,.08)" : "transparent",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                {o.badge && (
                                    <img
                                        src={`/badges/legacy-${o.badge}.png`} alt=""
                                        style={{ width: 34, height: 34, borderRadius: 6, flexShrink: 0 }}
                                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                    />
                                )}
                                <b style={{ color: "#c084fc" }}>{o.name}</b>
                            </span>
                        </div>
                        <p style={{ margin: "4px 0 0", fontSize: ".78rem", color: "#cbd5e1", fontStyle: "italic" }}>{o.flavor}</p>
                        <p style={{ margin: "4px 0 0", fontSize: ".72rem", color: "#9aa3b2" }}>
                            Title on awakening: <b style={{ color: "#e2e8f0" }}>{o.title}</b>
                            {o.villageAffinity ? ` · Favored by ${o.villageAffinity}` : ""}
                        </p>
                        {selected === o.legacyId && (
                            <button
                                disabled={busy}
                                onClick={(e) => { e.stopPropagation(); void handleAccept(o.legacyId); }}
                                style={{ marginTop: 8, width: "100%", background: "#c084fc", color: "#0b1020", fontWeight: 700 }}
                            >
                                Accept This Path
                            </button>
                        )}
                    </div>
                ))}

                {note && (
                    <p style={{ margin: "10px 0 0", fontSize: ".78rem", color: "#fbbf24", fontStyle: "italic" }}>{note}</p>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button disabled={busy} onClick={() => void handleDecline()} style={{ flex: 1 }}>
                        Turn Down for Now
                    </button>
                    <button disabled={busy} onClick={onClose} style={{ flex: 1 }}>
                        Step Away
                    </button>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: ".7rem", color: "#9aa3b2", textAlign: "center" }}>
                    Turn him down and he departs for a few days · step away and he keeps waiting here.
                </p>
            </div>

            {/* Acceptance ceremony — closing it finishes the accept flow. */}
            {moment && (
                <LegacyMoment
                    moment={moment}
                    onClose={() => {
                        const legacy = moment.legacy;
                        setMoment(null);
                        onAccepted(legacy);
                        onClose();
                    }}
                />
            )}
        </div>,
        document.body,
    );
}
