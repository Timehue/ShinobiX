import type { Screen } from "../types/core";
import type { AnnouncementView } from "../lib/legacy";
import { WorldCrisisNewsReport, type WorldCrisisNewsFrame } from "./WorldCrisisNewsReport";

const FRAMES: readonly WorldCrisisNewsFrame[] = [
    { kicker: "THE FIRST OMEN", title: "A field record crossed the line", body: "The four villages had already uncovered the machinery beneath their own walls. When one shinobi reached level 37, those separate records matched for the first time." },
    { kicker: "CIVIC WORKS · RECALL ORDER", title: "The quartered seal lit", body: "The Sunken Court did not rise as a creature or open a portal. Its old civic network issued one human-made recall order through four village anchors." },
    { kicker: "FOUR OUTSKIRTS · ONE WORLD", title: "The old wardens began to march", body: "Storm Engine Warden. First Flame Sentinel. Oathbound Ice Captain. Contract-Bound Shadow. Each village faces the consequence it uncovered at level 35." },
    { kicker: "GLOBAL DEFENSE ORDER", title: "Every shinobi is called", body: "The event is open to everyone at the same time. Your opponent scales to your level, and every server-verified victory restores your village outskirts." },
];

export function WorldCrisisNewsEntry({ announcement, setScreen }: { announcement: AnnouncementView; setScreen: (screen: Screen) => void }) {
    return <WorldCrisisNewsReport announcement={announcement} setScreen={setScreen} frames={FRAMES} cardKicker="BREAKING WORLD REPORT · CLICK TO WATCH" ariaLabel="The Fourfold Breach world news report" reporterHeading="WORLD HERALD // EMERGENCY TRANSMISSION" playerPrefix="FIRST SIGNAL" reporterFallback="FIRST SIGNAL CONFIRMED" finalLabel="Defend your outskirts" />;
}
