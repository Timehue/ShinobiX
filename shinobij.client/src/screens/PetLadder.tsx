import { useCallback, useEffect, useMemo, useState } from "react";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen } from "../types/core";
import { isPetOnExpedition, petDisplayName } from "../lib/pet";
import { derivePetRole, ROLE_META } from "../lib/pet-roles";
import { petPvpGearById, petConsumableById } from "../data/pet-config";
import { PetColiseumDuel, PetArenaMatch } from "../components/PetColiseum";
import { runPetDuel } from "../lib/pet-duel-sim";
import type { ArenaSlot } from "../lib/pet-arena-sim";
import {
    type Mode, type LadderView, type OfferOpponent, type ChallengeResult, type PetLite,
    fetchLadder, setLadderDefense, getLadderOffer, challengeLadder, clearLadderNotify, toClientPet,
} from "../lib/pet-ladder-client";
import coliseumHero from "../assets/coliseum/coliseum-bg.webp";   // the real in-battle coliseum (matches the Coliseum duel backdrop)
import tacticalHero from "../assets/ladder/tactical-hero.webp";

/*
 * Pet Ladder — global positional ranking (Sword-x-Staff style) for Pet Coliseum
 * (1v1) and Pet Tactical (4v4). Set a sealed defense, challenge close-above rivals
 * (offline), climb. Resolution is server-authoritative; this screen replays the
 * sealed result in the 2.5D/3D cinematic with PvP items applied.
 */

const MODE_LABEL: Record<Mode, string> = { coliseum: "Pet Coliseum", tactical: "Pet Tactical" };
const MODE_SUB: Record<Mode, string> = { coliseum: "1v1 duel · defend with one pet", tactical: "4v4 tactical · defend with a team of four" };
const HERO: Record<Mode, string> = { coliseum: coliseumHero, tactical: tacticalHero };

function gearLabel(pet: Pet): string | null {
    const g = petPvpGearById(pet.loadout?.pvp);
    const c = petConsumableById(pet.loadout?.consumable);
    const parts: string[] = [];
    if (g) parts.push(g.name);
    if (c) parts.push(c.name);
    return parts.length ? parts.join(" · ") : null;
}

const MEDAL: Record<number, { bg: string; ring: string }> = {
    1: { bg: "radial-gradient(circle at 35% 28%, #fff0b8, #e0a106 72%)", ring: "#fff3c4" },
    2: { bg: "radial-gradient(circle at 35% 28%, #f6f9fc, #97a4b5 72%)", ring: "#e8eef6" },
    3: { bg: "radial-gradient(circle at 35% 28%, #f4c794, #a35a22 72%)", ring: "#ffd9a8" },
};
function RankBadge({ rank }: { rank: number }) {
    const m = MEDAL[rank];
    if (!m) return <div style={{ width: 38, textAlign: "center", fontWeight: 800, fontSize: 18, opacity: 0.85 }}>{rank}</div>;
    return <div title={`Rank ${rank}`} style={{ width: 38, height: 38, borderRadius: "50%", display: "grid", placeItems: "center", background: m.bg, boxShadow: `0 0 0 2px ${m.ring}, 0 2px 7px rgba(0,0,0,.55)`, fontWeight: 900, color: "#3a2600", fontSize: 16 }}>{rank}</div>;
}

const summaryChips = (pets: PetLite[]) => (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
        {pets.map((p, i) => (
            <span key={i} style={{ fontSize: 12, opacity: 0.9 }}>
                {ROLE_META[p.role ?? "tracker"]?.label ? <b style={{ color: ROLE_META[p.role ?? "tracker"].color }}>{p.name}</b> : p.name}
                <span style={{ opacity: 0.6 }}> L{p.level} {p.element}</span>
            </span>
        ))}
    </span>
);

export function PetLadder({ character, setScreen, sharedImages }: { character: Character; setScreen: (s: Screen) => void; sharedImages: Record<string, string> }) {
    const [mode, setMode] = useState<Mode>(() => (sessionStorage.getItem("petLadder.mode") === "tactical" ? "tactical" : "coliseum"));
    const [view, setView] = useState<LadderView | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [picks, setPicks] = useState<string[]>([]);
    const [offer, setOffer] = useState<OfferOpponent[] | null>(null);
    const [replay, setReplay] = useState<ChallengeResult | null>(null);
    const [outcome, setOutcome] = useState<{ won: boolean; rank: number | null } | null>(null);

    const name = character.name;
    const teamSize = mode === "tactical" ? 4 : 1;
    const available = useMemo(() => character.pets.filter((p) => !isPetOnExpedition(p)), [character.pets]);
    const petById = useMemo(() => new Map(available.map((p) => [p.id, p])), [available]);

    const refresh = useCallback(async () => {
        try { setErr(null); setView(await fetchLadder(name, mode)); } catch (e) { setErr((e as Error).message); }
    }, [name, mode]);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => { setPicks(available.slice(0, teamSize).map((p) => p.id)); setOffer(null); setOutcome(null); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

    const togglePick = (id: string) => {
        if (teamSize === 1) { setPicks([id]); return; }
        setPicks((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= teamSize ? cur : [...cur, id]);
    };

    const saveDefense = async () => {
        if (picks.length !== teamSize) return;
        setBusy(true);
        try { await setLadderDefense(name, mode, picks); await refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
    };
    const openOffer = async () => {
        setBusy(true);
        try { setOffer((await getLadderOffer(name, mode)).offer); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
    };
    const doChallenge = async (targetId: string) => {
        setBusy(true);
        try { const r = await challengeLadder(name, mode, targetId); setOffer(null); setReplay(r); setOutcome({ won: r.won, rank: r.rank }); }
        catch (e) { setErr((e as Error).message); setOffer(null); }
        finally { setBusy(false); }
    };
    const exitCinematic = () => { setReplay(null); void refresh(); };

    // ── Cinematic replay of the sealed challenge (items applied) ───────────────
    if (replay) {
        const r = replay.replay;
        if (r.kind === "coliseum") {
            const player = toClientPet(r.player), enemy = toClientPet(r.enemy);
            const result = runPetDuel(player, enemy, r.seed, 1, 1, false, true);
            return <PetColiseumDuel playerPet={player} enemyPet={enemy} seed={r.seed} result={result} sharedImages={sharedImages} onFightAgain={exitCinematic} onExit={exitCinematic} />;
        }
        const blue: ArenaSlot[] = r.blue.map((s) => ({ pet: toClientPet(s.pet), role: s.role }));
        const red: ArenaSlot[] = r.red.map((s) => ({ pet: toClientPet(s.pet), role: s.role }));
        return <PetArenaMatch blue={blue} red={red} seed={r.seed} applyItems sharedImages={sharedImages} onExit={exitCinematic} />;
    }

    const you = view?.you;
    const canChallenge = !!you?.hasDefense && (you?.challengesLeft ?? 0) > 0;

    return (
        <div className="screen" style={{ maxWidth: 920, margin: "0 auto", padding: "0 12px 40px" }}>
            <button className="back-button" onClick={() => setScreen("petArena")} style={{ margin: "8px 0" }}>← Arena District</button>

            {/* Mode banner + tabs */}
            <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", marginBottom: 12, boxShadow: "0 6px 24px rgba(0,0,0,.4)" }}>
                <img src={HERO[mode]} alt="" style={{ width: "100%", height: 150, objectFit: "cover", display: "block", filter: "saturate(1.1)" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,.1), rgba(0,0,0,.75))" }} />
                <div style={{ position: "absolute", left: 16, bottom: 12, right: 16 }}>
                    <h2 style={{ margin: 0, fontSize: 26, textShadow: "0 2px 8px #000" }}>🏆 {MODE_LABEL[mode]} Ladder</h2>
                    <div style={{ opacity: 0.9, fontSize: 13 }}>{MODE_SUB[mode]}</div>
                </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {(["coliseum", "tactical"] as Mode[]).map((m) => (
                    <button key={m} onClick={() => { setMode(m); sessionStorage.setItem("petLadder.mode", m); }}
                        className={mode === m ? "active" : ""}
                        style={{ flex: 1, padding: "10px", fontWeight: 700, opacity: mode === m ? 1 : 0.6, borderBottom: mode === m ? "3px solid var(--accent, #f0a)" : "3px solid transparent" }}>
                        {MODE_LABEL[m]}
                    </button>
                ))}
            </div>

            {err && <div style={{ color: "#f66", marginBottom: 10 }}>⚠ {err}</div>}

            {/* Your standing */}
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", background: "rgba(255,255,255,.05)", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{you?.rank ? `#${you.rank}` : "Unranked"}</div>
                <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 13, opacity: 0.8 }}>{view ? `${view.total} ranked ${view.total === 1 ? "player" : "players"}` : "Loading…"}</div>
                    {you && <div style={{ fontSize: 12, opacity: 0.7 }}>W {recordOf(view, "wins")} · L {recordOf(view, "losses")} · Held {recordOf(view, "defended")} · Lost {recordOf(view, "defeated")}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13 }}>Challenges left today</div>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{you?.challengesLeft ?? "—"}<span style={{ fontSize: 12, opacity: 0.6 }}>/10</span></div>
                </div>
            </div>

            {/* Notifications */}
            {!!view?.notifications.length && (
                <div style={{ background: "rgba(240,160,0,.12)", border: "1px solid rgba(240,160,0,.3)", borderRadius: 10, padding: "8px 12px", marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <b>📨 While you were away</b>
                        <button onClick={async () => { try { await clearLadderNotify(name); await refresh(); } catch { /* ignore */ } }} style={{ fontSize: 12 }}>Clear</button>
                    </div>
                    {view.notifications.slice().reverse().map((n, i) => (
                        <div key={i} style={{ fontSize: 13, opacity: 0.9 }}>{n.won ? "❌" : "🛡"} <b>{n.from}</b> {n.won ? "took your rank" : "failed to take your rank"} in {MODE_LABEL[n.mode]}.</div>
                    ))}
                </div>
            )}

            {outcome && (
                <div style={{ background: outcome.won ? "rgba(60,200,120,.15)" : "rgba(200,60,60,.15)", borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontWeight: 700 }}>
                    {outcome.won ? "🎉 Victory!" : "💢 Defeated."} {outcome.rank ? `You are now rank #${outcome.rank}.` : "Keep climbing."}
                </div>
            )}

            {/* Set defense */}
            <section style={{ marginBottom: 16 }}>
                <h3 style={{ marginBottom: 4 }}>🛡 Your defense{mode === "tactical" ? " team" : ""}</h3>
                <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>
                    {mode === "tactical" ? "Pick 4 pets to defend your rank — they fight for you even while you're offline." : "Pick the pet that defends your rank while you're away."} Stats & PvP items count.
                </p>
                {available.length < teamSize
                    ? <div style={{ opacity: 0.7 }}>You need {teamSize} available pet{teamSize > 1 ? "s" : ""} (none on expeditions) to set a defense.</div>
                    : <>
                        <div className="pet-pick-grid">
                            {available.map((pet) => {
                                const sel = picks.includes(pet.id);
                                const order = picks.indexOf(pet.id);
                                const { role } = pet.role ? { role: pet.role } : derivePetRole(pet);
                                const rm = ROLE_META[role];
                                const img = pet.image || sharedImages[`pet:${pet.id}`] || "";
                                const gear = gearLabel(pet);
                                return (
                                    <button key={pet.id} type="button" className={`pet-pick${sel ? " selected" : ""}`} onClick={() => togglePick(pet.id)} title={gear ?? petDisplayName(pet)}>
                                        {sel && teamSize > 1 && <span className="pet-pick-order">{order + 1}</span>}
                                        {img ? <img className="pet-pick-img" src={img} alt="" /> : <div className="pet-pick-img placeholder" />}
                                        <span className="pet-pick-name">{petDisplayName(pet)}</span>
                                        {rm && <span className="pet-pick-role" style={{ color: rm.color }}>{rm.label}</span>}
                                        <span className="pet-pick-meta">Lv {pet.level} · {pet.hp}hp {pet.attack}atk{pet.element && pet.element !== "None" ? ` · ${pet.element}` : ""}</span>
                                        {gear && <span style={{ fontSize: 10, color: "#ffd86b", display: "block", marginTop: 2 }}>⚙ {gear}</span>}
                                    </button>
                                );
                            })}
                        </div>
                        <button onClick={saveDefense} disabled={busy || picks.length !== teamSize} style={{ marginTop: 8, padding: "8px 18px", fontWeight: 700 }}>
                            {you?.hasDefense ? "Update defense" : "Set defense"} ({picks.length}/{teamSize})
                        </button>
                    </>}
            </section>

            {/* Challenge */}
            <section style={{ marginBottom: 16 }}>
                <button onClick={openOffer} disabled={busy || !canChallenge} style={{ padding: "10px 22px", fontWeight: 800, fontSize: 15 }}>
                    ⚔ Challenge for rank
                </button>
                {!you?.hasDefense && <span style={{ marginLeft: 10, fontSize: 12, opacity: 0.7 }}>Set a defense first.</span>}
                {you?.hasDefense && (you?.challengesLeft ?? 0) <= 0 && <span style={{ marginLeft: 10, fontSize: 12, opacity: 0.7 }}>Out of challenges today.</span>}

                {offer && (
                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={() => setOffer(null)}>
                        <div style={{ background: "var(--panel, #1b1b22)", borderRadius: 14, padding: 18, maxWidth: 720, width: "100%" }} onClick={(e) => e.stopPropagation()}>
                            <h3 style={{ marginTop: 0 }}>Choose your opponent</h3>
                            <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>Rivals just above your rank. Beat one to take their spot. (Uses 1 of your daily challenges.)</p>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                                {offer.map((o) => (
                                    <button key={o.id} onClick={() => doChallenge(o.id)} disabled={busy} style={{ textAlign: "left", padding: 12, borderRadius: 10, background: "rgba(255,255,255,.06)" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                            <b>{o.name}</b>
                                            <span style={{ opacity: 0.7, fontSize: 12 }}>{o.kind === "ai" ? "AI" : o.rank ? `#${o.rank}` : ""}</span>
                                        </div>
                                        {o.village && <div style={{ fontSize: 11, opacity: 0.6 }}>{o.village}</div>}
                                        <div style={{ marginTop: 6 }}>{summaryChips(o.summary)}</div>
                                    </button>
                                ))}
                            </div>
                            <button onClick={() => setOffer(null)} style={{ marginTop: 12 }}>Cancel</button>
                        </div>
                    </div>
                )}
            </section>

            {/* Ladder list */}
            <section>
                <h3>🪜 The ladder</h3>
                {!view ? <div style={{ opacity: 0.6 }}>Loading…</div>
                    : view.ladder.length === 0 ? <div style={{ opacity: 0.7 }}>No one is ranked yet — set a defense and beat the AI to claim the first rung!</div>
                        : <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {view.ladder.map((e) => (
                                <div key={e.slug} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 12px", borderRadius: 8, background: e.slug === character.name ? "rgba(240,160,0,.14)" : "rgba(255,255,255,.04)" }}>
                                    <RankBadge rank={e.rank} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div><b>{e.name}</b>{e.village ? <span style={{ opacity: 0.55, fontSize: 12 }}> · {e.village}</span> : null}</div>
                                        <div>{summaryChips(e.summary)}</div>
                                    </div>
                                    <div style={{ fontSize: 11, opacity: 0.6, textAlign: "right", whiteSpace: "nowrap" }}>{e.record.wins}W {e.record.losses}L<br />🛡{e.record.defended}</div>
                                </div>
                            ))}
                        </div>}
            </section>
        </div>
    );
}

function recordOf(view: LadderView | null, key: "wins" | "losses" | "defended" | "defeated"): number {
    if (!view || view.you.rank == null) return 0;
    const me = view.ladder[view.you.rank - 1];
    return me ? me.record[key] : 0;
}
