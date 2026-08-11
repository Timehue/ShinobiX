import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArenaCoopLobby } from "./components/ArenaCoopLobby";
import type { Character } from "./types/character";

const pets = [
    { id: "pet-a", name: "Aegis", level: 28, hp: 900, attack: 70, defense: 95, speed: 55, rarity: "rare", element: "Earth", role: "defender" },
    { id: "pet-b", name: "Blitz", level: 28, hp: 620, attack: 128, defense: 42, speed: 118, rarity: "rare", element: "Lightning", role: "assassin" },
    { id: "pet-c", name: "Current", level: 28, hp: 760, attack: 82, defense: 70, speed: 74, rarity: "rare", element: "Water", role: "sage" },
    { id: "pet-d", name: "Gale", level: 28, hp: 690, attack: 104, defense: 56, speed: 105, rarity: "rare", element: "Wind", role: "tracker" },
] as const;

const characterFor = (name: string) => ({ name, village: "Verdant Grove", pets: pets.map((pet) => ({ ...pet })) }) as unknown as Character;

declare global {
    interface Window {
        coopHarness: {
            switchPlayer: (name: string) => void;
            open: () => void;
            close: () => void;
        };
    }
}

export function Harness() {
    const [playerName, setPlayerName] = useState("Kakashi");
    const [open, setOpen] = useState(false);
    useEffect(() => {
        window.coopHarness = {
            switchPlayer: setPlayerName,
            open: () => setOpen(true),
            close: () => setOpen(false),
        };
    }, []);
    return (
        <main>
            <h1>Co-op harness</h1>
            <p id="active-player">Active player: {playerName}</p>
            <button id="open-coop" type="button" onClick={() => setOpen(true)}>Open Co-op Lobby</button>
            {open ? <ArenaCoopLobby key={playerName.trim().toLowerCase()} character={characterFor(playerName)} sharedImages={{}} onExit={() => setOpen(false)} /> : null}
        </main>
    );
}

createRoot(document.getElementById("root")!).render(<Harness />);
