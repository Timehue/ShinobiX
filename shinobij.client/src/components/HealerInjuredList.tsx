/*
 * Healer injured/KO'd-villager list + heal flow.
 *
 * Extracted verbatim from screens/Hospital.tsx so the same list (and the
 * server-authoritative heal action) can be reused on the Healer profession
 * hub (screens/professions/HealerHub.tsx). Behaviour is unchanged: it shows
 * same-village admitted players to ANY caller (heal button only for Healers),
 * plus a Rank-10 world-wide injured list, and posts heals to /api/player/heal.
 *
 * Self-contained: owns its healed/healMsg/world-wide-fetch state and only
 * reaches out via `updateCharacter` to mirror the Healer's post-heal
 * chakra/XP/rank. Renders nothing of its own chrome — drop it inside a card.
 */
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { visiblePoll } from "../lib/poll";
import type { Character, PlayerRecord } from "../App";

// Mirror the server's HP_INJURED_THRESHOLD (0.99) from
// api/player/injured-villagers.ts so the in-village list agrees with the
// Rank-10 world-wide list on what counts as "hurt". A stale roster entry can
// still carry hospitalized=true after the player's HP has reached full
// (passive regen / healed-but-not-discharged) — nothing to heal there.
const HP_INJURED_THRESHOLD = 0.99;

export function HealerInjuredList({
    character,
    updateCharacter,
    playerRoster,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    playerRoster: PlayerRecord[];
}) {
    const isHealer = character.profession === "healer";
    const healerRank = isHealer ? (character.professionRank ?? 1) : 0;
    const hasWorldwideVision = isHealer && healerRank >= 10;

    const [healMsg, setHealMsg] = useState<Record<string, string>>({});
    const [healed, setHealed] = useState<Set<string>>(new Set());
    const [worldwideInjured, setWorldwideInjured] = useState<Array<{ name: string; level: number; hp: number; maxHp: number; hospitalized: boolean }>>([]);

    useEffect(() => {
        if (!hasWorldwideVision) {
            setWorldwideInjured([]);
            return;
        }
        let cancelled = false;
        async function fetchInjured() {
            try {
                const res = await fetch(`/api/player/injured-villagers?healerName=${encodeURIComponent(character.name)}`);
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (Array.isArray(data.injured)) setWorldwideInjured(data.injured);
            } catch { /* ignore */ }
        }
        void fetchInjured();
        const stop = visiblePoll(fetchInjured, 20_000);
        return () => { cancelled = true; stop(); };
    }, [hasWorldwideVision, character.name]);

    async function healPlayer(targetName: string) {
        setHealMsg(m => ({ ...m, [targetName]: "💚 Healing…" }));
        try {
            const res = await fetch('/api/player/heal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ healerName: character.name, targetName }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setHealMsg(m => ({ ...m, [targetName]: `❌ ${data.error ?? 'Failed'}` }));
                return;
            }
            const xpGained = Number(data.xpGained ?? 0);
            const missionXp = Number(data.missionXpAwarded ?? 0);
            const raidAssist = !!data.raidAssist;
            const missionsCompleted: Array<{ id: string; name: string; xpReward: number }> = Array.isArray(data.missionsCompleted) ? data.missionsCompleted : [];
            for (const m of missionsCompleted) {
                window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                    detail: { name: m.name, xp: m.xpReward, profession: 'healer' },
                }));
            }
            // Raid assist toast — distinct from regular heal so the player
            // notices the +50% bonus when it triggers.
            if (raidAssist && xpGained > 0) {
                window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                    detail: { name: '⚔ Raid Assist!', xp: xpGained, profession: 'healer' },
                }));
            }
            const prevRank = character.professionRank ?? 1;
            // Server returns the authoritative post-credit XP/rank (mission XP included).
            const finalXp = Number(data.professionXp ?? (character.professionXp ?? 0) + xpGained);
            const finalRank = Number(data.professionRank ?? prevRank);
            // Functional updater (write happens after `await fetch('/api/player/heal')`):
            // a concurrent regen/heartbeat setState during the await would otherwise be
            // clobbered. professionXp/Rank are server-authoritative absolutes; chakra
            // deducts off the LATEST prev so a concurrent chakra change survives.
            updateCharacter((prev) => prev ? ({
                ...prev,
                professionXp: finalXp,
                professionRank: finalRank,
                chakra: Math.max(0, (prev.chakra ?? 0) - Number(data.chakraCost ?? 0)),
            }) : prev);
            const rankedUp = finalRank > prevRank;
            const totalXp = xpGained + missionXp;
            let msg = `✅ Healed! +${totalXp} XP`;
            if (raidAssist) msg += ` ⚔ Raid Assist +50%`;
            if (missionsCompleted.length > 0) msg += ` (mission complete!)`;
            if (rankedUp) msg += ` — Rank ${finalRank}!`;
            setHealMsg(m => ({ ...m, [targetName]: msg }));
            // Hide the row locally until next roster refresh confirms.
            setHealed(s => new Set(s).add(targetName));
        } catch {
            setHealMsg(m => ({ ...m, [targetName]: "❌ Network error" }));
        }
    }

    // Same-village admitted players are listed for ANY caller (the UI renders
    // the "Heal" button only for healers, but non-healers can see who's down).
    const hospitalizedPlayers = playerRoster.filter(p =>
        p.character.hospitalized
        && p.name.toLowerCase() !== character.name.toLowerCase()
        && !healed.has(p.name)
        && p.character.village === character.village
        && p.character.maxHp > 0
        && p.character.hp / p.character.maxHp <= HP_INJURED_THRESHOLD
    );

    return (
        <>
            {hospitalizedPlayers.length > 0 && (
                <div style={{ marginTop: "1.5rem" }}>
                    <h4 style={{ marginBottom: "0.5rem" }}>🛏️ Admitted Players{isHealer ? ` — ${character.village}` : ""}</h4>
                    {hospitalizedPlayers.map(p => (
                        <div key={p.name} className="summary-box" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                            <div style={{ flex: 1 }}>
                                <strong>{p.name}</strong>
                                <span className="hint" style={{ marginLeft: 6 }}>Lv {p.level} · {p.village}</span>
                                <span style={{ marginLeft: 8, color: "#f87171", fontSize: "0.8rem" }}>
                                    HP {p.character.hp}/{p.character.maxHp}
                                </span>
                            </div>
                            {isHealer ? (
                                <button onClick={() => healPlayer(p.name)} style={{ background: "linear-gradient(#0e7490,#155e75)", borderColor: "#22d3ee" }}>
                                    ✚ Heal
                                </button>
                            ) : (
                                <span className="hint" style={{ color: "#64748b", fontSize: "0.78rem" }}>
                                    Healers only
                                </span>
                            )}
                            {healMsg[p.name] && (
                                <span className="hint" style={{ color: healMsg[p.name].startsWith("✅") ? "#22d3ee" : "#f87171" }}>
                                    {healMsg[p.name]}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {hasWorldwideVision && (
                <div style={{ marginTop: "1.5rem" }}>
                    <h4 style={{ marginBottom: "0.5rem", color: "#22d3ee" }}>
                        🌍 Injured Villagers — World-Wide (Rank 10)
                    </h4>
                    <p className="hint" style={{ marginTop: 0 }}>
                        Same-village shinobi anywhere in the world with HP below max. Sorted lowest HP first.
                    </p>
                    {worldwideInjured.filter(p => !healed.has(p.name)).length === 0 ? (
                        <p className="hint">All villagers are at full health.</p>
                    ) : (
                        worldwideInjured.filter(p => !healed.has(p.name)).map(p => {
                            const hpPct = Math.max(0, Math.min(100, Math.round((p.hp / p.maxHp) * 100)));
                            return (
                                <div key={p.name} className="summary-box" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                                    <div style={{ flex: 1 }}>
                                        <strong>{p.name}</strong>
                                        <span className="hint" style={{ marginLeft: 6 }}>Lv {p.level}</span>
                                        {p.hospitalized && <span style={{ marginLeft: 8, color: "#facc15", fontSize: "0.75rem" }}>🛏️ Admitted</span>}
                                        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                                            <div style={{ flex: 1, maxWidth: 200, height: 6, background: "rgba(148,163,184,0.2)", borderRadius: 3, overflow: "hidden" }}>
                                                <div style={{ width: `${hpPct}%`, height: "100%", background: hpPct < 30 ? "#f87171" : hpPct < 60 ? "#facc15" : "#84cc16" }} />
                                            </div>
                                            <span style={{ color: hpPct < 30 ? "#f87171" : "#94a3b8", fontSize: "0.78rem" }}>
                                                {p.hp}/{p.maxHp}
                                            </span>
                                        </div>
                                    </div>
                                    <button onClick={() => healPlayer(p.name)} style={{ background: "linear-gradient(#0e7490,#155e75)", borderColor: "#22d3ee" }}>
                                        ✚ Heal
                                    </button>
                                    {healMsg[p.name] && (
                                        <span className="hint" style={{ color: healMsg[p.name].startsWith("✅") ? "#22d3ee" : "#f87171" }}>
                                            {healMsg[p.name]}
                                        </span>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </>
    );
}
