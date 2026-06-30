/*
 * Desktop right-rail navigation menu — the collapsible side menu.
 * Grouped: travel/world (Tavern, Travel, Users) → activities
 * (Missions, Training) → character (Character, Inventory, Jutsu, Pets,
 * Bloodline, Logbook) → community (Discord, Patreon — external links) →
 * system (Admin — shown to the protected admin name or any active admin
 * session so you can always get back into the panel, Logout).
 *
 * Pure leaf — `navigate` and `logoutPlayer` callbacks come in as props.
 * Admin-name gate via isProtectedAdminName from constants/game. Tavern jumps
 * straight to the player's home-village tavern from anywhere in the world.
 *
 * Extracted from App.tsx.
 */

import { memo, useEffect, useState } from "react";
import rightMenuBg from "../assets/rightmenu.webp";
import type { Profession, Screen } from "../types/core";
import { PROFESSION_LABEL } from "../data/professions";
import { isProtectedAdminName } from "../constants/game";
import { isAudioMuted, setAudioMuted, subscribeAudioMute } from "../lib/pet-music";
import { MailUnreadBadge } from "./MailUnreadBadge";
import { NotificationBar } from "./NotificationBar";
// Fantasy / RPG glyphs from game-icons.net (CC BY 3.0) via react-icons — matches the
// shinobi theme. Mirrors the mobile nav (MobileNav.tsx). Attribution in the footer below.
import {
    GiAnvil, GiBeerStein, GiBiceps, GiBookCover, GiChatBubble, GiDna1, GiEnvelope,
    GiExitDoor, GiFireSpellCast, GiGears, GiHearts, GiKnapsack, GiNinjaHeroicStance,
    GiOpenBook, GiPawPrint, GiScrollUnfurled, GiSpeaker, GiSpeakerOff, GiThreeFriends, GiTreasureMap,
} from "react-icons/gi";

// Memo'd — `navigate`/`logoutPlayer` are stable callbacks from App's
// useCallback hooks (or the navigate wrapper). All other props are
// primitive (strings/booleans). Shallow compare safely skips the
// re-render whenever the side rail's props are unchanged.
export const RightMenu = memo(function RightMenu({
    navigate,
    adminLoggedIn,
    logoutPlayer,
    characterName,
    characterVillage,
    characterClan,
    profession,
    screen,
}: {
    navigate: (screen: Screen) => void;
    adminLoggedIn: boolean;
    logoutPlayer: () => void;
    characterName: string;
    characterVillage: string;
    characterClan: string;
    profession: Profession | null;
    screen: Screen;
}) {
    const [menuOpen, setMenuOpen] = useState(true);
    // Global audio master-mute — silences music AND all battle SFX. Mirrored
    // into local state so the icon re-renders, and subscribed so it stays in
    // sync if the switch is flipped elsewhere.
    const [audioMuted, setAudioMutedState] = useState(isAudioMuted());
    useEffect(() => subscribeAudioMute(() => setAudioMutedState(isAudioMuted())), []);
    const isAdminAccount = isProtectedAdminName(characterName);

    return (
        <aside
            className={`right-menu-panel ${menuOpen ? "open" : "closed"}`}
            style={{
                // Dark scrim over the night-village art so the header buttons and
                // gold "Main Menu" heading stay readable over the bright moon up
                // top; mid stays clear, bottom dims again under the torii art.
                backgroundImage: `linear-gradient(180deg, rgba(3,7,18,0.55), rgba(3,7,18,0.28) 26%, rgba(3,7,18,0.20) 60%, rgba(3,7,18,0.50)), url(${rightMenuBg})`,
            }}
        >
            <NotificationBar
                navigate={navigate}
                screen={screen}
                clan={characterClan}
                village={characterVillage}
                compact={!menuOpen}
            />

            <div className="right-menu-header-row">
                <button onClick={() => setMenuOpen((open) => !open)}>
                    {menuOpen ? "Hide Menu" : "Menu"}
                </button>
                <button
                    className="audio-mute-btn"
                    onClick={() => { const next = !audioMuted; setAudioMuted(next); setAudioMutedState(next); }}
                    title={audioMuted ? "Unmute all audio" : "Mute all audio (music + sound effects)"}
                    aria-label={audioMuted ? "Unmute all audio" : "Mute all audio"}
                >{audioMuted ? <GiSpeakerOff size={18} /> : <GiSpeaker size={18} />}</button>
            </div>

            {menuOpen && (
                <>
                    <h3>Main Menu</h3>

                    <div className="right-menu-buttons">
                        <button onClick={() => navigate("tavern")} title={`Enter the ${characterVillage} tavern from anywhere`}><GiBeerStein size={16} />Tavern</button>
                        <button onClick={() => navigate("worldMap")}><GiTreasureMap size={16} />Travel</button>
                        <button onClick={() => navigate("userHub")}><GiThreeFriends size={16} />Users</button>
                        <button onClick={() => navigate("messages")}><GiEnvelope size={16} />Mail<MailUnreadBadge /></button>
                        <button onClick={() => navigate("missions")}><GiScrollUnfurled size={16} />Missions</button>
                        <button onClick={() => navigate("training")}><GiBiceps size={16} />Training</button>
                        <button onClick={() => navigate("profile")}><GiNinjaHeroicStance size={16} />Character</button>
                        <button onClick={() => navigate("inventory")}><GiKnapsack size={16} />Inventory</button>
                        <button onClick={() => navigate("jutsuTraining")}><GiFireSpellCast size={16} />Jutsu</button>
                        <button onClick={() => navigate("pets")}><GiPawPrint size={16} />Pets</button>
                        <button onClick={() => navigate("bloodlineMaker")}><GiDna1 size={16} />Bloodline</button>
                        <button
                            onClick={() => navigate("professions")}
                            title={profession ? `${PROFESSION_LABEL[profession]} profession hub` : "View the three professions"}
                        >
                            <GiAnvil size={16} />{profession ? PROFESSION_LABEL[profession] : "Professions"}
                        </button>
                        <button onClick={() => navigate("logbook")}><GiBookCover size={16} />Logbook</button>
                        <button onClick={() => navigate("guides")}><GiOpenBook size={16} />Guides</button>
                        <button onClick={() => window.open("https://discord.gg/bCQGs8r6SK", "_blank", "noopener,noreferrer")}><GiChatBubble size={16} />Discord</button>
                        <button onClick={() => window.open("https://www.patreon.com/c/shinobijourney", "_blank", "noopener,noreferrer")}><GiHearts size={16} />Patreon</button>
                        {(isAdminAccount || adminLoggedIn) && (
                            <button onClick={() => navigate(adminLoggedIn ? "adminPanel" : "adminLogin")}><GiGears size={16} />Admin</button>
                        )}
                        <button onClick={logoutPlayer}><GiExitDoor size={16} />Logout + Save</button>
                    </div>
                </>
            )}
        </aside>
    );
});
