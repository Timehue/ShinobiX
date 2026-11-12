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
            if (file.endsWith('/shared/wanderer-roster.ts')) return { code: packStaticCatalogLiteral(source, 'WANDERER_ARCHETYPES'), map: null };
            if (file.endsWith('/shared/pet-ability-progression.ts')) return { code: packStaticCatalogLiteral(source, 'SPECIES_ABILITIES'), map: null };
            if (file.endsWith('/shared/pet-tactics-catalog.ts')) return { code: packStaticCatalogLiteral(source, 'PET_TACTICS_IDENTITIES'), map: null };
            if (file.endsWith('/shared/chronicle-painted-art.ts')) return { code: packStaticCatalogLiteral(packStaticCatalogLiteral(source, 'CHRONICLE_PAINTED_ART'), 'CHRONICLE_PAINTED_FIGURES'), map: null };
            // Keep the expansion's repeated stat fields out of the runtime budget.
            if (file.endsWith('/shared/chronicle-expansion-monsters.ts')) return { code: packStaticCatalogLiteral(source, 'CHRONICLE_COMMON_EXPANSION'), map: null };
            if (file.endsWith('/shared/tile-cards.ts')) return { code: packStaticCatalogLiteral(source, 'shinobiTileCards'), map: null };
            if (file.endsWith('/shared/chronicle-duel.ts')) return { code: packStaticCatalogLiteral(source, 'REVIEWED_MONSTER_EFFECTS'), map: null };
            if (file.endsWith('/src/data/story-reckonings.ts')) return { code: packStaticCatalogLiteral(source, 'storyReckonings'), map: null };
            if (file.endsWith('/shared/story-card-sources.ts')) return { code: packStaticCatalogLiteral(source, 'CHRONICLE_STORY_SOURCES'), map: null };
            if (file.endsWith('/shared/clan-exchange-catalog.ts')) return { code: packStaticCatalogLiteral(source, 'CLAN_EXCHANGE_ITEMS'), map: null };
            // Plain eager technique prose gzips better than the binary payload.
            // Compact these on-demand catalogs instead to fund its raw bytes.
            if (file.endsWith('/src/lib/pet-tutorial.ts')) return { code: packStaticCatalogLiteral(source, 'PET_TUTORIAL_LESSONS'), map: null };
            if (file.endsWith('/src/lib/legacy-rumors.ts')) return { code: packStaticCatalogLiteral(source, 'RUMORS'), map: null };
            if (file.endsWith('/src/lib/pet-portrait-assets.generated.ts')) return { code: packStaticCatalogLiteral(source, 'PET_SCENIC_PORTRAITS'), map: null };
            if (file.endsWith('/src/data/legacy-jutsu.ts')) return { code: packStaticCatalogLiteral(source, 'ROWS'), map: null };
        },
    };
}
