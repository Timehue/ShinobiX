import type { Screen } from "../types/core";
import type { AnnouncementView } from "../lib/legacy";
import reckoningOutskirtsArt from "../assets/world-crisis-80/reckoning-outskirts.webp";
import { WorldCrisisNewsReport, type WorldCrisisNewsFrame } from "./WorldCrisisNewsReport";
import "./WorldCrisis80NewsEntry.css";

const FRAMES: readonly WorldCrisisNewsFrame[] = [
    { kicker: "THE FIRST ALARM", title: "Four filed reports agree", body: "A new level-80 field record triggered the alarm. Village keepers then opened the regional reports Kite Harrow had already filed and matched the quartered claim across all four." },
    { kicker: "SUNKEN COURT INFRASTRUCTURE", title: "The contracts describe machinery", body: "Harrow's payment diagrams identify the Gate as Court-built civic machinery that measures choices. People still serving its claims moved before the villages could publish the reports." },
    { kicker: "COLLECTION ORDER · ALL OUTSKIRTS", title: "Three agents converged on every ledger", body: "Each Collection Cell fields a vanguard, hunter, and assessor. At the same time, pursuit packs entered the lower routes used by companion handlers." },
    { kicker: "TWO FRONTS · ONE DEFENSE", title: "Every player can answer", body: "Break a three-person cell as a shinobi or field three companions against a pursuit pack. Either server-verified victory advances your village's witness ledger." },
];

export function WorldCrisis80NewsEntry({ announcement, setScreen }: { announcement: AnnouncementView; setScreen: (screen: Screen) => void }) {
    return <WorldCrisisNewsReport announcement={announcement} setScreen={setScreen} frames={FRAMES} variant="reckoning" heroArt={reckoningOutskirtsArt} cardKicker="MYTHIC WORLD REPORT · CLICK TO WATCH" ariaLabel="The Hollow Gate Reckoning world news report" reporterHeading="WORLD HERALD // WITNESS TRANSMISSION" playerPrefix="FIRST ALARM" reporterFallback="THE FOUR REPORTS AGREE" finalLabel="Choose a defense front" />;
}
