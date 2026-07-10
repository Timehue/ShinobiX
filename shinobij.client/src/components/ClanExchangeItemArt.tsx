/*
 * Clan Exchange item art — the generated illustration for each exchange item,
 * keyed by item id. Mirrors ClanHallTierArt / DoctrineCrest: a bundled webp with
 * the composed-glyph plate (ExchangeProductArt) as fallback for any id without
 * art. Art lives in src/assets/clan-exchange/<id>.webp (transparent HD-2D icons,
 * same style family as the clan-hall / doctrine / upgrade art). KEEP the keys in
 * sync with the exchange item ids in ClanExchange.tsx / api/clan/_exchange.ts.
 */
import smallRyoPouch from "../assets/clan-exchange/smallRyoPouch.webp";
import boneCharmBundle from "../assets/clan-exchange/boneCharmBundle.webp";
import fateShardBundle from "../assets/clan-exchange/fateShardBundle.webp";
import clanBannerFrame from "../assets/clan-exchange/clanBannerFrame.webp";
import largeRyoPouch from "../assets/clan-exchange/largeRyoPouch.webp";
import boneCharmCrate from "../assets/clan-exchange/boneCharmCrate.webp";
import auraStone from "../assets/clan-exchange/auraStone.webp";
import fateShardCrate from "../assets/clan-exchange/fateShardCrate.webp";
import warSupplyGrant from "../assets/clan-exchange/warSupplyGrant.webp";
import territoryControlScroll from "../assets/clan-exchange/territoryControlScroll.webp";
import honorSealBundle from "../assets/clan-exchange/honorSealBundle.webp";
import premiumFateShardCrate from "../assets/clan-exchange/premiumFateShardCrate.webp";
import greaterWarSupplyGrant from "../assets/clan-exchange/greaterWarSupplyGrant.webp";
import weaponCache from "../assets/clan-exchange/weaponCache.webp";
import auraStoneBundle from "../assets/clan-exchange/auraStoneBundle.webp";
import armorCache from "../assets/clan-exchange/armorCache.webp";
import kageCoffer from "../assets/clan-exchange/kageCoffer.webp";

const ART_BY_ID: Record<string, string> = {
    smallRyoPouch,
    boneCharmBundle,
    fateShardBundle,
    clanBannerFrame,
    largeRyoPouch,
    boneCharmCrate,
    auraStone,
    fateShardCrate,
    warSupplyGrant,
    territoryControlScroll,
    honorSealBundle,
    premiumFateShardCrate,
    greaterWarSupplyGrant,
    weaponCache,
    auraStoneBundle,
    armorCache,
    kageCoffer,
};

export function clanExchangeItemArt(id: string): string | undefined {
    return ART_BY_ID[id];
}
