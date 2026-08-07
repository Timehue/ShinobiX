/*
 * ScreenHint - one-time, dismissible contextual tips for major screens.
 *
 * The guided Academy path covers the first-session loop; after that, these
 * small hints explain what a newly opened system is for without blocking play.
 * Dismissals live in character.seenHints and persist with the normal save.
 */
import { createPortal } from "react-dom";
import { normalizeOnboardingStep } from "../lib/onboarding-step";
import type { Character, Screen } from "../App";

const HINTS: Partial<Record<Screen, string>> = {
    battleArena: "Battle Arena - practice combat here. Start with AI or mission fights before challenging real players.",
    bank: "Bank - store spare ryo and claim interest once per day. Keep enough cash on hand for healing and gear.",
    cafeteria: "Cafeteria - quick recovery food for early play. Use Hospital for serious injuries.",
    clan: "Clan Hall - join or found a clan when you want group goals; village war content is best after the basics.",
    grandMarketplace: "Grand Marketplace - advanced trading and crafting options. Check costs before spending rare materials.",
    hallOfLegends: "Hall of Legends - long-term records live here. Early progress still comes from missions, training, and Logbook goals.",
    hospital: "Hospital - recover here after a hard fight. If admitted, you must discharge before leaving.",
    jutsuTraining: "Jutsu Hall - unlock and sharpen jutsu, then equip them from your Character screen so they appear in battle.",
    missions: "Mission Hall - accept work, finish the objective, then return here to claim the posted reward.",
    pets: "Pet Yard - manage companions, expeditions, and your active pet. Deep pet battles can wait until you know your main loop.",
    professions: "Professions - choose a long-term role once it unlocks. The choice shapes rewards, not your basic combat controls.",
    shop: "Shop - buy gear and consumables with ryo. Early armor and a backup item are worth more than hoarding cash.",
    shinobiTiles: "Card Hall - build a 40-card Chronicle deck, learn the phase flow against AI, or queue for free-play PvP.",
    townHall: "Town Hall - village upgrades improve services and rewards. War controls coordinate live village and sector campaigns.",
    training: "Training Grounds - start a timed stat session whenever idle. Training keeps working while you play elsewhere.",
    worldMap: "World Map - explore sectors for missions, encounters, pets, and materials. Return to the village before pushing too far.",
};

const bannerStyle: React.CSSProperties = {
    position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)",
    maxWidth: 520, width: "calc(100% - 24px)", background: "var(--slate-900)",
    border: "1px solid var(--cyan)", borderRadius: 12, padding: "10px 14px",
    display: "flex", alignItems: "center", gap: 10, color: "#e0f2fe",
    zIndex: 8500, boxShadow: "0 6px 24px rgba(0,0,0,0.5)", fontSize: 14,
};

export function ScreenHint({
    screen, character, updateCharacter,
}: {
    screen: Screen;
    character: Character;
    updateCharacter: (c: Character) => void;
}) {
    const text = HINTS[screen];
    if (!text) return null;
    // Don't compete with the guided coach; only ambient-hint once roaming freely.
    if (normalizeOnboardingStep(character.onboardingStep) !== "done") return null;
    if ((character.seenHints ?? []).includes(screen)) return null;

    const dismiss = () => updateCharacter({ ...character, seenHints: [...(character.seenHints ?? []), screen] });

    return createPortal(
        <div className="onboarding-coach-banner" style={bannerStyle}>
            <span style={{ flex: 1, lineHeight: 1.4 }}>{text}</span>
            <button
                className="start-primary-btn"
                // start-primary-btn is a full-width vertical-card button
                // (display:block; width:100%; margin-top:16px). In this one-row
                // flex banner those would make it hog the row and squish the
                // hint text, so size it to its label and clear the top margin.
                style={{ flexShrink: 0, display: "inline-block", width: "auto", marginTop: 0 }}
                onClick={dismiss}
            >
                Got it
            </button>
        </div>,
        document.body,
    );
}

