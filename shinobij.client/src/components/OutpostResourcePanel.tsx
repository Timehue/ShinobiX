import { RESOURCE_NODES } from '../../../shared/resource-nodes';
import { RESOURCE_FAMILIES } from '../../../shared/resource-items';
import { readResourceGathering, resourceSkillLevel, RESOURCE_SKILL_XP, resourceSuccessRate, resourceQualityWeights, RESOURCE_GRADES, type ResourceActivity } from '../../../shared/resource-gathering';
import { sectorName } from '../../../shared/sector-geo';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { CentralDestinationHeader } from './CentralDestinationHeader';
import { GatheringEquipment } from './GatheringEquipment';
import { ResourceRefinery } from './ResourceRefinery';
import { gatheringToolArtwork } from '../lib/gathering-tool-art';
import './outpost-resource-panel.css';

const GRADE_LEVELS = [1, 2, 4, 7];
const SITE_TIERS = [{ skill: 1, name: 'Basic' }, { skill: 4, name: 'Rich' }, { skill: 7, name: 'Master' }] as const;

export function OutpostResourcePanel({ activity, character, commit, onBack, onMap, onWorkshop }: {
    activity: ResourceActivity; character: Character; commit: VersionedCharacterCommit;
    onBack: () => void; onMap: () => void; onWorkshop: () => void;
}) {
    const mining = activity === 'mining', label = mining ? 'Mining' : 'Fishing';
    const state = readResourceGathering(character.resourceGathering), xp = state[`${activity}Xp`];
    const level = resourceSkillLevel(xp), floor = RESOURCE_SKILL_XP[level - 1], next = RESOURCE_SKILL_XP[level];
    const weights = resourceQualityWeights(level, 3), nodes = RESOURCE_NODES.filter(node => node.activity === activity);
    const toolArt = gatheringToolArtwork(mining ? 'tool-basic-pickaxe' : 'tool-basic-fishing-pole');
    const materialArt = mining ? '/items/gather-iron-sand-v1.webp' : '/items/gather-river-fish.svg';
    return <div className={`outpost-resource-panel field-station field-station--${activity}`}>
        <CentralDestinationHeader
            art={`/scenes/story/cinematic/storywide/${mining ? 'frostfang-old-quarry-camp-v1' : 'moonshadow-canal-shrine-door-v1'}.webp`}
            eyebrow={`The Thousand Gates · ${mining ? 'Mineral reconnaissance' : 'Waterside reconnaissance'}`}
            title={`${label} · Level ${level}`} icon={<img src={toolArt} alt="" />} onBack={onBack}
            subtitle={mining ? 'Read the fractures. Uncover the ore. Forge what comes next.' : 'Find stillness in the current. Bring the river’s bounty home.'}
            statusLabel={mining ? 'Basic site success' : 'Animation success'} statusValue={`${resourceSuccessRate(level, 1)}%`} tone={mining ? 'gold' : 'azure'} />

        <section className="outpost-field-brief" aria-label={`${label} field skill`}>
            <div className="outpost-field-method"><p className="resource-kicker">Independent field skill</p>
                <h3>{mining ? 'Veinbreaking · Read the seam' : 'Read the water'}</h3>
                <p>{mining ? 'Read the rock, place chakra seals, and release a controlled fracture. Reach each mineral pocket once; crossing fractures crush the ore.' : 'Lead a swimming fish and release your tethered kunai. Three throws per attempt; misses scatter the shoal. Read each fish’s Fishing level: locked fish break free and end the attempt.'}</p>
            </div>
            <div className="outpost-skill-progress"><div><span>Skill progression</span><strong>{next ? `${xp} / ${next} XP` : 'Mastered'}</strong></div>
                <progress aria-label={`${label} skill progress`} max={next ? next - floor : 1} value={next ? xp - floor : 1} />
                <p>{next ? `Level ${level + 1} at ${next} total XP` : 'Maximum field skill reached'}<span>Success +10 XP · Completed failure +3 XP</span></p>
            </div>
        </section>

        <section className="outpost-quality-section" aria-label="Catch and material quality">
            <div className="resource-section-heading"><h3>{mining ? 'Ore appraisal' : 'Catch appraisal'}</h3><span>Quality chances at a master site</span></div>
            <div className="outpost-quality" aria-label="Skill quality chances at a master site">{RESOURCE_GRADES.map((grade, index) => {
                const unlocked = level >= GRADE_LEVELS[index];
                return <div key={grade} className={`outpost-grade outpost-grade--${index}${unlocked ? '' : ' is-locked'}`}>
                    <img src={materialArt} alt="" /><div><span>{grade}</span><strong>{weights[index].toFixed(1)}%</strong>
                        <small>{unlocked ? 'Available now' : `Unlocks at skill ${GRADE_LEVELS[index]}`}</small></div>
                </div>;
            })}</div>
            <p className="resource-note">Site limits: Basic → Fine · Rich → Superior · Master → Pristine. Better grades also require the matching skill level.</p>
        </section>

        <GatheringEquipment character={character} commit={commit} />

        <section className="outpost-survey" aria-label={mining ? 'Mineral seam directory' : 'Fishing water directory'}>
            <div className="resource-section-heading"><div><p className="resource-kicker">Field atlas · {nodes.length} known sites</p>
                <h3>{mining ? 'Known mineral seams' : 'Known fishing waters'}</h3></div><button className="outpost-map-action" type="button" onClick={onMap}>Open world map <span aria-hidden="true">↗</span></button></div>
            <p className="resource-note">Travel to a site on the world map to {mining ? 'work the seam' : 'throw your kunai'}. Expand a tier to scout its locations.</p>
            {SITE_TIERS.map(tier => <details className="outpost-site-tier" key={tier.skill} open={tier.skill === 1}>
                <summary><span className="outpost-tier-mark" aria-hidden="true">{tier.skill === 1 ? 'I' : tier.skill === 4 ? 'II' : 'III'}</span>
                    <strong>{tier.name} {mining ? 'seams' : 'waters'}</strong><span>Skill {tier.skill}{level < tier.skill ? ' · Locked' : ' · Available'}</span></summary>
                <div className="outpost-node-directory">{nodes.filter(node => node.difficulty === tier.skill).map(node => <article key={node.id} className={level < node.difficulty ? 'is-locked' : ''}>
                    <div className="outpost-site-art"><img loading="lazy" src={node.activity === 'fishing' ? materialArt : `/items/${node.trace ?? node.family}-v1.webp`} alt="" /></div>
                    <div className="outpost-site-copy"><h4>{node.name}</h4><span>Sector {node.sector} · {sectorName(node.sector)}</span>
                        <small>Up to {RESOURCE_GRADES[node.ceiling]} {mining ? 'minerals' : 'fish'}</small>
                        {node.trace && <small>Rare find · {RESOURCE_FAMILIES[node.trace].name}</small>}
                        <span className="outpost-site-status">{level < node.difficulty ? `Unlocks at skill ${node.difficulty}` : `${resourceSuccessRate(level, node.difficulty)}% baseline success`}</span>
                    </div>
                </article>)}</div>
            </details>)}
        </section>

        {mining && <ResourceRefinery character={character} commit={commit} />}
        <footer className="outpost-consumers"><img src={mining ? '/items/gather-ember-ore-v1.webp' : materialArt} alt="" />
            <div><p className="resource-kicker">{mining ? 'From seam to steel' : 'From river to ration'}</p><h3>{mining ? 'Supply the forge' : 'Provision your next journey'}</h3>
                <p>{mining ? 'Use Fine ore for rare gear, Superior ore for epic weapons, and Pristine ore for legendary weapons. Regional crystals and ores supply specialized recipes.' : 'Cook five same-grade fish with one Field Herb, one Heartwood Bark for fuel, and 30 Ryo. Higher grades produce 5, 10, 15 or 20 Ration Packs, within the existing 40-ration daily cooking allowance.'}</p>
                <button type="button" onClick={onWorkshop}>{mining ? 'Visit the Crafter in Central' : 'Visit the Cafeteria'} <span aria-hidden="true">→</span></button>
            </div>
        </footer>
    </div>;
}
