import type { Screen } from "../types/core";

const SCREEN_MESSAGES: Partial<Record<Screen, string>> = {
    adminLogin: "Loading Admin Login",
    adminPanel: "Loading Admin Tools",
    arena: "Preparing Arena",
    battleArena: "Preparing Arena",
    arenaDistrict: "Loading Arena District",
    bloodlineMaker: "Loading Bloodline Maker",
    worldMap: "Loading World Map",
    storyHall: "Loading Story Hall",
    storyBoss: "Loading Story Scene",
    training: "Loading Training Grounds",
    jutsuTraining: "Loading Jutsu Training",
    missions: "Loading Missions",
    profile: "Loading Profile",
    bank: "Loading Bank",
    shop: "Loading Shop",
    hospital: "Loading Hospital",
    cafeteria: "Loading Cafeteria",
    townHall: "Loading Town Hall",
    clan: "Loading Clan Hall",
    petArena: "Preparing Pet Arena",
    petLadder: "Loading Pet Ladder",
    battleTowers: "Loading Battle Towers",
    dungeon: "Loading Story Scene",
    hollowGateShrine: "Restoring Shrine",
    hollowGateTiles: "Restoring Seal Trial",
    pvpBattle: "Restoring Battle",
};

export function ScreenLoadingFallback({ screen }: { screen: Screen }) {
    return (
        <div
            className="lazy-screen-fallback"
            role="status"
            aria-live="polite"
            aria-busy="true"
            style={{
                minHeight: 220,
                padding: "2.25rem 1rem",
                display: "grid",
                placeItems: "center",
                textAlign: "center",
                color: "#cbd5e1",
            }}
        >
            <div
                style={{
                    padding: "0.9rem 1.15rem",
                    borderRadius: 12,
                    background: "rgba(15,23,42,0.78)",
                    border: "1px solid rgba(148,163,184,0.22)",
                    boxShadow: "0 18px 42px rgba(0,0,0,0.28)",
                }}
            >
                <strong style={{ display: "block", color: "#facc15", marginBottom: 4 }}>
                    {SCREEN_MESSAGES[screen] ?? "Loading Screen"}
                </strong>
                <span style={{ fontSize: 13, color: "#94a3b8" }}>Restoring the next view...</span>
            </div>
        </div>
    );
}
