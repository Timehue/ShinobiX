/*
 * Co-op Tactical Pet Arena lobby (client). Friends team up for the 4v4 capture
 * match: one player hosts (gets a 4-char code), up to three more join by code,
 * each locks in two pets, the host starts. The server (api/arena/lobby.ts) is
 * authoritative — it validates pet ownership, mints the seed, and seals the
 * rosters; this UI just drives the handshake and, once the match is sealed,
 * hands the identical {blue, red, seed} to PetArenaMatch so every client runs
 * the SAME deterministic replay. Preview only — no rewards.
 */
import { useState, useEffect, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../types/character";
import type { ArenaSlot } from "../lib/pet-arena-sim";
import { isPetOnExpedition, petDisplayName } from "../lib/pet";
import { petCardImage } from "../lib/pet-battle-anim";
import { petVisualVariantClass } from "../lib/pet-visual-variant";
import coopHero from "../assets/coliseum/coop-hero.webp";
import { activeCarriedPets } from "../lib/entitlements";

// The sealed co-op match now plays as the Hollow Warfront (the lane-war mode
// that replaced the capture-scroll arena). Both clients lock the same auto-buy
// policy, so the match stays a pure function of {blue, red, seed} — the same
// shared-determinism contract the old renderer had.
const PetWarfrontMatch = lazy(() => import("./PetWarfrontMatch").then((m) => ({ default: m.PetWarfrontMatch })));

type Team = "blue" | "red";
type Seat = { team: Team; slot: 0 | 1; name: string | null; ready: boolean; petCount: number; isYou: boolean };
type MatchPayload = { seed: number; blue: ArenaSlot[]; red: ArenaSlot[] };
type PublicLobby = {
    code: string; host: string; state: "lobby" | "running";
    you: { team: Team; slot: 0 | 1 } | null; seats: Seat[]; match: MatchPayload | null; createdAt: number;
};

async function lobbyApi(name: string, action: string, extra: Record<string, unknown> = {}): Promise<{ lobby?: PublicLobby; ok?: boolean }> {
    // Hard 12s deadline (same as the PvP move submit): this component is a
    // full-screen portal, so a hung request must resolve into the error line
    // rather than hold `busy` forever. The throw is the flow's normal error path.
    let res: Response;
    try {
        res = await fetch("/api/arena/lobby", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, action, ...extra }),
            signal: AbortSignal.timeout(12_000),
        });
    } catch (cause) {
        if (cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
            throw new Error("The lobby server did not respond in time. Try again.", { cause });
        }
        throw cause;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Request failed.");
    return data;
}

const PANEL: React.CSSProperties = { background: "var(--slate-900)", border: "1px solid var(--slate-800)", borderRadius: 10, padding: "0.7rem 0.85rem" };
const TEAM_COLOR: Record<Team, string> = { blue: "#3b82f6", red: "var(--danger)" };

export function ArenaCoopLobby({ character, sharedImages, onExit }: {
    character: Character; sharedImages: Record<string, string>; onExit: () => void;
}) {
    const myName = character.name;
    const availablePets = activeCarriedPets(character).filter((p) => !isPetOnExpedition(p));
    const [lobby, setLobby] = useState<PublicLobby | null>(null);
    const [joinCode, setJoinCode] = useState("");
    const [picks, setPicks] = useState<string[]>([]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    // Poll the lobby every 2s while waiting (stops once the match seals/running).
    useEffect(() => {
        if (!lobby || lobby.state === "running") return;
        let active = true;
        const poll = async () => {
            try { const d = await lobbyApi(myName, "poll", { code: lobby.code }); if (active && d.lobby) setLobby(d.lobby); }
            catch (e) { if (active) { setError((e as Error).message); setLobby(null); } }
        };
        const iv = setInterval(poll, 2000);
        return () => { active = false; clearInterval(iv); };
        // Re-key the interval only on the lobby identity/phase, not every poll result.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lobby?.code, lobby?.state, myName]);

    const run = (fn: () => Promise<void>) => async () => {
        setBusy(true); setError("");
        try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };
    const create = run(async () => { const d = await lobbyApi(myName, "create"); if (d.lobby) setLobby(d.lobby); });
    const join = run(async () => {
        const code = joinCode.trim().toUpperCase();
        if (code.length !== 4) { setError("Enter the 4-character lobby code."); return; }
        const d = await lobbyApi(myName, "join", { code }); if (d.lobby) setLobby(d.lobby);
    });
    const lockIn = run(async () => {
        if (picks.length !== 2) { setError("Pick exactly 2 pets."); return; }
        const d = await lobbyApi(myName, "pets", { code: lobby!.code, petIds: picks }); if (d.lobby) setLobby(d.lobby);
    });
    const startMatch = run(async () => { const d = await lobbyApi(myName, "start", { code: lobby!.code }); if (d.lobby) setLobby(d.lobby); });
    const leave = run(async () => { try { await lobbyApi(myName, "leave", { code: lobby!.code }); } catch { /* best-effort */ } onExit(); });

    const togglePick = (id: string) =>
        setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? p : [...p, id]));

    // ── Running → run the sealed replay (identical on every client) ────────────
    if (lobby?.state === "running" && lobby.match) {
        return (
            <Suspense fallback={<Overlay><div style={{ color: "var(--text-dim)" }}>Loading the Warfront…</div></Overlay>}>
                {/* Shared replay must be identical on every client — lock the auto-buy
                    policy (no interactive council) so the match is a pure function of
                    {blue, red, seed} on every machine. */}
                <PetWarfrontMatch blue={lobby.match.blue} red={lobby.match.red} seed={lobby.match.seed} autoBuy="balanced" onExit={onExit} />
            </Suspense>
        );
    }

    const mySeat = lobby?.seats.find((s) => s.isYou) ?? null;
    const iAmHost = lobby?.host === myName;

    return (
        <Overlay>
            <div style={{ width: "min(560px, 94vw)", maxHeight: "90vh", overflowY: "auto", ...PANEL, background: "#0b1120" }}>
                <div style={{ position: "relative", height: 108, borderRadius: 10, overflow: "hidden", marginBottom: "0.7rem", border: "1px solid var(--slate-800)", backgroundImage: `url(${coopHero})`, backgroundSize: "cover", backgroundPosition: "center 32%" }}>
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,12,22,0.2) 0%, rgba(8,12,22,0.55) 55%, rgba(8,12,22,0.9) 100%)" }} />
                    {/* Never disabled: Close is the only way out of this full-screen
                        portal, so it must work even while a request is in flight. */}
                    <button onClick={leave} style={{ position: "absolute", top: 8, right: 8, zIndex: 1, background: "rgba(15,23,42,0.85)" }}>✕ Close</button>
                    <strong style={{ position: "absolute", left: 14, bottom: 10, zIndex: 1, fontSize: "1.2rem", letterSpacing: "0.04em", textShadow: "0 2px 6px rgba(0,0,0,0.95)" }}>🤝 Co-op Arena</strong>
                </div>

                {!lobby && (
                    <div style={{ display: "grid", gap: "0.7rem" }}>
                        <p style={{ color: "var(--text-dim)", margin: 0, fontSize: "0.85rem" }}>
                            Team up for a 4v4 capture match. Create a lobby and share the code, or join a friend's.
                            Each player brings 2 pets; empty seats are filled by AI.
                        </p>
                        <div style={PANEL}>
                            <button onClick={create} disabled={busy} style={{ background: "#0e7490", width: "100%" }}>➕ Create a lobby</button>
                        </div>
                        <div style={{ ...PANEL, display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <input
                                value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
                                placeholder="CODE" maxLength={4}
                                style={{ flex: 1, textTransform: "uppercase", letterSpacing: "0.2em", textAlign: "center", fontWeight: 700 }}
                            />
                            <button onClick={join} disabled={busy} style={{ background: "#6d28d9" }}>Join</button>
                        </div>
                    </div>
                )}

                {lobby && (
                    <div style={{ display: "grid", gap: "0.7rem" }}>
                        {/* Shareable code */}
                        <div style={{ ...PANEL, textAlign: "center" }}>
                            <div style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>Lobby code — share with friends</div>
                            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem", marginTop: "0.2rem" }}>
                                <span style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "0.25em" }}>{lobby.code}</span>
                                <button onClick={() => navigator.clipboard?.writeText(lobby.code)} title="Copy code" style={{ background: "var(--slate-700)" }}>📋</button>
                            </div>
                        </div>

                        {/* Seats */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                            {(["blue", "red"] as Team[]).map((team) => (
                                <div key={team} style={{ ...PANEL, borderColor: TEAM_COLOR[team] }}>
                                    <div style={{ color: TEAM_COLOR[team], fontWeight: 700, fontSize: "0.8rem", marginBottom: "0.3rem" }}>
                                        {team === "blue" ? "Blue Team" : "Red Team"}
                                    </div>
                                    {lobby.seats.filter((s) => s.team === team).map((s) => (
                                        <div key={s.slot} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", padding: "0.15rem 0" }}>
                                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.name ? (s.ready ? "var(--success)" : "#eab308") : "var(--slate-600)", flexShrink: 0 }} />
                                            <span style={{ color: s.name ? "var(--slate-200)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {s.name ? `${s.name}${s.isYou ? " (you)" : ""}` : "Open — AI"}
                                            </span>
                                            {s.name && <span style={{ marginLeft: "auto", color: s.ready ? "var(--success)" : "var(--text-dim)", fontSize: "0.75rem" }}>{s.ready ? "ready" : "picking…"}</span>}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>

                        {/* My pet picker */}
                        <div style={PANEL}>
                            <div style={{ display: "flex", alignItems: "center", marginBottom: "0.35rem" }}>
                                <strong style={{ fontSize: "0.85rem" }}>Your pets {mySeat?.ready ? "✓ locked in" : `(${picks.length}/2)`}</strong>
                                <button onClick={lockIn} disabled={busy || picks.length !== 2 || availablePets.length < 2}
                                    style={{ marginLeft: "auto", background: mySeat?.ready ? "var(--slate-700)" : "#16a34a" }}>
                                    {mySeat?.ready ? "Change picks" : "Lock in 2 pets"}
                                </button>
                            </div>
                            {availablePets.length < 2 ? (
                                <p style={{ color: "var(--gold-2)", margin: 0, fontSize: "0.8rem" }}>You need at least 2 pets that aren't on expeditions.</p>
                            ) : (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: "0.35rem" }}>
                                    {availablePets.map((pet) => {
                                        const sel = picks.includes(pet.id);
                                        const img = petCardImage(pet, sharedImages);
                                        return (
                                            <button key={pet.id} className={petVisualVariantClass(pet)} onClick={() => togglePick(pet.id)}
                                                style={{ padding: "0.25rem", background: sel ? "#0e7490" : "var(--slate-800)", border: sel ? "2px solid #22d3ee" : "2px solid transparent", borderRadius: 8, display: "grid", justifyItems: "center", gap: 2 }}>
                                                {img
                                                    ? <img src={img} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
                                                    : <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--slate-700)" }} />}
                                                <span style={{ fontSize: "0.62rem", maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{petDisplayName(pet)}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                            {iAmHost && (
                                <button onClick={startMatch} disabled={busy} style={{ background: "#0e7490", flex: 1 }}>▶ Start match</button>
                            )}
                            <button onClick={leave} style={{ background: "#7f1d1d" }}>Leave lobby</button>
                        </div>
                        {!iAmHost && <p style={{ color: "var(--text-muted)", margin: 0, fontSize: "0.75rem", textAlign: "center" }}>Waiting for the host to start…</p>}
                    </div>
                )}

                {error && <p style={{ color: "var(--red-400)", marginTop: "0.6rem", marginBottom: 0, fontSize: "0.85rem" }}>{error}</p>}
            </div>
        </Overlay>
    );
}

function Overlay({ children }: { children: React.ReactNode }) {
    // Portaled to <body> at the house z-index of 1000000. At its old 210 this
    // full-screen lobby sat under the mobile bottom nav (1000) and the desktop rail
    // (999999), so nav chrome punched through the overlay and stayed clickable.
    return createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 1000000, background: "rgba(5,6,10,0.92)", display: "grid", placeItems: "center", padding: "1rem" }}>
            {children}
        </div>,
        document.body,
    );
}
