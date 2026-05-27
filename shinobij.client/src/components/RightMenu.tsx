/*
 * Desktop right-rail navigation menu — the collapsible side menu with
 * Village / Travel / Users / Character / Logbook / Inventory / Stats /
 * Jutsu / Missions / Pets / Arena / Bloodline / Admin (Rill-only) /
 * Logout buttons.
 *
 * Pure leaf — `navigate` and `logoutPlayer` callbacks come in as props.
 * `villageBiomes` lookup imported from App.tsx; admin-name gate via
 * isProtectedAdminName from constants/game.
 *
 * Extracted from App.tsx.
 */

import { memo, useState } from "react";
import rightMenuBg from "../assets/rightmenu.png";
import { villageBiomes } from "../App";
import type { Screen, Biome } from "../types/core";
import { isProtectedAdminName } from "../constants/game";

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
            <button onClick={() => setMenuOpen((open) => !open)}>
                {menuOpen ? "Hide Menu" : "Menu"}
            </button>

            {menuOpen && (
                <>
                    <h3>Main Menu</h3>

                    <div className="right-menu-buttons">
                        <button onClick={() => navigate("village")} disabled={!atHome} title={atHome ? undefined : `Travel to ${characterVillage} to enter`}>Village</button>
                        <button onClick={() => navigate("worldMap")}>Travel</button>
                        <button onClick={() => navigate("userHub")}>Users</button>
                        <button onClick={() => navigate("profile")}>Character</button>
                        <button onClick={() => navigate("logbook")}>Logbook</button>
                        <button onClick={() => navigate("inventory")}>Inventory</button>
                        <button onClick={() => navigate("training")}>Stats</button>
                        <button onClick={() => navigate("jutsuTraining")}>Jutsu</button>
                        <button onClick={() => navigate("missions")}>Missions</button>
                        <button onClick={() => navigate("pets")}>Pets</button>
                        <button onClick={() => navigate("arena")}>Arena</button>
                        <button onClick={() => navigate("bloodlineMaker")}>Bloodline</button>
                        {isAdminAccount && (
                            <button onClick={() => navigate(adminLoggedIn ? "adminPanel" : "adminLogin")}>Admin</button>
                        )}
                        <button onClick={logoutPlayer}>Logout + Save</button>
                    </div>
                </>
            )}
        </aside>
    );
});
