/*
 * Desktop right-rail navigation menu — the collapsible side menu.
 * Grouped: world (Travel, Tavern) → activities (Missions, Training, Jutsu,
 * Logbook) → character (Character, Inventory, Pets, Profession) → social
 * (Users, Mail) → community (Guides, Discord) →
 * system (Admin — shown to the protected admin name or any active admin
 * session so you can always get back into the panel, Logout).
 *
 * Pure leaf — `navigate` and `logoutPlayer` callbacks come in as props.
 * Admin-name gate via isProtectedAdminName from constants/game. Tavern jumps
 * straight to the player's home-village tavern from anywhere in the world.
 *
 * Extracted from App.tsx.
 */

import { memo, useEffect, useRef, useState } from "react";
import rightMenuBg from "../assets/rightmenu.webp";
import type { Profession, Screen } from "../types/core";
import { PROFESSION_LABEL } from "../data/professions";
import { isProtectedAdminName } from "../constants/game";
import { preloadScreen } from "../lib/screen-preload";
import { isAudioMuted, setAudioMuted, subscribeAudioMute } from "../lib/pet-music";
import { primeGameAudio } from "../lib/game-audio";
import { MailUnreadBadge } from "./MailUnreadBadge";
import { NotificationBar } from "./NotificationBar";
import { PLAYER_MENU_GROUPS } from "./player-menu-groups";
// Compact local game glyphs mirror the mobile nav without a second icon library.
import { GiChatBubble, GiExitDoor, GiGears, GiOpenBook, GiSpeaker, GiSpeakerOff } from "./icons/LightweightGameIcons";

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
    storyVillage,
    characterClan,
    profession,
    screen,
}: {
    navigate: (screen: Screen) => void;
    adminLoggedIn: boolean;
    logoutPlayer: () => void;
    characterName: string;
    characterVillage: string;
    storyVillage: string;
    characterClan: string;
    profession: Profession | null;
    screen: Screen;
}) {
    const [menuOpen, setMenuOpen] = useState(true);
    const navLockUntilRef = useRef(0);
    // Global audio master-mute — silences music AND all battle SFX. Mirrored
    // into local state so the icon re-renders, and subscribed so it stays in
    // sync if the switch is flipped elsewhere.
    const [audioMuted, setAudioMutedState] = useState(isAudioMuted());
    useEffect(() => subscribeAudioMute(() => setAudioMutedState(isAudioMuted())), []);
    const isAdminAccount = isProtectedAdminName(characterName);
    const guardedNavigate = (next: Screen) => {
        const now = Date.now();
        if (now < navLockUntilRef.current) return;
        navLockUntilRef.current = now + 300;
        navigate(next);
    };

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
                navigate={guardedNavigate}
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
                    onClick={() => {
                        const next = !audioMuted;
                        setAudioMuted(next);
                        setAudioMutedState(next);
                        if (!next) primeGameAudio();
                    }}
                    title={audioMuted ? "Unmute all audio" : "Mute all audio (music + sound effects)"}
                    aria-label={audioMuted ? "Unmute all audio" : "Mute all audio"}
                >{audioMuted ? <GiSpeakerOff size={18} /> : <GiSpeaker size={18} />}</button>
            </div>

            {menuOpen && (
                <>
                    <h3>Main Menu</h3>

                    {/* onPointerDown warms the destination screen's lazy chunk on
                        press (before onClick's guardedNavigate fires) — see
                        lib/screen-preload. onClick behaviour is unchanged; the preload
                        is best-effort and side-effect-free. */}
                    <div className="right-menu-buttons">
                        {PLAYER_MENU_GROUPS.map((group) => (
                            <section className={`right-menu-section right-menu-section--${group.id}`} aria-labelledby={`right-menu-${group.id}`} key={group.id}>
                                <h4 id={`right-menu-${group.id}`}><span>{group.label}</span><small aria-hidden="true">{String(group.items.length).padStart(2, "0")}</small></h4>
                                <div className="right-menu-section-grid">
                                    {group.items.map(([target, label, Icon]) => (
                                        <button key={target} aria-current={screen === target ? "page" : undefined} onClick={() => guardedNavigate(target)} onPointerDown={() => preloadScreen(target, storyVillage)} title={target === "tavern" ? `Enter the ${characterVillage} tavern from anywhere` : target === "professions" ? (profession ? `${PROFESSION_LABEL[profession]} profession hub` : "View the three professions") : undefined}>
                                            <span className="right-menu-action-icon"><Icon size={16} /></span><span className="right-menu-action-label">{target === "professions" && profession ? PROFESSION_LABEL[profession] : label}</span>{target === "messages" ? <MailUnreadBadge /> : null}
                                        </button>
                                    ))}
                                </div>
                            </section>
                        ))}
                        <section className="right-menu-section right-menu-section--support" aria-labelledby="right-menu-support">
                            <h4 id="right-menu-support"><span>Support</span><small aria-hidden="true">03</small></h4>
                            <div className="right-menu-section-grid">
                                <button aria-current={screen === "guides" ? "page" : undefined} onClick={() => guardedNavigate("guides")} onPointerDown={() => preloadScreen("guides")}><span className="right-menu-action-icon"><GiOpenBook size={16} /></span><span className="right-menu-action-label">Guides</span></button>
                                <button onClick={() => window.open("https://discord.gg/bCQGs8r6SK", "_blank", "noopener,noreferrer")}><span className="right-menu-action-icon"><GiChatBubble size={16} /></span><span className="right-menu-action-label">Discord</span></button>
                            </div>
                        </section>
                        <section className="right-menu-section right-menu-section--system" aria-labelledby="right-menu-system">
                            <h4 id="right-menu-system"><span>System</span><small aria-hidden="true">{isAdminAccount || adminLoggedIn ? "02" : "01"}</small></h4>
                            <div className="right-menu-section-grid">
                                {(isAdminAccount || adminLoggedIn) && <button onClick={() => guardedNavigate(adminLoggedIn ? "adminPanel" : "adminLogin")} onPointerDown={() => preloadScreen(adminLoggedIn ? "adminPanel" : "adminLogin")}><span className="right-menu-action-icon"><GiGears size={16} /></span><span className="right-menu-action-label">Admin</span></button>}
                                <button className="right-menu-logout" onClick={logoutPlayer} title="Save progress and return to sign in"><span className="right-menu-action-icon"><GiExitDoor size={16} /></span><span className="right-menu-action-label">Logout</span></button>
                            </div>
                        </section>
                    </div>
                </>
            )}
        </aside>
    );
});
