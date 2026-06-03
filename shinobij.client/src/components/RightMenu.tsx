/*
 * Desktop right-rail navigation menu — the collapsible side menu.
 * Grouped: travel/world (Village, Travel, Users) → activities
 * (Missions, Training) → character (Character, Inventory, Jutsu, Pets,
 * Bloodline, Logbook) → community (Discord, Patreon — external links) →
 * system (Admin — shown to the protected admin name or any active admin
 * session so you can always get back into the panel, Logout).
 *
 * Pure leaf — `navigate` and `logoutPlayer` callbacks come in as props.
 * `villageBiomes` lookup imported from ./data/village-biomes; admin-name gate
 * via isProtectedAdminName from constants/game.
 *
 * Extracted from App.tsx.
 */

import { memo, useEffect, useState } from "react";
import rightMenuBg from "../assets/rightmenu.png";
import { villageBiomes } from "../data/village-biomes";
import type { Screen, Biome } from "../types/core";
import { isProtectedAdminName } from "../constants/game";
import { isAudioMuted, setAudioMuted, subscribeAudioMute } from "../lib/pet-music";

// Memo'd — `navigate`/`logoutPlayer` are stable callbacks from App's
// useCallback hooks (or the navigate wrapper). All other props are
// primitive (strings/booleans). Shallow compare safely skips the
// re-render whenever the side rail's props are unchanged.
export const RightMenu = memo(function RightMenu({
    navigate,
    adminLoggedIn,
    logoutPlayer,
    currentBiome,
    characterName,
    characterVillage,
    screen,
}: {
    navigate: (screen: Screen) => void;
    adminLoggedIn: boolean;
    logoutPlayer: () => void;
    currentBiome: Biome;
    characterName: string;
    characterVillage: string;
    screen: Screen;
}) {
    const [menuOpen, setMenuOpen] = useState(true);
    // Global audio master-mute — silences music AND all battle SFX. Mirrored
    // into local state so the icon re-renders, and subscribed so it stays in
    // sync if the switch is flipped elsewhere.
    const [audioMuted, setAudioMutedState] = useState(isAudioMuted());
    useEffect(() => subscribeAudioMute(() => setAudioMutedState(isAudioMuted())), []);
    const homeBiome = villageBiomes[characterVillage];
    const atHome = screen !== "worldMap" || currentBiome === homeBiome;
    const isAdminAccount = isProtectedAdminName(characterName);

    return (
        <aside
            className={`right-menu-panel ${menuOpen ? "open" : "closed"}`}
            style={{
                backgroundImage: `url(${rightMenuBg})`,
            }}
        >
            <div className="right-menu-header-row">
                <button onClick={() => setMenuOpen((open) => !open)}>
                    {menuOpen ? "Hide Menu" : "Menu"}
                </button>
                <button
                    className="audio-mute-btn"
                    onClick={() => { const next = !audioMuted; setAudioMuted(next); setAudioMutedState(next); }}
                    title={audioMuted ? "Unmute all audio" : "Mute all audio (music + sound effects)"}
                    aria-label={audioMuted ? "Unmute all audio" : "Mute all audio"}
                >{audioMuted ? "🔇" : "🔊"}</button>
            </div>

            {menuOpen && (
                <>
                    <h3>Main Menu</h3>

                    <div className="right-menu-buttons">
                        <button onClick={() => navigate("village")} disabled={!atHome} title={atHome ? undefined : `Travel to ${characterVillage} to enter`}>Village</button>
                        <button onClick={() => navigate("worldMap")}>Travel</button>
                        <button onClick={() => navigate("userHub")}>Users</button>
                        <button onClick={() => navigate("messages")}>📬 Mail</button>
                        <button onClick={() => navigate("missions")}>Missions</button>
                        <button onClick={() => navigate("training")}>Training</button>
                        <button onClick={() => navigate("profile")}>Character</button>
                        <button onClick={() => navigate("inventory")}>Inventory</button>
                        <button onClick={() => navigate("jutsuTraining")}>Jutsu</button>
                        <button onClick={() => navigate("pets")}>Pets</button>
                        <button onClick={() => navigate("bloodlineMaker")}>Bloodline</button>
                        <button onClick={() => navigate("logbook")}>Logbook</button>
                        <button onClick={() => window.open("https://discord.gg/bCQGs8r6SK", "_blank", "noopener,noreferrer")}>💬 Discord</button>
                        <button onClick={() => window.open("https://www.patreon.com/c/shinobijourney", "_blank", "noopener,noreferrer")}>♥ Patreon</button>
                        {(isAdminAccount || adminLoggedIn) && (
                            <button onClick={() => navigate(adminLoggedIn ? "adminPanel" : "adminLogin")}>Admin</button>
                        )}
                        <button onClick={logoutPlayer}>Logout + Save</button>
                    </div>
                </>
            )}
        </aside>
    );
});
