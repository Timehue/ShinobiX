/*
 * The Wandering Sage's offer sheet — shown after his VN introduction
 * (lib/legacy-sage-vn.ts). This is where the PERMANENT choice happens:
 * accepting runs the server's one-legacy-forever transaction
 * (api/legacy/sage.ts), guarded here by a double confirmation
 * (explicit warning card + gameConfirm danger dialog). Declining is always
 * free — the Sage simply leaves, and may return.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { gameConfirm } from "./GameAlert";
import {
    sageAccept, sageDecline, RARITY_COLORS, RARITY_LABELS,
    type SageOfferView, type CharacterLegacy,
} from "../lib/legacy";
import wanderingSagePortrait from "../assets/wanderers/legacy/wandering-sage.webp";

export function SageOfferModal({ offer, playerName, onClose, onAccepted, onDeclined }: {
    offer: SageOfferView;
    playerName: string;
    onClose: () => void;
    onAccepted: (legacy: CharacterLegacy) => void;
    /** Fired after a server-confirmed decline so the caller can despawn the
     *  Sage — otherwise a ghost NPC lingers with a dead offer behind him. */
    onDeclined: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);

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
            `This choice is permanent. You can only have one Legacy forever. If you accept the ${picked.name}, your path is sealed.`,
            { title: "The Point of No Return", confirmLabel: "I Accept This Path Forever", cancelLabel: "Go Back", danger: true },
        );
        if (!sure) return;
        setBusy(true);
        const result = await sageAccept(playerName, legacyId);
        setBusy(false);
        if (result?.ok && result.legacy) {
            alert(`Then walk forward. From this moment, your Legacy has begun: ${picked.name}.`);
            onAccepted(result.legacy);
            onClose();
        } else {
            alert(result?.reason === 'sealed'
                ? 'Your path was already sealed to another Legacy.'
                : 'The Sage pauses — the offer could not be sealed. Try again in a moment.');
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
                            border: `1px solid ${selected === o.legacyId ? RARITY_COLORS[o.rarity] : "rgba(148,163,184,.25)"}`,
                            borderRadius: 10, padding: "10px 12px", marginBottom: 8, cursor: "pointer",
                            background: selected === o.legacyId ? "rgba(148,163,184,.08)" : "transparent",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                            <b style={{ color: RARITY_COLORS[o.rarity] }}>{o.name}</b>
                            <span style={{ fontSize: ".7rem", color: RARITY_COLORS[o.rarity], whiteSpace: "nowrap" }}>{RARITY_LABELS[o.rarity]}</span>
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
                                style={{ marginTop: 8, width: "100%", background: RARITY_COLORS[o.rarity], color: "#0b1020", fontWeight: 700 }}
                            >
                                Accept This Path
                            </button>
                        )}
                    </div>
                ))}

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button disabled={busy} onClick={() => void handleDecline()} style={{ flex: 1 }}>
                        Turn Down for Now
                    </button>
                    <button disabled={busy} onClick={onClose} style={{ flex: 1 }}>
                        Step Away
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
