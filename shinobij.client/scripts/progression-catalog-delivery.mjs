import { packStaticCatalogLiteral } from './pack-static-catalog.mjs';

/** Keep identical synchronous data in app and worker builds without duplicating
 * the full literal payload. The authoritative source registry stays readable. */
export function progressionCatalogDelivery() {
    return {
        name: 'progression-catalog-delivery',
        apply: 'build',
        enforce: 'pre',
        transform(source, id) {
            const file = id.split('?')[0].replace(/\\/g, '/');
            if (file.endsWith('/shared/pet-ability-progression.ts')) return { code: packStaticCatalogLiteral(source, 'SPECIES_ABILITIES'), map: null };
            if (file.endsWith('/shared/pet-tactics-catalog.ts')) return { code: packStaticCatalogLiteral(source, 'PET_TACTICS_IDENTITIES'), map: null };
            if (file.endsWith('/shared/chronicle-painted-art.ts')) return { code: packStaticCatalogLiteral(packStaticCatalogLiteral(source, 'CHRONICLE_PAINTED_ART'), 'CHRONICLE_PAINTED_FIGURES'), map: null };
            if (file.endsWith('/shared/tile-cards.ts')) return { code: packStaticCatalogLiteral(source, 'shinobiTileCards'), map: null };
            if (file.endsWith('/shared/chronicle-duel.ts')) return { code: packStaticCatalogLiteral(source, 'REVIEWED_MONSTER_EFFECTS'), map: null };
            if (file.endsWith('/src/data/story-reckonings.ts')) return { code: packStaticCatalogLiteral(source, 'storyReckonings'), map: null };
            if (file.endsWith('/shared/story-card-sources.ts')) return { code: packStaticCatalogLiteral(source, 'CHRONICLE_STORY_SOURCES'), map: null };
            if (file.endsWith('/shared/clan-exchange-catalog.ts')) return { code: packStaticCatalogLiteral(source, 'CLAN_EXCHANGE_ITEMS'), map: null };
            if (file.endsWith('/src/data/jutsu.ts')) return { code: packStaticCatalogLiteral(source, 'nonBloodlineFlavor'), map: null };
            if (file.endsWith('/src/data/legacy-jutsu.ts')) return { code: packStaticCatalogLiteral(source, 'ROWS'), map: null };
        },
    };
}
