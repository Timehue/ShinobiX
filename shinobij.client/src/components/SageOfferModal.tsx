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
import { useCallback, useEffect, useRef, useState } from "react";
import { gameConfirm } from "./GameAlert";
import {
    buildChronicleRecordReceipt, sageAccept, sageDecline,
    type SageOfferView,
} from "../lib/legacy";
import type { Character } from "../types/character";
import { LegacyMoment, type LegacyMomentData } from "./LegacyMoment";
import wanderingSagePortrait from "../assets/wanderers/legacy/wandering-sage.webp";
import { Modal } from "./ui/Modal";

export function SageOfferModal({ offer, playerName, actionsAllowed, canMutate, onClose, onAccepted, onVersionedCharacter, onDeclined, onDismissed }: {
    offer: SageOfferView;
    playerName: string;
    actionsAllowed: boolean;
    /** Rechecks the expiring live-capability lease immediately before a POST. */
    canMutate: () => boolean;
    onClose: () => void;
    onAccepted: () => void;
    /** Adopts the server's full save mutation before the ceremony can leave an
     * autosave running on the pre-accept version. False rejects a stale reply. */
    onVersionedCharacter: (character: Character, saveVersion: number) => boolean | void;
    /** Fired after a server-confirmed decline so the caller can despawn the
     *  Sage and play the departure beat. */
    onDeclined: () => void;
    /** Fired when the offer turns out DEAD (expired/sealed) — despawn without
     *  the "I will find you again" departure whisper, which would lie to a
     *  sealed player (final-gate finding). Falls back to onDeclined. */
    onDismissed?: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const mountedRef = useRef(false);
    const requestRef = useRef(0);
    const departureTimerRef = useRef<number | null>(null);
    const [selected, setSelected] = useState<string | null>(() => offer.offers.length === 1 ? offer.offers[0].legacyId : null);
    const [note, setNote] = useState<string | null>(null);
    // The acceptance ceremony; while set, the modal waits behind it and closes
    // when the player continues.
    const [moment, setMoment] = useState<LegacyMomentData | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestRef.current += 1;
            if (departureTimerRef.current !== null) window.clearTimeout(departureTimerRef.current);
        };
    }, []);

    function scheduleDeparture(callback: () => void) {
        if (departureTimerRef.current !== null) window.clearTimeout(departureTimerRef.current);
        departureTimerRef.current = window.setTimeout(() => {
            departureTimerRef.current = null;
            if (mountedRef.current) callback();
        }, 3500);
    }

    async function handleDecline() {
        if (busyRef.current) return;
        if (!actionsAllowed || !canMutate()) {
            setNote("Legacy choices are paused until live service admission returns. You can safely step away; the offer remains server-owned.");
            return;
        }
        const request = ++requestRef.current;
        busyRef.current = true;
        setBusy(true);
        try {
            const result = await sageDecline(playerName);
            if (!mountedRef.current || request !== requestRef.current) return;
            if (!result?.ok) {
                setNote("The Sage could not confirm your answer. Check your connection and try again.");
                return;
            }
            onDeclined();
            onClose();
        } finally {
            busyRef.current = false;
            if (mountedRef.current && request === requestRef.current) setBusy(false);
        }
    }

    async function handleAccept(legacyId: string) {
        if (busyRef.current) return;
        if (!actionsAllowed || !canMutate()) {
            setNote("Legacy choices are paused until live service admission returns. No permanent choice was submitted.");
            return;
        }
        const picked = offer.offers.find((o) => o.legacyId === legacyId);
        if (!picked) return;
        const request = ++requestRef.current;
        busyRef.current = true;
        setBusy(true);
        try {
            const sure = await gameConfirm(
                `You may only ever have ONE Legacy. This cannot be changed later — no respec, no exchange, ever. Accept the ${picked.name} and it is yours for life.`,
                { title: "The Point of No Return", confirmLabel: "I Accept This Path Forever", cancelLabel: "Go Back", danger: true },
            );
            if (!mountedRef.current || request !== requestRef.current || !sure) return;
            if (!canMutate()) {
                setNote("Legacy choices paused while you were deciding. No permanent choice was submitted.");
                return;
            }
            const result = await sageAccept(playerName, legacyId);
            if (!mountedRef.current || request !== requestRef.current) return;
            if (result?.ok && result.legacy) {
                if (!result.character || typeof result._saveVersion !== "number") {
                    setNote("The Sage sealed your path, but the Hall's record did not arrive. Refresh before continuing.");
                    return;
                }
                if (onVersionedCharacter(result.character, result._saveVersion) === false) {
                    setNote("A newer character record is already active. The Sage's older reply was safely ignored.");
                    return;
                }
                const chronicleRecord = buildChronicleRecordReceipt(result.chronicleCards, "sage-acceptance");
                setMoment({
                    mode: "trial-start",
                    kindName: "Trial of Awakening",
                    legacyName: picked.name,
                    text: result.intro
                        ?? "Then walk forward. Your first trial has already begun — the path is watching.",
                    hint: "Your trial is already underway — track it anytime in Profile → 🌠 Legacy.",
                    ...(chronicleRecord ? { chronicleRecord } : {}),
                });
            } else if (result?.reason === "no-offer") {
                setNote("“Ah… the moment has passed, shinobi. Do not mourn it — I found you once, and I will find you again.”");
                scheduleDeparture(() => { (onDismissed ?? onDeclined)(); onClose(); });
            } else if (result?.reason === "sealed") {
                setNote("Your path was already sealed to another Legacy. The Sage bows and departs.");
                scheduleDeparture(() => { (onDismissed ?? onDeclined)(); onClose(); });
            } else {
                setNote("The Sage could not confirm your permanent choice. Refresh your character before choosing again.");
            }
        } finally {
            busyRef.current = false;
            if (mountedRef.current && request === requestRef.current) setBusy(false);
        }
    }

    /*
     * Escape and "Step Away" are NOT gated on busy, deliberately.
     *
     * sageAccept/sageDecline go through postJson, which is a bare fetch with no
     * AbortController and no timeout, so a stalled connection leaves the promise
     * pending forever. This modal used to disable all four of its exits while
     * that was in flight — both buttons, the backdrop, and Escape via this
     * callback — which meant one dropped connection trapped the player in a
     * dialog with every control dead and only a refresh out.
     *
     * SessionExpiredModal already carries this lesson: "an escape hatch a busy
     * flag can disable is no hatch at all". This modal's own copy makes the
     * promise explicit too — "stepping away remains safe", "step away and he
     * keeps waiting here" — so disabling that button contradicted the text
     * beside it.
     *
     * Stepping away mid-request is safe: an in-flight decline may still land
     * server-side, which is exactly what the button said would happen anyway,
     * and the mountedRef/requestRef guards already stop a late response
     * touching state. The backdrop stays guarded because it is easy to hit by
     * accident and is not the only way out.
     */
    const close = useCallback(() => { onClose(); }, [onClose]);

    return (
        <>
        <Modal open onClose={close} ariaLabel="The Wandering Sage legacy offer" size="md" bare disableBackdropClose={busy}>
            <div className="card" style={{ maxWidth: 460, width: "94%", maxHeight: "88dvh", overflowY: "auto", padding: 16 }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
                    <img src={wanderingSagePortrait} alt="Wandering Sage" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "50%", border: "2px solid var(--purple-400)" }} />
                    <div>
                        <h3 style={{ margin: 0 }}>The Wandering Sage</h3>
                        <p style={{ margin: 0, fontSize: ".75rem", color: "#9aa3b2" }}>“Your path has opened these legacies to you.”</p>
                    </div>
                </div>

                <p style={{ margin: "0 0 10px", fontSize: ".76rem", color: "var(--slate-300)" }}>
                    A <b>Legacy</b> is a permanent identity path — it grants you a <b>signature technique</b> and
                    deepens through five stages as you prove it. It is separate from your bloodline, and forever.
                </p>

                <div style={{ background: "rgba(192,132,252,.08)", border: "1px solid rgba(192,132,252,.35)", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
                    <p style={{ margin: 0, fontSize: ".78rem", color: "#e9d5ff" }}>
                        ⚠ A Legacy is <b>permanent</b>. You may only ever accept <b>one</b> — forever. Turning the Sage down is always free.
                    </p>
                </div>

                {/* Your Three Paths — an at-a-glance compare strip; tapping one
                    selects it and scrolls to its full card below. Identity only
                    (name/category/village/signature), never rank/rarity. */}
                {offer.offers.length > 1 && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        {offer.offers.map((o) => (
                            <button
                                key={o.legacyId}
                                type="button"
                                onClick={() => { setSelected(o.legacyId); document.getElementById(`offer-card-${o.legacyId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}
                                style={{ flex: 1, minWidth: 0, textAlign: "center", cursor: "pointer", border: `1px solid ${selected === o.legacyId ? "var(--purple-400)" : "rgba(148,163,184,.25)"}`, background: selected === o.legacyId ? "rgba(192,132,252,.12)" : "transparent", borderRadius: 10, padding: "8px 6px" }}
                            >
                                {o.badge && <img src={`/badges/legacy-${o.badge}.webp`} alt="" style={{ width: 30, height: 30, borderRadius: 6, display: "block", margin: "0 auto 4px" }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
                                <div style={{ fontSize: ".68rem", fontWeight: 700, color: "#e9d5ff", lineHeight: 1.15 }}>{o.name.replace(/^Legacy of the /, "")}</div>
                                <div style={{ fontSize: ".6rem", color: "var(--text-dim)", textTransform: "capitalize", marginTop: 2 }}>{o.category}{o.villageAffinity ? ` · ${o.villageAffinity}` : ""}</div>
                                {o.signature?.name && <div style={{ fontSize: ".6rem", color: "#c4b5fd", marginTop: 2 }}>◆ {o.signature.name}</div>}
                            </button>
                        ))}
                    </div>
                )}

                {offer.offers.map((o) => (
                    <article
                        key={o.legacyId}
                        id={`offer-card-${o.legacyId}`}
                        style={{
                            border: `1px solid ${selected === o.legacyId ? "var(--purple-400)" : "rgba(148,163,184,.25)"}`,
                            borderRadius: 10, padding: "10px 12px", marginBottom: 8,
                            background: selected === o.legacyId ? "rgba(148,163,184,.08)" : "transparent",
                        }}
                    >
                        <button
                            type="button"
                            aria-label={`Select ${o.name}`}
                            aria-pressed={selected === o.legacyId}
                            onClick={() => setSelected(o.legacyId)}
                            style={{ display: "block", width: "100%", border: 0, padding: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer" }}
                        >
                            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                    {o.badge && (
                                        <img
                                            src={`/badges/legacy-${o.badge}.webp`} alt=""
                                            style={{ width: 34, height: 34, borderRadius: 6, flexShrink: 0 }}
                                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                        />
                                    )}
                                    <b style={{ color: "var(--purple-400)" }}>{o.name}</b>
                                </span>
                            </span>
                            <span style={{ display: "block", margin: "4px 0 0", fontSize: ".78rem", color: "var(--slate-300)", fontStyle: "italic" }}>{o.flavor}</span>
                            <span style={{ display: "block", margin: "4px 0 0", fontSize: ".72rem", color: "#9aa3b2" }}>
                                Title on awakening: <b style={{ color: "var(--slate-200)" }}>{o.title}</b>
                                {o.villageAffinity ? ` · Favored by ${o.villageAffinity}` : ""}
                            </span>
                            {o.signature && (
                                // Rank-free power preview — what the signature DOES, no numbers
                                // that would reveal the hidden rank.
                                <span style={{ display: "block", margin: "4px 0 0", fontSize: ".72rem", color: "#c4b5fd" }}>
                                    ◆ Signature: <b>{o.signature.name}</b> — {o.signature.shape}
                                    {o.signature.effects.length ? ` · ${o.signature.effects.join(", ")}` : ""}. Unlocks at Stage III.
                                </span>
                            )}
                        </button>
                        {selected === o.legacyId && (
                            <button
                                type="button"
                                disabled={busy || !actionsAllowed}
                                onClick={() => { void handleAccept(o.legacyId); }}
                                style={{ marginTop: 8, width: "100%", background: "var(--purple-400)", color: "#0b1020", fontWeight: 700 }}
                            >
                                Accept This Path
                            </button>
                        )}
                    </article>
                ))}

                {note && (
                    <p role="alert" aria-live="assertive" aria-atomic="true" style={{ margin: "10px 0 0", fontSize: ".78rem", color: "#fbbf24", fontStyle: "italic" }}>{note}</p>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button disabled={busy || !actionsAllowed} onClick={() => void handleDecline()} style={{ flex: 1 }}>
                        Turn Down for Now
                    </button>
                    <button onClick={onClose} style={{ flex: 1 }}>
                        Step Away
                    </button>
                </div>
                {!actionsAllowed && <p role="status" style={{ margin: "8px 0 0", fontSize: ".76rem", color: "#fbbf24", textAlign: "center" }}>Legacy choices are temporarily paused. Reading the offer and stepping away remain safe.</p>}
                <p style={{ margin: "6px 0 0", fontSize: ".7rem", color: "#9aa3b2", textAlign: "center" }}>
                    Turn him down and he departs for a few days · step away and he keeps waiting here.
                </p>
            </div>
        </Modal>

            {/* Acceptance ceremony — closing it finishes the accept flow. */}
            {moment && (
                <LegacyMoment
                    moment={moment}
                    onClose={() => {
                        setMoment(null);
                        onAccepted();
                        onClose();
                    }}
                />
            )}
        </>
    );
}
