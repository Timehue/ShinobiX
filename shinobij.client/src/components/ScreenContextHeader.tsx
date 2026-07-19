import type { Screen } from "../types/core";
import { STUDIO_SCREEN_PRESENTATION } from "../lib/studio-screen-presentation";

// Text glyphs keep this shell in the initial bundle without pulling the large
// game-icons module into every route. They inherit the same framed treatment as
// the previous SVGs and remain decorative to assistive technology.
const GiBattleGear = "⚔";
const GiBookCover = "▤";
const GiCastle = "♜";
const GiPawPrint = "◆";
const GiShop = "◇";
const GiTreasureMap = "⌖";

const iconByFamily = {
  archive: GiBookCover,
  civic: GiShop,
  clan: GiCastle,
  combat: GiBattleGear,
  companion: GiPawPrint,
  frontier: GiTreasureMap,
  town: GiCastle,
} as const;

const titleOverrides: Partial<Record<Screen, string>> = {
  adminLogin: "Administration",
  adminPanel: "Administration",
  professionPicker: "Choose a Profession",
  profile: "Character Dossier",
  hunting: "Hunter Board",
  storyBoss: "Boss Encounter",
  bloodlineMaker: "Bloodline Forge",
  userHub: "Shinobi Network",
  userView: "Public Dossier",
  pvpBattle: "Shinobi Duel",
  hollowGateTiles: "Hollow Gate",
  sectorCard: "Card Clash",
  sectorPet: "Pet Battle",
  messages: "Mail",
};

function titleForScreen(screen: Screen): string {
  return titleOverrides[screen]
    ?? screen.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

export function ScreenContextHeader({ screen, village }: { screen: Screen; village: string }) {
  const context = STUDIO_SCREEN_PRESENTATION[screen];
  const title = context.facility?.name ?? titleForScreen(screen);
  const villageLabel = village.replace(/\s+Village$/i, "");
  return (
    <header className={`journey-context${context.facility ? " journey-context-facility" : ""}`} aria-label={`${title} screen`}>
      <span className={`journey-context-icon${context.facility ? " facility-icon" : ""}`} aria-hidden="true">
        {context.facility
          ? <img src={context.facility.thumbnail} alt="" draggable={false} />
          : iconByFamily[context.family]}
      </span>
      <span className="journey-context-copy">
        <span className="journey-context-eyebrow">{context.eyebrow}</span>
        <strong>{title}</strong>
        <span className="journey-context-description">{context.description}</span>
      </span>
      <span className="journey-context-village" title={village}>{villageLabel}</span>
    </header>
  );
}
