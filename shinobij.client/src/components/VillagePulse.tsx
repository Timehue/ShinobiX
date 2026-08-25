import { useEffect, useState } from "react";
import type { Character, ServerPlayerSummary } from "../types/character";
import type { Screen } from "../types/core";
import { deriveVillagePresence } from "../lib/village-presence";
import { isAcademyOnboardingActive } from "../lib/onboarding-step";
import { fetchWorldCrisis } from "../lib/world-crisis";
import { fetchWorldCrisis80 } from "../lib/world-crisis-80";
import type { WorldCrisisProjection } from "../../../shared/world-crisis";
import type { WorldCrisis80Projection } from "../../../shared/world-crisis-80";
import "./VillagePulse.css";

export function VillagePulse({
    character,
    allServerPlayers,
    setScreen,
}: {
    character: Character;
    allServerPlayers: ServerPlayerSummary[];
    setScreen: (screen: Screen) => void;
}) {
    const [crisis, setCrisis] = useState<WorldCrisisProjection | null>(null);
    const [reckoning, setReckoning] = useState<WorldCrisis80Projection | null>(null);
    useEffect(() => {
        let alive = true;
        const refresh = () => { void Promise.all([fetchWorldCrisis(), fetchWorldCrisis80()]).then(([next, next80]) => { if (!alive) return; if (next) setCrisis(next); if (next80) setReckoning(next80); }); };
        refresh();
        const timer = window.setInterval(refresh, 20_000);
        return () => { alive = false; window.clearInterval(timer); };
    }, []);
    if (isAcademyOnboardingActive(character.onboardingStep ?? "")) return null;

    const presence = deriveVillagePresence(character.name, character.village, allServerPlayers);
    const otherOnline = presence.onlineTotal - 1;
    const villagePeers = presence.villageOnline - 1;
    const summary = otherOnline === 0
        ? "Your presence is live. No other shinobi are visible right now."
        : `${villagePeers} ${villagePeers === 1 ? "ally is" : "allies are"} online from your village, with ${presence.inField} shinobi active beyond the gates.`;
    const localCrisis = crisis?.villages[character.village as keyof WorldCrisisProjection["villages"]];
    const localReckoning = reckoning?.villages[character.village as keyof WorldCrisis80Projection["villages"]];
    const activeCrisis = reckoning?.status === "active" && localReckoning
        ? { local: localReckoning, level80: true }
        : crisis?.status === "active" && localCrisis ? { local: localCrisis, level80: false } : null;

    return (
        <aside className="village-live-pulse" aria-labelledby="village-live-pulse-title">
            <header className="village-live-pulse__header">
                <div>
                    <span className="village-live-pulse__kicker"><i aria-hidden="true" /> Live world</span>
                    <h2 id="village-live-pulse-title">{character.village} Pulse</h2>
                </div>
                <span className="village-live-pulse__count" aria-label={`${presence.onlineTotal} shinobi online`}>
                    {presence.onlineTotal} online
                </span>
            </header>

            <p className="village-live-pulse__summary" role="status" aria-live="polite">{summary}</p>

            {activeCrisis && (
                <button type="button" className="village-live-pulse__crisis" onClick={() => { if (activeCrisis.level80) try { sessionStorage.setItem("worldCrisis.focus", "80"); } catch { /* best effort */ } setScreen("worldCrisis"); }}>
                    <span><i aria-hidden="true" /> WORLD EMERGENCY</span>
                    <strong>{activeCrisis.level80 ? "Protect the witness ledger" : "Defend the village outskirts"}</strong>
                    <small>{activeCrisis.local.remaining} defenses needed · {activeCrisis.local.integrityPercent}% integrity</small>
                </button>
            )}

            {presence.visiblePlayers.length > 0 ? (
                <ul className="village-live-pulse__shinobi" aria-label="Shinobi online now">
                    {presence.visiblePlayers.map((player) => (
                        <li key={player.name} title={`${player.name}, level ${player.level}, ${player.village}`}>
                            <span aria-hidden="true" />
                            <strong>{player.name}</strong>
                            <small>Lv {player.level}</small>
                        </li>
                    ))}
                </ul>
            ) : null}

            <nav className="village-live-pulse__actions" aria-label="Village social destinations">
                <button type="button" onClick={() => setScreen("tavern")}>Open Tavern</button>
                <button type="button" onClick={() => setScreen("userHub")}>Find Shinobi</button>
                <button type="button" onClick={() => setScreen("clan")}>{character.clan ? "Clan Hall" : "Find a Clan"}</button>
            </nav>
        </aside>
    );
}
