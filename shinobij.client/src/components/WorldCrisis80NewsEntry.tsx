import type { Screen } from "../types/core";
import type { AnnouncementView } from "../lib/legacy";
import reckoningOutskirtsArt from "../assets/world-crisis-80/reckoning-outskirts.webp";
import { WorldCrisisNewsReport, type WorldCrisisNewsFrame } from "./WorldCrisisNewsReport";
import "./WorldCrisis80NewsEntry.css";

const FRAMES: readonly WorldCrisisNewsFrame[] = [
    { kicker: "THE FIRST WITNESS", title: "Four reports became one record", body: "When the first new shinobi reached level 80, the villages compared the bargains Kite Harrow had traced. Four quartered copies reconciled into one admissible witness record." },
    { kicker: "SUNKEN COURT INFRASTRUCTURE", title: "Hollow Gate is not a creature", body: "The Gate is the Court's civic lattice: machinery built to measure choices and turn instability into repeatable patterns. People still serving its claims moved before the villages could publish the proof." },
    { kicker: "COLLECTION ORDER · ALL OUTSKIRTS", title: "Three agents converged on every ledger", body: "Each Collection Cell fields a vanguard, hunter, and assessor. At the same time, pursuit packs entered the lower routes used by companion handlers." },
    { kicker: "TWO FRONTS · ONE DEFENSE", title: "Every player can answer", body: "Break a three-person cell as a shinobi or field three companions against a pursuit pack. Either server-verified victory advances your village's witness ledger." },
];

export function WorldCrisis80NewsEntry({ announcement, setScreen }: { announcement: AnnouncementView; setScreen: (screen: Screen) => void }) {
    return <WorldCrisisNewsReport announcement={announcement} setScreen={setScreen} frames={FRAMES} variant="reckoning" heroArt={reckoningOutskirtsArt} cardKicker="MYTHIC WORLD REPORT · CLICK TO WATCH" ariaLabel="The Hollow Gate Reckoning world news report" reporterHeading="WORLD HERALD // WITNESS TRANSMISSION" playerPrefix="FIRST WITNESS" reporterFallback="THE FOUR REPORTS AGREE" finalLabel="Choose a defense front" />;
}
