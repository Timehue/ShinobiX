/*
 * Clan hall tier art — the generated illustration for a clan's current hall tier
 * (Camp → Dojo → Compound → Fortress → Citadel), shown on the Clan Hall "Hall"
 * tab. Keyed by the tier name from clanHallTier(); falls back to the emoji.
 */
import camp from "../assets/clan-hall/clan-hall-camp.webp";
import dojo from "../assets/clan-hall/clan-hall-dojo.webp";
import compound from "../assets/clan-hall/clan-hall-compound.webp";
import fortress from "../assets/clan-hall/clan-hall-fortress.webp";
import citadel from "../assets/clan-hall/clan-hall-citadel.webp";

const ART_BY_NAME: Record<string, string> = {
    "Empty Clan Camp": camp,
    "Fortified Dojo": dojo,
    "Hidden Clan Compound": compound,
    "War Fortress": fortress,
    "Legendary Clan Citadel": citadel,
};

export function ClanHallTierArt({ name, icon }: { name: string; icon: string }) {
    const src = ART_BY_NAME[name];
    if (!src) return <span className="clan-hall-tier-icon">{icon}</span>;
    return <img src={src} alt={name} className="clan-hall-tier-art" />;
}
