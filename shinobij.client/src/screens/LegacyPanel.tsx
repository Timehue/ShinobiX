/*
 * Legacy panel (Profile tab) — the player's identity path at a glance:
 * accepted legacy + stage, the active trial with live objective progress,
 * and a deliberately VAGUE "strongest paths" reading (bucketed tiers from
 * the server — never raw counters or thresholds; the mystery rule).
 */
import { useCallback, useEffect, useState } from "react";
import type { Character } from "../types/character";
import {
    fetchLegacyStatus, fetchLegacyDefinitions, trialStart, trialComplete, trialReroll,
    isLegacyEnabled, TRIAL_STAT_LABELS, eraAgeName,
    type LegacyStatusView, type LegacyDefView, type CharacterLegacy,
} from "../lib/legacy";
import { PlayerNameplate } from "../components/PlayerNameplate";
import { LegacyMoment, type LegacyMomentData } from "../components/LegacyMoment";
import { rollEmissarySpawn, emissaryForCategory } from "../lib/legacy-emissaries";
import { rumorLog } from "../lib/legacy-rumors";
import { wandererDayBucket, isWanderersEnabled } from "../lib/wanderers";
import { sectorRegionName } from "../data/sectors";
import { LEGACY_JUTSU_BY_ID, LEGACY_JUTSU_ID_BY_LEGACY } from "../data/legacy-jutsu";
import { LEGACY_SIGNATURE_MIN_STAGE, legacySignatureMasteryLevel } from "../lib/legacy-jutsu-slot";

// The single legacy accent — a Legacy's rank is owner-only and never shown or
// separated in any player-facing surface, so every legacy uses the same colour.
const LEGACY_ACCENT = "#c084fc";

const STAGE_ROMAN = ["", "I", "II", "III", "IV", "V"];
const STAGE_NAMES: Record<number, string> = {
    1: "Path Accepted", 2: "Awakened", 3: "Bound", 4: "Proven", 5: "Mythic",
};
const TRIAL_NAMES: Record<string, string> = {
    awaken: "Trial of Awakening", bind: "Trial of Binding",
    prove: "Trial of Proving", mythic: "The Mythic Trial",
};
// Per-kind card accent: the four trials should not look interchangeable.
const TRIAL_ACCENTS: Record<string, string> = {
    awaken: "#60a5fa", bind: "#4ade80", prove: "#f59e0b", mythic: "#c084fc",
};
// current stage → the trial that carries you to the NEXT stage (at stage 1 the
// awaken trial takes you to 2, etc.). Used for the "what's next" beat.
const NEXT_TRIAL_BY_STAGE: Record<number, string> = { 1: "awaken", 2: "bind", 3: "prove", 4: "mythic" };

// The five dated waypoints of a player's own journey — only stages actually
// reached carry a timestamp (server-stamped, permanent). Player-owned facts,
// never rank/rarity.
function stageSaga(l: CharacterLegacy): Array<{ stage: number; ts: number }> {
    return [
        { stage: 1, ts: l.acceptedAt },
        { stage: 2, ts: l.awakenedAt ?? 0 },
        { stage: 3, ts: l.boundAt ?? 0 },
        { stage: 4, ts: l.provenAt ?? 0 },
        { stage: 5, ts: l.mythicAt ?? 0 },
    ].filter((r) => r.ts > 0);
}
// The trial-giver emissary's one-line acknowledgement of WHICH climb this is —
// keyed on the active trial kind (a stage marker), never on rank. Additive.
const STAGE_WITNESS: Record<string, string> = {
    awaken: "This is the first waking of your path. Show me it is real.",
    bind: "Here the path and its bearer stop being two things. Do not flinch.",
    prove: "You carry the name already. Now earn the right to keep it.",
    mythic: "This is the last thing the path will ever ask of you. Make it worthy.",
};
// A short relative-age string for a saga/timeline date (render reads Date.now
// once via the caller's nowTs snapshot to stay purity-clean).
function agoLabel(ts: number, now: number): string {
    const days = Math.floor((now - ts) / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}
// Codex facet chip — category is a gameplay identity axis, never rarity.
function codexChipStyle(active: boolean): React.CSSProperties {
    return {
        padding: "3px 10px", borderRadius: 999, fontSize: ".72rem", cursor: "pointer",
        border: `1px solid ${active ? LEGACY_ACCENT : "rgba(148,163,184,.28)"}`,
        background: active ? `${LEGACY_ACCENT}22` : "transparent",
        color: active ? "#e9d5ff" : "#9aa3b2",
    };
}

export function LegacyPanel({ character, onLegacyChanged }: {
    character: Character;
    /** Fired after a server-confirmed legacy change (accept elsewhere / stage-up
     *  here) with the fresh server legacy + any granted title, so the host can
     *  sync the client character (aura, title picker) without a relog. */
    onLegacyChanged?: (legacy?: Character["legacy"], grantedTitle?: string | null) => void;
}) {
    const enabled = isLegacyEnabled();
    const [status, setStatus] = useState<LegacyStatusView | null>(null);
    const [defs, setDefs] = useState<Map<string, LegacyDefView> | null>(null);
    const [busy, setBusy] = useState(false);
    // The ceremonial full-screen beat (trial start / stage-up) + inline notes.
    const [moment, setMoment] = useState<LegacyMomentData | null>(null);
    const [trialNote, setTrialNote] = useState<string | null>(null);
    // Mount-time clock for the offer countdown (hour granularity — a render-
    // pure snapshot is plenty; Date.now() in render trips react-hooks/purity).
    const [nowTs] = useState(() => Date.now());
    const [codexQuery, setCodexQuery] = useState("");
    // Codex browse state: an optional category facet. Entries are deliberately
    // NOT openable — the codex names each path and its flavor, never the
    // technique it grants. What a legacy gives is earned, not shopped for (the
    // mystery rule); a browsable reward list would sway the choice it hides.
    const [codexCategory, setCodexCategory] = useState<string | null>(null);
    // Flag-off mounts have nothing to load; they render the null branch below.
    const [loaded, setLoaded] = useState(!enabled);

    const reload = useCallback(() => {
        void fetchLegacyStatus(character.name).then((s) => { setStatus(s); setLoaded(true); });
    }, [character.name]);

    useEffect(() => {
        if (!enabled) return;
        reload();
        void fetchLegacyDefinitions().then((d) => {
            if (d) setDefs(new Map(d.legacies.map((l) => [l.id, l])));
        });
    }, [enabled, reload]);

    if (!isLegacyEnabled()) return null;
    if (!loaded) return <p style={{ color: "#9aa3b2", fontSize: ".8rem" }}>Reading the threads of your path…</p>;
    if (!status) {
        return <p style={{ color: "#9aa3b2", fontSize: ".8rem" }}>The world of Legacies has not awakened yet.</p>;
    }

    const def = status.legacy ? defs?.get(status.legacy.legacyId) ?? null : null;

    async function handleTrial(action: "start" | "complete" | "reroll") {
        if (busy) return;
        setBusy(true);
        if (action === "start" || action === "reroll") {
            const result = action === "start" ? await trialStart(character.name) : await trialReroll(character.name);
            if (result?.ok && result.trial && def) {
                // The trial-giver is the emissary serving this Legacy's category
                // (the in-world overseer), not the Sage — attribute the charge to
                // them and give the ceremony their face. Falls back to the Sage's
                // voice if no emissary matches (older saves / unmapped category).
                const em = emissaryForCategory(status?.legacyCategory ?? def.category);
                // A reroll reshapes the SAME trial — acknowledge it in-world instead
                // of replaying the opening charge (client-only; action is known here).
                const reshaped = action === "reroll";
                setMoment({
                    mode: "trial-start",
                    kindName: reshaped ? "The Trial, Reshaped" : (TRIAL_NAMES[result.trial.kind] ?? "Legacy Trial"),
                    legacyName: def.name,
                    rarity: def.rarity,
                    text: reshaped
                        ? "You asked me to pose this differently. So I have — the height is the same, the road is new."
                        : (result.intro ?? "Walk your path where the world can see it."),
                    ...(em ? { speaker: { name: em.name, portrait: `/portraits/${em.slug}.webp` } } : {}),
                });
            }
        } else {
            const result = await trialComplete(character.name);
            if (result?.ok && result.legacy && def) {
                setMoment({
                    mode: "stage-up",
                    stage: result.legacy.stage,
                    stageName: STAGE_NAMES[result.legacy.stage] ?? "Advanced",
                    legacyName: def.name,
                    rarity: def.rarity,
                    badge: def.badge,
                    grantedTitle: result.title ?? null,
                    text: result.completion ?? "Your legacy deepens.",
                });
                onLegacyChanged?.(result.legacy as Character["legacy"], result.title ?? null);
            } else if (result?.reason === "incomplete") {
                setTrialNote("The trial is not finished yet — the objectives below still wait.");
                setTimeout(() => setTrialNote(null), 5000);
            }
        }
        setBusy(false);
        reload();
    }

    return (
        <div style={{ display: "grid", gap: 12 }}>
            {/* ── Nameplate (handoff badge row) ───────────────────────── */}
            <PlayerNameplate
                name={character.name}
                level={character.level}
                customTitle={character.customTitle}
                customTitleStyle={character.customTitleStyle}
                customTitleIcon={character.customTitleIcon}
                legacyTitle={status.legacy?.titles?.[status.legacy.titles.length - 1] ?? null}
                legacyRarity={def?.rarity ?? null}
                village={character.village}
            />

            {/* ── Accepted legacy ─────────────────────────────────────── */}
            {status.legacy && !def ? (
                // Sealed player whose definitions fetch is slow or failed: never
                // show the pre-acceptance "Path Is Unwritten" card to someone
                // with a sealed path (final-gate finding) — render the essentials
                // from status alone until the codex loads.
                <div className="card" style={{ padding: 14, border: "1px solid rgba(192,132,252,.35)" }}>
                    <h3 style={{ margin: 0, color: "#c084fc", textTransform: "capitalize" }}>
                        {status.legacy.legacyId.replace(/-/g, " ")}
                    </h3>
                    <p style={{ margin: "6px 0 0", fontSize: ".78rem", color: "#9aa3b2" }}>
                        Stage {STAGE_ROMAN[status.legacy.stage] ?? status.legacy.stage} — <b style={{ color: "#e2e8f0" }}>{STAGE_NAMES[status.legacy.stage]}</b>
                        {status.legacy.titles.length > 0 && <> · Titles: <b style={{ color: "#e2e8f0" }}>{status.legacy.titles.join(", ")}</b></>}
                    </p>
                    <p style={{ margin: "6px 0 0", fontSize: ".72rem", color: "#9aa3b2" }}>
                        …the full codex entry is still loading.
                    </p>
                </div>
            ) : status.legacy && def ? (
                <div className="card" style={{ padding: 0, border: `1px solid ${LEGACY_ACCENT}55`, overflow: "hidden" }}>
                    {/* Hero band — the standing home for the player's permanent identity. */}
                    <div style={{ padding: 14, background: `linear-gradient(135deg, ${LEGACY_ACCENT}1f, transparent 72%)`, borderBottom: `1px solid ${LEGACY_ACCENT}2b` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            {def.badge && (
                                // Aura class lives on a wrapper span, not the <img>:
                                // browsers don't render ::before/::after on replaced elements.
                                <span
                                    className={`legacy-aura-s${Math.max(2, status.legacy.stage)}`}
                                    style={{ width: 62, height: 62, borderRadius: 12, display: "inline-block", flexShrink: 0 }}
                                >
                                    <img
                                        src={`/badges/legacy-${def.badge}.png`} alt=""
                                        style={{ width: "100%", height: "100%", borderRadius: 12, display: "block" }}
                                        onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                                    />
                                </span>
                            )}
                            <div style={{ minWidth: 0 }}>
                                <h3 style={{ margin: 0, color: LEGACY_ACCENT, fontSize: "1.18rem", lineHeight: 1.12 }}>{def.name}</h3>
                                <p style={{ margin: "3px 0 0", fontSize: ".74rem", color: "#cbd5e1" }}>
                                    Stage {STAGE_ROMAN[status.legacy.stage] ?? status.legacy.stage} — <b style={{ color: "#e2e8f0" }}>{STAGE_NAMES[status.legacy.stage]}</b>
                                </p>
                            </div>
                        </div>
                        {/* Stage track I–V — current lit, future dimmed. */}
                        <div style={{ display: "flex", gap: 5, marginTop: 12 }}>
                            {[1, 2, 3, 4, 5].map((s) => {
                                const reached = s <= (status.legacy?.stage ?? 0);
                                return (
                                    <div key={s} style={{ flex: 1, textAlign: "center" }}>
                                        <div style={{ height: 4, borderRadius: 2, background: reached ? LEGACY_ACCENT : "rgba(148,163,184,.18)", boxShadow: reached ? `0 0 6px -1px ${LEGACY_ACCENT}` : "none" }} />
                                        <span style={{ fontSize: ".58rem", letterSpacing: ".08em", color: reached ? "#c4b5fd" : "#5b6472" }}>{STAGE_ROMAN[s]}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div style={{ padding: 14 }}>
                    <p style={{ margin: "0 0 6px", fontStyle: "italic", fontSize: ".8rem", color: "#cbd5e1" }}>{def.flavor}</p>
                    {status.legacy.titles.length > 0 && (
                        // Titles as an EARNED ladder (base → Proven → Eternal), the
                        // most recent one filled. Order is grant order (server-appended,
                        // dedup-preserving); we never render un-earned titles, which
                        // would leak the stage ceiling.
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "0 0 8px" }}>
                            <span style={{ fontSize: ".64rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: ".07em" }}>Titles earned</span>
                            {status.legacy.titles.map((t, i) => {
                                const current = i === status.legacy!.titles.length - 1;
                                return (
                                    <span key={t} style={current
                                        ? { padding: "2px 10px", borderRadius: 999, fontSize: ".72rem", fontWeight: 700, color: "#0b1020", background: LEGACY_ACCENT }
                                        : { padding: "2px 10px", borderRadius: 999, fontSize: ".72rem", color: "#c4b5fd", border: `1px solid ${LEGACY_ACCENT}55` }}>
                                        «{t}»
                                    </span>
                                );
                            })}
                        </div>
                    )}
                    <p style={{ margin: "6px 0 0", fontSize: ".72rem", color: "#9aa3b2" }}>
                        Your path is sealed forever. Trials may be retried, but a legacy is never exchanged.
                    </p>
                    {eraAgeName(status.legacy.eraBorn) && (
                        // The world era this legacy was taken up in — pins the
                        // accomplishment to the timeline (server-stamped at accept).
                        <p style={{ margin: "6px 0 0", fontSize: ".72rem", color: "#c4b5fd" }}>
                            📜 Taken up in <b style={{ color: "#e2e8f0" }}>{eraAgeName(status.legacy.eraBorn)}</b>.
                        </p>
                    )}
                    {(() => {
                        // The player's own dated saga — every stage they have actually
                        // reached, when it happened. Pure display of server-stamped
                        // timestamps (no new mechanic); older saves with only
                        // acceptedAt render a single row, a fully-missing one nothing.
                        const saga = stageSaga(status.legacy);
                        if (saga.length === 0) return null;
                        return (
                            <div style={{ marginTop: 10, borderTop: `1px solid ${LEGACY_ACCENT}22`, paddingTop: 8 }}>
                                <div style={{ fontSize: ".64rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 4 }}>Your saga</div>
                                <div style={{ display: "grid", gap: 3 }}>
                                    {saga.map((m) => (
                                        <div key={m.stage} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: ".72rem" }}>
                                            <span style={{ width: 22, color: "#c4b5fd", fontWeight: 700 }}>{STAGE_ROMAN[m.stage]}</span>
                                            <span style={{ flex: 1, color: "#cbd5e1" }}>{STAGE_NAMES[m.stage]}</span>
                                            <span style={{ color: "#6b7280", whiteSpace: "nowrap" }} title={new Date(m.ts).toLocaleString()}>
                                                {new Date(m.ts).toLocaleDateString()} · {agoLabel(m.ts, nowTs)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                    {(() => {
                        // The Legacy signature (dedicated jutsu slot): revealed from
                        // Stage 3 (Bound); before that, shown as the road ahead.
                        const sigId = LEGACY_JUTSU_ID_BY_LEGACY.get(status.legacy.legacyId);
                        const sig = sigId ? LEGACY_JUTSU_BY_ID.get(sigId) : undefined;
                        if (!sig) return null;
                        const shape = sig.method === "AOE_BURST" ? "Area nova" : sig.method === "AOE_CIRCLE" ? "Dashing strike" : sig.ap === 40 ? "Self technique" : "Focused strike";
                        // NB: tag NAMES only, never percents/rank — rank is owner-only.
                        const effectTags = sig.tags.filter((t) => t.name !== "Move");
                        const hideImg = (e: React.SyntheticEvent<HTMLImageElement>) => { (e.currentTarget as HTMLImageElement).style.display = "none"; };
                        return status.legacy.stage >= LEGACY_SIGNATURE_MIN_STAGE ? (
                            <div style={{ marginTop: 8, border: `1px solid ${LEGACY_ACCENT}44`, background: `${LEGACY_ACCENT}0f`, borderRadius: 10, padding: 10, display: "flex", gap: 10 }}>
                                {sig.image && <img src={sig.image} alt="" style={{ width: 46, height: 46, borderRadius: 8, flexShrink: 0 }} onError={hideImg} />}
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: ".58rem", letterSpacing: ".1em", textTransform: "uppercase", color: LEGACY_ACCENT }}>◆ Signature Technique · your 16th slot</div>
                                    <b style={{ fontSize: ".86rem", color: "#e2e8f0" }}>{sig.name}</b>
                                    <p style={{ margin: "2px 0 0", fontSize: ".67rem", color: "#94a3b8" }}>
                                        {shape} · {sig.ap} AP · a 16th slot outside your fifteen · mastery {legacySignatureMasteryLevel(status.legacy.stage)}/50 (rises with your stage)
                                    </p>
                                    {effectTags.length > 0 && (
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                                            {effectTags.map((t) => (
                                                <span key={t.name} style={{ fontSize: ".62rem", padding: "1px 6px", borderRadius: 4, border: `1px solid ${LEGACY_ACCENT}44`, color: "#c4b5fd" }}>{t.name}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div style={{ marginTop: 8, border: "1px dashed rgba(148,163,184,.32)", borderRadius: 10, padding: 10, display: "flex", gap: 10, opacity: 0.75 }}>
                                {sig.image && <img src={sig.image} alt="" style={{ width: 46, height: 46, borderRadius: 8, flexShrink: 0, filter: "grayscale(1) brightness(.7)" }} onError={hideImg} />}
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: ".58rem", letterSpacing: ".1em", textTransform: "uppercase", color: "#9aa3b2" }}>🔒 Sealed until the {TRIAL_NAMES.bind}</div>
                                    <b style={{ fontSize: ".86rem", color: "#cbd5e1" }}>{sig.name}</b>
                                    <p style={{ margin: "2px 0 0", fontSize: ".67rem", color: "#94a3b8" }}>{shape} · pass Stage III — Bound and it becomes your 16th slot, a technique only your Legacy can wield.</p>
                                </div>
                            </div>
                        );
                    })()}
                    {(() => {
                        // Where the player's trial-giver emissary roams this 6h
                        // window (same deterministic roll the world map uses).
                        // Hidden when the device opted out of wanderers — the
                        // map wouldn't render the NPC, so the hint would lie.
                        if (!isWanderersEnabled()) return null;
                        const spawn = rollEmissarySpawn(character.name, status.level, status.legacyCategory ?? def.category, wandererDayBucket(new Date()));
                        return spawn ? (
                            <p style={{ margin: "6px 0 0", fontSize: ".72rem", color: "#c4b5fd" }}>
                                🏮 {spawn.def.name}, keeper of your path, was last seen in <b>{sectorRegionName(spawn.sector)}</b> (sector {spawn.sector}).
                            </p>
                        ) : null;
                    })()}
                    {status.legacy.stage < 5 && !status.trial && (() => {
                        // The road ahead — names the NEXT trial + stage (both already
                        // player-visible via the CTA, so no rank leak) and flags the
                        // stage that awakens the signature. Hidden mid-trial.
                        const kind = NEXT_TRIAL_BY_STAGE[status.legacy.stage];
                        const nextStage = status.legacy.stage + 1;
                        const unlocksSig = nextStage === LEGACY_SIGNATURE_MIN_STAGE;
                        return (
                            <p style={{ margin: "10px 0 0", fontSize: ".72rem", color: "#c4b5fd" }}>
                                ↗ Next: the <b>{TRIAL_NAMES[kind]}</b> — passing it carries you to <b>Stage {STAGE_ROMAN[nextStage]} · {STAGE_NAMES[nextStage]}</b>{unlocksSig ? ", where your signature technique awakens" : ""}.
                            </p>
                        );
                    })()}
                    {status.legacy.stage === 5 && (
                        <p style={{ margin: "10px 0 0", fontSize: ".72rem", color: LEGACY_ACCENT, fontStyle: "italic" }}>
                            ✦ The path is complete. Nothing more will ever be asked of it — only remembered.
                        </p>
                    )}
                    </div>
                </div>
            ) : (
                <div className="card" style={{ padding: 14 }}>
                    <h3 style={{ margin: "0 0 6px" }}>Your Path Is Unwritten</h3>
                    {status.minLevelReached ? (
                        <p style={{ margin: 0, fontSize: ".8rem", color: "#cbd5e1" }}>
                            You have come far enough for a Legacy. A <b style={{ color: "#c084fc" }}>Wandering Sage</b> watches
                            shinobi like you — keep playing, and he will find you on the world map.
                            {status.offer && (() => {
                                const msLeft = (status.offer.expiresAt ?? 0) - nowTs;
                                const hours = Math.max(0, Math.floor(msLeft / 3_600_000));
                                const left = hours >= 48 ? `${Math.floor(hours / 24)} days` : hours >= 1 ? `${hours}h` : "less than an hour";
                                return (
                                    <> He is <b>waiting in sector {status.offer.sector}</b> right now.
                                    {msLeft > 0 && <> He will not wait forever — <b style={{ color: "#fbbf24" }}>about {left}</b> remains.</>}</>
                                );
                            })()}
                        </p>
                    ) : (
                        <p style={{ margin: 0, fontSize: ".8rem", color: "#cbd5e1" }}>
                            Legacies reveal themselves at level 50. Until then, every battle, mission, and
                            discovery is quietly shaping which paths will open to you.
                        </p>
                    )}
                    {(() => {
                        // The rumor arc, accumulated — the whispers heard at level
                        // milestones stay readable instead of evaporating.
                        const log = rumorLog();
                        return log.length > 0 ? (
                            <details style={{ marginTop: 8 }}>
                                <summary style={{ cursor: "pointer", fontSize: ".74rem", color: "#c4b5fd" }}>
                                    Rumors you have heard ({log.length})
                                </summary>
                                {log.map((r) => (
                                    <p key={r.milestone} style={{ margin: "6px 0 0", fontSize: ".73rem", color: "#9aa3b2", fontStyle: "italic" }}>
                                        <b style={{ color: "#6b7280" }}>Lv {r.milestone}:</b> “{r.text}”
                                    </p>
                                ))}
                            </details>
                        ) : null;
                    })()}
                </div>
            )}

            {/* ── Active trial ────────────────────────────────────────── */}
            {status.trial && (() => {
                const kind = status.trial.kind;
                const accent = TRIAL_ACCENTS[kind] ?? "#c084fc";
                const isFinal = kind === "mythic";
                // The emissary serving this legacy's category is the actual
                // trial-giver — attribute the charge to them, not the Sage (the
                // ceremony already does; this closes the one-card-below mismatch).
                const em = emissaryForCategory(status.legacyCategory ?? def?.category);
                return (
                <div className="card" style={{ padding: 14, borderLeft: `3px solid ${accent}`, background: isFinal ? `linear-gradient(135deg, ${LEGACY_ACCENT}14, transparent 70%)` : undefined }}>
                    {isFinal && (
                        <div style={{ fontSize: ".6rem", letterSpacing: ".12em", textTransform: "uppercase", color: LEGACY_ACCENT, marginBottom: 2 }}>◆ The last trial the path will ever ask</div>
                    )}
                    <h4 style={{ margin: "0 0 4px", color: accent }}>
                        {TRIAL_NAMES[kind] ?? "Legacy Trial"}
                        <span style={{ fontSize: ".7rem", color: "#9aa3b2", marginLeft: 8 }}>attempt {status.trial.attempt}</span>
                    </h4>
                    {em && (
                        // The overseer's face + their read of WHICH climb this is
                        // (STAGE_WITNESS keyed on the trial kind, never on rank).
                        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 8px" }}>
                            <img src={`/portraits/${em.slug}.webp`} alt="" style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, objectFit: "cover", border: `1px solid ${accent}66` }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            <p style={{ margin: 0, fontSize: ".72rem", color: "#cbd5e1", fontStyle: "italic", lineHeight: 1.4 }}>
                                “{STAGE_WITNESS[kind] ?? "Walk it where the world can see."}” <span style={{ color: "#6b7280", fontStyle: "normal" }}>— {em.name}</span>
                            </p>
                        </div>
                    )}
                    {status.trialIntro && (
                        <p style={{ margin: "0 0 10px", fontSize: ".74rem", fontStyle: "italic", color: "#cbd5e1", lineHeight: 1.45 }}>
                            “{status.trialIntro}” <span style={{ color: "#6b7280" }}>— {em?.name ?? "the Sage"}</span>
                        </p>
                    )}
                    {status.trial.objectives.map((o) => (
                        <div key={o.stat} style={{ marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".75rem", color: o.done ? "#86efac" : "#cbd5e1" }}>
                                <span>{o.done ? "✓ " : ""}{TRIAL_STAT_LABELS[o.stat] ?? o.stat}</span>
                                <span>{o.progress.toLocaleString()} / {o.delta.toLocaleString()}</span>
                            </div>
                            <div style={{ height: 6, borderRadius: 3, background: "rgba(148,163,184,.15)", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${Math.min(100, (o.progress / Math.max(1, o.delta)) * 100)}%`, background: o.done ? "#4ade80" : accent }} />
                            </div>
                        </div>
                    ))}
                    {trialNote && <p style={{ fontSize: ".74rem", color: "#fbbf24", margin: "0 0 6px" }}>{trialNote}</p>}
                    <button disabled={busy} onClick={() => void handleTrial("complete")} style={{ width: "100%", marginTop: 4 }}>
                        {status.trial.objectives.every((o) => o.done) ? "Complete the Trial" : "Check Progress"}
                    </button>
                    {!status.trial.objectives.every((o) => o.done) && (
                        <button
                            disabled={busy}
                            onClick={() => void handleTrial("reroll")}
                            title={`${em?.name ?? "The Sage"} will pose the same trial a different way. Progress resets — the ask changes, the height doesn't.`}
                            style={{ width: "100%", marginTop: 6, background: "transparent", borderColor: "#6b7280", color: "#9aa3b2", fontSize: ".78rem" }}
                        >
                            Ask for a different proof (progress resets)
                        </button>
                    )}
                </div>
                );
            })()}
            {!status.trial && status.legacy && status.legacy.stage < 5 && (
                <button disabled={busy} onClick={() => void handleTrial("start")} style={{ width: "100%" }}>
                    {(() => {
                        // "Trial of Awakening" → "Begin the Trial of Awakening",
                        // but "The Mythic Trial" → "Begin the Mythic Trial" (no
                        // doubled article).
                        const name = TRIAL_NAMES[["", "awaken", "bind", "prove", "mythic"][status.legacy.stage] ?? "awaken"] ?? "Trial";
                        return name.startsWith("The ") ? `Begin ${name.replace(/^The /, "the ")}` : `Begin the ${name}`;
                    })()}
                </button>
            )}
            {status.legacy && status.legacy.stage === 5 && (
                <p style={{ margin: 0, fontSize: ".78rem", color: "#c084fc", textAlign: "center", fontStyle: "italic" }}>
                    Stage V — Mythic. Your legacy stands complete in the Hall of Legends.
                </p>
            )}

            {/* ── Strongest paths (vague, rumor-tier) ─────────────────── */}
            {status.strongest.length > 0 && !status.legacy && (
                <div className="card" style={{ padding: 14 }}>
                    <h4 style={{ margin: "0 0 6px" }}>Whispers About Your Path</h4>
                    {status.strongest.map((s) => (
                        <p key={s.category} style={{ margin: "2px 0", fontSize: ".78rem", color: "#cbd5e1", fontStyle: "italic" }}>
                            Your <button
                                type="button"
                                onClick={() => { setCodexCategory(s.category); document.getElementById("legacy-codex")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                                style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "#c084fc", cursor: "pointer", textTransform: "capitalize", textDecoration: "underline dotted" }}
                                title="See these legacies in the Codex"
                            >{s.category}</button> path is <b style={{ color: "#c084fc" }}>{s.tier}</b>.
                        </p>
                    ))}
                    {status.minLevelReached && (() => {
                        const n = Object.values(status.eligibleCounts).reduce((a, b) => a + b, 0);
                        return (
                            <p style={{ margin: "6px 0 0", fontSize: ".72rem", color: "#9aa3b2" }}>
                                {n === 1 ? "One legacy would answer you today." : `${n} legacies would answer you today.`}
                            </p>
                        );
                    })()}
                </div>
            )}

            {/* ── The Legacy Codex — all 100 paths, browsable ─────────── */}
            {defs && defs.size > 0 && (
                <div id="legacy-codex" className="card" style={{ padding: 14 }}>
                    <h4 style={{ margin: "0 0 4px" }}>The Legacy Codex</h4>
                    <p style={{ margin: "0 0 8px", fontSize: ".72rem", color: "#6b7280" }}>
                        Every path the world remembers, as equals — no path is ranked above another
                        here. What opens them stays a mystery; the life you live is the key. {defs.size} recorded.
                    </p>
                    <input
                        type="search"
                        value={codexQuery}
                        onChange={(e) => setCodexQuery(e.target.value)}
                        placeholder="Search legacies…"
                        aria-label="Search the Legacy Codex"
                        style={{ width: "100%", marginBottom: 10, padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(148,163,184,.28)", background: "rgba(15,23,42,.6)", color: "#e2e8f0", fontSize: ".8rem" }}
                    />
                    {(() => {
                        // Category facets — a browse convenience along the gameplay
                        // identity axis; legacies are NEVER faceted or coloured by
                        // rarity for players (rank is owner-only).
                        const cats = [...new Set([...defs.values()].map((d) => d.category))].sort();
                        return (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                                <button type="button" onClick={() => setCodexCategory(null)} style={codexChipStyle(codexCategory === null)}>All</button>
                                {cats.map((c) => (
                                    <button key={c} type="button" onClick={() => setCodexCategory(codexCategory === c ? null : c)} style={{ ...codexChipStyle(codexCategory === c), textTransform: "capitalize" }}>{c}</button>
                                ))}
                            </div>
                        );
                    })()}
                    {(() => {
                        // Sorted by name, filtered by the optional category facet and
                        // the search box across name / category / village / flavor.
                        const q = codexQuery.trim().toLowerCase();
                        const all = [...defs.values()]
                            .filter((d) => !codexCategory || d.category === codexCategory)
                            .filter((d) => !q || `${d.name} ${d.category} ${d.villageAffinity ?? ""} ${d.flavor}`.toLowerCase().includes(q))
                            .sort((a, b) => a.name.localeCompare(b.name));
                        if (all.length === 0) return <p style={{ fontSize: ".76rem", color: "#6b7280" }}>No legacies match{codexQuery ? ` "${codexQuery}"` : ""}{codexCategory ? ` in ${codexCategory}` : ""}.</p>;
                        return (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                                {all.map((d) => {
                                    const mine = status.legacy?.legacyId === d.id;
                                    return (
                                        // Display-only: a codex entry names the path and its flavor, and
                                        // never opens to reveal the technique it grants (the mystery rule).
                                        <div key={d.id} style={{ textAlign: "left", width: "100%", border: `1px solid ${mine ? `${LEGACY_ACCENT}66` : "rgba(148,163,184,.18)"}`, background: mine ? `${LEGACY_ACCENT}12` : "rgba(15,23,42,.4)", borderRadius: 10, padding: "9px 10px" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                                {d.badge && (
                                                    <img
                                                        src={`/badges/legacy-${d.badge}.png`} alt=""
                                                        style={{ width: 30, height: 30, borderRadius: 6, flexShrink: 0 }}
                                                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                                    />
                                                )}
                                                <b style={{ fontSize: ".8rem", color: mine ? LEGACY_ACCENT : "#e2e8f0", lineHeight: 1.15 }}>{mine ? "★ " : ""}{d.name}</b>
                                            </div>
                                            <p style={{ margin: "5px 0 0", fontSize: ".7rem", color: "#94a3b8", textTransform: "capitalize" }}>
                                                {d.category}{d.villageAffinity ? ` · ${d.villageAffinity}` : ""}
                                            </p>
                                            <p style={{ margin: "3px 0 0", fontSize: ".72rem", color: "#8b93a1", fontStyle: "italic", lineHeight: 1.3 }}>{d.flavor}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* Ceremonial trial-start / stage-up moment (replaces alert()s). */}
            {moment && <LegacyMoment moment={moment} onClose={() => setMoment(null)} />}
        </div>
    );
}
