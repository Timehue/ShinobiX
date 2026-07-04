/*
 * Clan upgrade building icon — the generated isometric art for each clan building,
 * shown on the Clan Hall "Upgrades" tab. Keyed by ClanUpgradeKey; emoji fallback.
 */
import type { ClanUpgradeKey } from "../types/clan";
import trainingGrounds from "../assets/clan-upgrades/clan-upg-trainingGrounds.webp";
import petDen from "../assets/clan-upgrades/clan-upg-petDen.webp";
import medicalWing from "../assets/clan-upgrades/clan-upg-medicalWing.webp";
import blacksmith from "../assets/clan-upgrades/clan-upg-blacksmith.webp";
import treasury from "../assets/clan-upgrades/clan-upg-treasury.webp";
import warRoom from "../assets/clan-upgrades/clan-upg-warRoom.webp";
import scoutNetwork from "../assets/clan-upgrades/clan-upg-scoutNetwork.webp";

const ART: Record<ClanUpgradeKey, string> = {
    trainingGrounds, petDen, medicalWing, blacksmith, treasury, warRoom, scoutNetwork,
};

export function ClanUpgradeIcon({ upgradeKey, icon }: { upgradeKey: ClanUpgradeKey; icon: string }) {
    const src = ART[upgradeKey];
    if (!src) return <span className="town-upgrade-icon">{icon}</span>;
    return <span className="town-upgrade-icon clan-upgrade-emblem"><img src={src} alt="" /></span>;
}
