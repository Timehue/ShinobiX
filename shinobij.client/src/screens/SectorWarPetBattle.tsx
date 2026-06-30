import { useState, useEffect, useCallback, Suspense, lazy } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import type { Pet } from "../types/pet";
import { runPetDuel, type DuelResult } from "../lib/pet-duel-sim";
import { joinSectorPet, sectorPetState } from "../lib/village-war-map";

/*
 * Sector War "Pet" win-condition screen (Phase 7). The player sends a pet; the
 * attacker opens, a defender answers, and the server resolves a DETERMINISTIC pet
 * duel (api/village/sector-pet → api/_pet-sim, the ported engine). The outcome is
 * server-authoritative; this screen REPLAYS the same (pets, seed) so the fight you
 * watch is byte-identical to what the server recorded — it can never disagree on
 * who won. No win/loss is ever reported from here.
 */
const PetColiseumDuel = lazy(() => import("../components/PetColiseum").then((m) => ({ default: m.PetColiseumDuel })));

type PetSession = {
    sectorWarId: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    p1: { name: string; pet: Pet };
    p2?: { name: string; pet: Pet };
    status: "awaiting-defender" | "done";
    seed?: number;
    winner?: "p1" | "p2" | "draw";
};

export function SectorWarPetBattle({ character, setScreen }: { character: Character; setScreen: (s: Screen) => void }) {
    const sectorWarId = (() => {
        try { return String((JSON.parse(sessionStorage.getItem("sectorWarPet.v1") ?? "{}") as { sectorWarId?: string }).sectorWarId ?? ""); } catch { return ""; }
    })();
    const [selectedPetId, setSelectedPetId] = useState(character.pets[0]?.id ?? "");
    const [session, setSession] = useState<PetSession | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const back = useCallback(() => setScreen("villageWarMap"), [setScreen]);

    // Poll the session until the duel resolves (when a defender answers, the server
    // settles it instantly — the deterministic sim needs no turns). Keyed on
    // session?.status (not the whole session) so the interval isn't torn down + rebuilt
    // on every poll tick.
    useEffect(() => {
        if (!sectorWarId || !session || session.status === "done") return;
        let alive = true;
        const id = setInterval(() => {
            void sectorPetState(character.name, sectorWarId)
                .then((d) => { const s = (d as { session?: PetSession }).session; if (alive && s) setSession(s); })
                .catch(() => { /* poll is best-effort */ });
        }, 4000);
        return () => { alive = false; clearInterval(id); };
    }, [sectorWarId, session?.status, character.name]); // eslint-disable-line react-hooks/exhaustive-deps

    const send = useCallback(async () => {
        if (!sectorWarId || !selectedPetId) return;
        setBusy(true); setError("");
        try {
            const d = await joinSectorPet(character.name, sectorWarId, selectedPetId) as { session?: PetSession; error?: string };
            if (d.session) setSession(d.session); else setError(d.error ?? "Could not start the pet duel.");
        } catch (e) { setError(String((e as Error).message || e)); }
        finally { setBusy(false); }
    }, [sectorWarId, selectedPetId, character.name]);

    if (!sectorWarId) {
        return (<div className="card" style={{ maxWidth: 480, margin: "2rem auto", textAlign: "center" }}><p>No pet duel selected.</p><button onClick={back}>← Back</button></div>);
    }

    // Resolved → replay the deterministic duel (identical to the server) + the result.
    if (session?.status === "done" && session.p2 && session.seed != null) {
        const result: DuelResult = runPetDuel(session.p1.pet, session.p2.pet, session.seed, 1, 1, false, false, false);
        const mine = character.name.toLowerCase() === session.p1.name.toLowerCase() ? "p1"
            : character.name.toLowerCase() === session.p2.name.toLowerCase() ? "p2" : null;
        const banner = session.winner === "draw" ? "The pet duel ended in a draw — the sector holds."
            : mine && session.winner === mine ? "🏆 Your pet won the sector duel!"
            : mine ? "Your pet was defeated."
            : `${session.winner === "p1" ? session.attackerVillage : session.defenderVillage} took the duel.`;
        return (
            <div>
                <div style={{ textAlign: "center", padding: 8, fontWeight: 700 }}>{banner}</div>
                <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8" }}>Loading the arena…</div>}>
                    <PetColiseumDuel key={session.seed} playerPet={session.p1.pet} enemyPet={session.p2.pet} seed={session.seed} result={result} sharedImages={{}} onFightAgain={() => setSession(null)} onExit={back} />
                </Suspense>
            </div>
        );
    }

    // Attacker opened, waiting for a defender to answer.
    if (session?.status === "awaiting-defender") {
        return (
            <div className="card" style={{ maxWidth: 480, margin: "2rem auto", textAlign: "center" }}>
                <h3>🐾 Pet Duel — Sector War</h3>
                <p className="hint">⏳ Waiting for a defender to answer with their pet…</p>
                <p style={{ fontSize: ".85rem" }}>Your pet <b>{session.p1.pet?.name}</b> stands ready.</p>
                <button onClick={back}>← Leave</button>
            </div>
        );
    }

    // Pet selection.
    return (
        <div className="card" style={{ maxWidth: 480, margin: "2rem auto", textAlign: "center" }}>
            <h3>🐾 Pet Duel — Sector War</h3>
            <p className="hint">Send a pet to fight for this sector. The duel resolves server-side and replays here.</p>
            {character.pets.length === 0 ? <p>You have no pets to send into battle.</p> : (
                <>
                    <select value={selectedPetId} onChange={(e) => setSelectedPetId(e.target.value)} disabled={busy} style={{ margin: "8px 0" }}>
                        {character.pets.map((p) => <option key={p.id} value={p.id}>{p.name} · Lv {p.level} · {p.element}</option>)}
                    </select>
                    <div><button onClick={send} disabled={busy || !selectedPetId}>{busy ? "…" : "Send into battle"}</button></div>
                </>
            )}
            {error && <p style={{ color: "#f87171" }}>{error}</p>}
            <div style={{ marginTop: 10 }}><button onClick={back}>← Back</button></div>
        </div>
    );
}
