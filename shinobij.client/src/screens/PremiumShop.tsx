/*
 * Premium Shop — the real-money storefront, and nothing else.
 *
 * ⛔ KEEP THIS SEPARATE FROM THE VILLAGE SHOP. The village "shop" screen trades
 * in ryo, earned in play; this one takes actual money. They were briefly merged
 * and that was wrong: a player browsing consumables should never meet a payment
 * prompt in the same list, and mixing them makes it ambiguous whether a price is
 * earned currency or cash. Owner ruling, 2026-09-01.
 *
 * Everything sold here is also earnable in game — the line this project holds —
 * and the copy says so where a buyer can actually see it.
 */
import type { Character, VersionedCharacterCommit } from "../types/character";
import { CentralDestinationHeader } from "../components/CentralDestinationHeader";
import { GameIcon } from "../components/icons/GameIcon";
import { PremiumOffers } from "../components/PremiumOffers";

export function PremiumShop({ character, onBack, onVersionedCharacter }: {
    character: Character;
    onBack: () => void;
    onVersionedCharacter: VersionedCharacterCommit;
}) {
    return (
        <div className="card shop-screen grand-marketplace-screen">
            <CentralDestinationHeader
                backLabel="Back"
                eyebrow="Shinobi Journey · Supporter Hall"
                icon={<GameIcon name="crystal" size={30} />}
                onBack={onBack}
                statusLabel="Fate Shards"
                statusValue={(character.fateShards ?? 0).toLocaleString()}
                subtitle="Fate Shards and supporter benefits. Everything here can also be earned in game."
                title="Premium Shop"
                tone="violet"
            />
            <PremiumOffers character={character} onVersionedCharacter={onVersionedCharacter} />
        </div>
    );
}
