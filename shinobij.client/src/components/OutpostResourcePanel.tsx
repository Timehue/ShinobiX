import { HARVEST_BLOOM_MS, HARVEST_NODES, RESOURCE_NODES, resourceNodeOffer } from '../../../shared/resource-nodes';
import { GATHER_NAMES } from '../../../shared/gathering-materials';
import { COOK_RECIPES } from '../../../shared/cooking-recipes';
import { FISH_RECIPES } from '../../../shared/fish-recipes';
import { HARVEST_TRACE_CHANCE } from '../../../shared/harvesting';
import { RESOURCE_SUCCESS_XP, RESOURCE_FAILURE_XP, readResourceGathering, resourceSkillLevel, RESOURCE_SKILL_XP, resourceSuccessRate, resourceQualityWeights, RESOURCE_GRADES, type ResourceActivity } from '../../../shared/resource-gathering';
import { sectorName } from '../../../shared/sector-geo';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { CentralDestinationHeader } from './CentralDestinationHeader';
import { GatheringEquipment } from './GatheringEquipment';
import { ResourceRefinery } from './ResourceRefinery';
import { gatheringToolArtwork } from '../lib/gathering-tool-art';
import { serverClockOffsetMs } from '../lib/server-clock';
import { useSharedNow } from '../lib/use-shared-now';
import './outpost-resource-panel.css';

// The footer quotes the live recipe, so a cost change can never leave it stale.
const fishRecipe = COOK_RECIPES.find(recipe => recipe.id === 'fish-rations-common')!;
const GRADE_LEVELS = [1, 2, 4, 7];
const SITE_TIERS = [{ skill: 1, name: 'Basic' }, { skill: 4, name: 'Rich' }, { skill: 7, name: 'Master' }] as const;
const percent = (chance: number) => `${Math.round(chance * 100)}%`;
const traceOdds = `${percent(HARVEST_TRACE_CHANCE[4])} / ${percent(HARVEST_TRACE_CHANCE[7])}`;
const FISH_ART = '/items/gather-river-fish.svg';

/** Per-activity words and art. Harvest goods are ungraded, so that tab shows the
 * payout and the live blooms where the other two show quality chances. */
const PANEL = {
    mining: {
        label: 'Mining', art: '/scenes/story/cinematic/storywide/frostfang-old-quarry-camp-v1.webp', eyebrow: 'Mineral reconnaissance', tool: 'tool-basic-pickaxe',
        subtitle: 'Read the fractures. Uncover the ore. Forge what comes next.', status: 'Basic site success', tone: 'gold',
        method: 'Veinbreaking · Read the seam', brief: 'Read the rock, place chakra seals, and release a controlled fracture. Reach each mineral pocket once; crossing fractures crush the ore.',
        appraisal: 'Ore appraisal', sites: 'Known mineral seams', tier: 'seams', directory: 'Mineral seam directory', travel: 'work the seam', yield: 'minerals',
        footArt: '/items/gather-ember-ore-v1.webp', footKicker: 'From seam to steel', footTitle: 'Supply the forge', footButton: 'Visit the Crafter in Central',
    },
    fishing: {
        label: 'Fishing', art: '/scenes/story/cinematic/storywide/moonshadow-canal-shrine-door-v1.webp', eyebrow: 'Waterside reconnaissance', tool: 'tool-basic-fishing-pole',
        subtitle: 'Find stillness in the current. Bring the river’s bounty home.', status: 'Animation success', tone: 'azure',
        method: 'Read the water', brief: 'Lead a swimming fish and release your tethered kunai. Three throws per attempt; misses scatter the shoal. Read each fish’s Fishing level: locked fish break free and end the attempt.',
        appraisal: 'Catch appraisal', sites: 'Known fishing waters', tier: 'waters', directory: 'Fishing water directory', travel: 'throw your kunai', yield: 'fish',
        footArt: FISH_ART, footKicker: 'From river to ration', footTitle: 'Provision your next journey', footButton: 'Visit the Cafeteria',
    },
    harvesting: {
        label: 'Harvesting', art: '/assets/harvesting/kama-meadow.webp', eyebrow: 'Wild meadows', tool: 'tool-basic-harvest-kama',
        subtitle: 'Read the wind. Cut at the band. Leave the roots to grow again.', status: 'Basic site success', tone: 'gold',
        method: 'Kama reaping · Read the wind', brief: 'Five stalks sway in the meadow wind. You have three kama strokes: cut each stalk at its gold band in the calm between gusts. One stroke can take several stalks. Cut too low and you tear the roots.',
        appraisal: 'Harvest appraisal', sites: 'Wild meadows', tier: 'meadows', directory: 'Wild meadow directory', travel: '', yield: '',
        footArt: '/items/gather-heartwood-bark-v1.webp', footKicker: 'From meadow to workshop', footTitle: 'Supply the village', footButton: 'Visit the Crafter in Central',
    },
} as const;
const HARVEST_APPRAISAL = [
    ['gather-field-herb', 'Field Herb or Binding Fiber', '×1', 'Every successful harvest'],
    ['gather-binding-fiber', 'Perfect row', '×2', 'All five stalks cut clean'],
    ['gather-heartwood-bark', 'Heartwood Bark', traceOdds, 'Rich / Master forest meadows'],
    ['gather-shadow-thread', 'Shadow Thread', traceOdds, 'Rich / Master shadow meadows'],
] as const;

export function OutpostResourcePanel({ activity, character, commit, onBack, onMap, onWorkshop }: {
    activity: ResourceActivity; character: Character; commit: VersionedCharacterCommit;
    onBack: () => void; onMap: () => void; onWorkshop: () => void;
}) {
    const copy = PANEL[activity], mining = activity === 'mining', harvesting = activity === 'harvesting';
    const state = readResourceGathering(character.resourceGathering), xp = state[`${activity}Xp`];
    const level = resourceSkillLevel(xp), floor = RESOURCE_SKILL_XP[level - 1], next = RESOURCE_SKILL_XP[level];
    const now = useSharedNow() + serverClockOffsetMs();
    const weights = resourceQualityWeights(level, 3);
    const all = (harvesting ? HARVEST_NODES : RESOURCE_NODES.filter(node => node.activity === activity)).map(node => resourceNodeOffer(node, now));
    const nodes = all.filter(node => !node.dormant);
    const nextBloom = Math.max(1, Math.ceil((HARVEST_BLOOM_MS - now % HARVEST_BLOOM_MS) / 60_000));
    const materialArt = mining ? '/items/gather-iron-sand-v1.webp' : FISH_ART;
    const quality = harvesting
        ? HARVEST_APPRAISAL.map(([art, name, value, note]) => ({ art: `/items/${art}-v1.webp`, name, value, note, locked: false }))
        : RESOURCE_GRADES.map((name, index) => ({ art: materialArt, name, value: `${weights[index].toFixed(1)}%`,
            note: level >= GRADE_LEVELS[index] ? 'Available now' : `Unlocks at skill ${GRADE_LEVELS[index]}`, locked: level < GRADE_LEVELS[index] }));
    return <div className={`outpost-resource-panel field-station field-station--${activity}`}>
        <CentralDestinationHeader art={copy.art} eyebrow={`The Thousand Gates · ${copy.eyebrow}`}
            title={`${copy.label} · Level ${level}`} icon={<img src={gatheringToolArtwork(copy.tool)} alt="" />} onBack={onBack}
            subtitle={copy.subtitle} statusLabel={copy.status} statusValue={`${resourceSuccessRate(level, 1)}%`} tone={copy.tone} />

        <section className="outpost-field-brief" aria-label={`${copy.label} field skill`}>
            <div className="outpost-field-method"><p className="resource-kicker">Independent field skill</p>
                <h3>{copy.method}</h3><p>{copy.brief}</p>
            </div>
            <div className="outpost-skill-progress"><div><span>Skill progression</span><strong>{next ? `${xp} / ${next} XP` : 'Mastered'}</strong></div>
                <progress aria-label={`${copy.label} skill progress`} max={next ? next - floor : 1} value={next ? xp - floor : 1} />
                <p>{next ? `Level ${level + 1} at ${next} total XP` : 'Maximum field skill reached'}<span>Success +{RESOURCE_SUCCESS_XP} XP · Completed failure +{RESOURCE_FAILURE_XP} XP</span></p>
            </div>
        </section>

        <section className="outpost-quality-section" aria-label={harvesting ? 'Harvest appraisal' : 'Catch and material quality'}>
            <div className="resource-section-heading"><h3>{copy.appraisal}</h3><span>{harvesting ? 'What a successful harvest pays' : 'Quality chances at a master site'}</span></div>
            <div className="outpost-quality" aria-label={harvesting ? undefined : 'Skill quality chances at a master site'}>{quality.map((row, index) =>
                <div key={row.name} className={`outpost-grade outpost-grade--${index}${row.locked ? ' is-locked' : ''}`}>
                    <img src={row.art} alt="" /><div><span>{row.name}</span><strong>{row.value}</strong><small>{row.note}</small></div>
                </div>)}</div>
            <p className="resource-note">{harvesting ? 'Harvest goods have no quality grades. Skill opens Rich and Master meadows, which are the only ones with rare finds.'
                : 'Site limits: Basic → Fine · Rich → Superior · Master → Pristine. Better grades also require the matching skill level.'}</p>
        </section>

        <GatheringEquipment character={character} commit={commit} />

        <section className="outpost-survey" aria-label={copy.directory}>
            <div className="resource-section-heading"><div><p className="resource-kicker">Field atlas · {harvesting ? `${nodes.length} of ${all.length} meadows growing` : `${nodes.length} known sites`}</p>
                <h3>{copy.sites}</h3></div><button className="outpost-map-action" type="button" onClick={onMap}>Open world map <span aria-hidden="true">↗</span></button></div>
            <p className="resource-note">{harvesting
                ? `Meadows bloom in new places every half hour, and about half are growing at any time. The next bloom is in ${nextBloom} ${nextBloom === 1 ? 'minute' : 'minutes'}. Growing meadows change level every 10 minutes.`
                : `Travel to a site on the world map to ${copy.travel}. Sites change level every 10 minutes, and half of them are Basic at any time. Expand a tier to scout its locations.`}</p>
            {SITE_TIERS.map(tier => <details className="outpost-site-tier" key={tier.skill} open={tier.skill === 1}>
                <summary><span className="outpost-tier-mark" aria-hidden="true">{tier.skill === 1 ? 'I' : tier.skill === 4 ? 'II' : 'III'}</span>
                    <strong>{tier.name} {copy.tier}</strong><span>Skill {tier.skill}{level < tier.skill ? ' · Locked' : ' · Available'}</span></summary>
                <div className="outpost-node-directory">{nodes.filter(node => node.difficulty === tier.skill).map(node => <article key={node.id} className={level < node.difficulty ? 'is-locked' : ''}>
                    <div className="outpost-site-art"><img loading="lazy" src={activity === 'fishing' ? materialArt : `/items/${(mining && node.trace) || node.family}-v1.webp`} alt="" /></div>
                    <div className="outpost-site-copy"><h4>{node.name}</h4><span>Sector {node.sector} · {sectorName(node.sector)}</span>
                        <small>{harvesting ? GATHER_NAMES[node.family] : `Up to ${RESOURCE_GRADES[node.ceiling]} ${copy.yield}`}</small>
                        {node.trace && <small>Rare find · {GATHER_NAMES[node.trace]}</small>}
                        <span className="outpost-site-status">{level < node.difficulty ? `Unlocks at skill ${node.difficulty}` : `${resourceSuccessRate(level, node.difficulty)}% baseline success`}</span>
                    </div>
                </article>)}</div>
            </details>)}
        </section>

        {mining && <ResourceRefinery character={character} commit={commit} />}
        <footer className="outpost-consumers"><img src={copy.footArt} alt="" />
            <div><p className="resource-kicker">{copy.footKicker}</p><h3>{copy.footTitle}</h3>
                <p>{mining ? 'Use Fine ore for rare gear, Superior ore for epic weapons, and Pristine ore for legendary weapons. Regional crystals and ores supply specialized recipes.'
                    : harvesting ? 'Field Herb and Binding Fiber pack village supply bundles and crates, and repair sector buildings. Heartwood Bark fuels the forge and the kitchen, and Shadow Thread goes into pet recipes.'
                    : `Cook ${fishRecipe.materialCount} same-grade fish with ${fishRecipe.herbs} Field Herb${fishRecipe.herbs === 1 ? '' : 's'}, ${fishRecipe.fuel} Heartwood Bark (or Ember fuel), and ${fishRecipe.ryo} Ryo. Higher grades produce ${FISH_RECIPES.map(recipe => recipe.rations).join(', ').replace(/, (\d+)$/, ' or $1')} Ration Packs, within the existing 40-ration daily cooking allowance.`}</p>
                <button type="button" onClick={onWorkshop}>{copy.footButton} <span aria-hidden="true">→</span></button>
            </div>
        </footer>
    </div>;
}
