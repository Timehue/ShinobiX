import { clanMissionDefinitions } from "../constants/clan";

type ClanMissionKey = (typeof clanMissionDefinitions)[number]["key"];

const ART: Record<ClanMissionKey, string> = {
    battle: "/ui/clan-missions/clan-mission-battle.webp",
    mission: "/ui/clan-missions/clan-mission-mission.webp",
    guard: "/ui/clan-missions/clan-mission-guard.webp",
    territory: "/ui/clan-missions/clan-mission-territory.webp",
    anbu: "/ui/clan-missions/clan-mission-anbu.webp",
    donation: "/ui/clan-missions/clan-mission-donation.webp",
    training: "/ui/clan-missions/clan-mission-training.webp",
    raid: "/ui/clan-missions/clan-mission-raid.webp",
};

export function ClanMissionIcon({ missionKey }: { missionKey: ClanMissionKey }) {
    return (
        <img
            className="clan-mission-art"
            src={ART[missionKey]}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
        />
    );
}
