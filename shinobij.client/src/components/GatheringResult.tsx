import { DAILY_RESOURCE_ATTEMPT_LIMIT, RESOURCE_ACTIVITY_INFO, RESOURCE_ITEMS, RESOURCE_GRADES, RESOURCE_SKILL_XP, readResourceGathering, resourceSkillLevel, type ResourceReceipt } from '../../../shared/resource-gathering';
import { gatheringToolRemaining } from '../../../shared/gathering-tools';
import { GATHER_NAMES } from '../../../shared/gathering-materials';
import type { ResourceNode } from '../../../shared/resource-nodes';
import type { Character } from '../types/character';
import { gatheringToolArtwork } from '../lib/gathering-tool-art';

const EMPTY_TOOL = { mining: 'tool-basic-pickaxe', fishing: 'tool-basic-fishing-pole', harvesting: 'tool-basic-harvest-kama' } as const;
const AGAIN = { mining: 'Mine again', fishing: 'Fish again', harvesting: 'Reap again' } as const;

export function GatheringResult({ character, receipt, node, requiredSkill = 1, charges, today, busy, onBack, onAgain }: {
    character: Character; receipt: ResourceReceipt; node: ResourceNode | null | undefined; requiredSkill?: number;
    charges: number; today: number; busy: boolean; onBack: () => void; onAgain: () => void;
}) {
    const mining = receipt.activity === 'mining', harvesting = receipt.activity === 'harvesting';
    const info = RESOURCE_ACTIVITY_INFO[receipt.activity] ?? RESOURCE_ACTIVITY_INFO.fishing, activity = info.skill;
    const graded = RESOURCE_ITEMS.find(candidate => candidate.id === receipt.itemId);
    // Harvest ids are plain and ungraded, so they are not in RESOURCE_ITEMS.
    const item = graded ? { name: graded.name, art: graded.activity === 'fishing' ? '/items/gather-river-fish.svg' : `/items/${graded.family}-v1.webp`, grade: graded.grade }
        : harvesting && receipt.itemId ? { name: GATHER_NAMES[receipt.itemId] ?? 'Meadow harvest', art: `/items/${receipt.itemId}-v1.webp`, grade: undefined } : undefined;
    const gradedTrace = RESOURCE_ITEMS.find(candidate => candidate.id === receipt.traceId);
    const trace = gradedTrace ? { name: gradedTrace.name, art: `/items/${gradedTrace.family}-v1.webp` }
        : receipt.traceId ? { name: GATHER_NAMES[receipt.traceId] ?? 'rare find', art: `/items/${receipt.traceId}-v1.webp` } : undefined;
    const state = readResourceGathering(character.resourceGathering), xp = state[`${receipt.activity}Xp`] ?? 0;
    const level = resourceSkillLevel(xp), beforeLevel = resourceSkillLevel(Math.max(0, xp - receipt.xp));
    const floor = RESOURCE_SKILL_XP[level - 1], next = RESOURCE_SKILL_XP[level];
    const toolId = character.equipment?.[info.slot];
    const usableTool = Boolean(toolId && gatheringToolRemaining(character, toolId) !== 0);
    const skilled = level >= requiredSkill;
    const repeat = Boolean(node && charges > 0 && today < DAILY_RESOURCE_ATTEMPT_LIMIT && usableTool && skilled);
    const caught = receipt.fishingCatch, cuts = receipt.harvestCuts;
    const title = item?.name ?? (caught?.tooStrong ? 'Outmatched by the fish.' : receipt.outcome === 'failed'
        ? mining ? 'The seam gave way.' : harvesting ? 'The harvest was spoiled.' : 'This one got away.'
        : receipt.outcome === 'expired' ? 'Time to move on.' : 'Tools down.');
    const detail = caught?.tooStrong ? `${caught.name} requires Fishing Lv.${caught.requiredLevel}. You were Lv.${caught.fisherLevel}; it broke free.` : receipt.outcome === 'failed' ? mining
        ? receipt.miningFailure === 'extraction' ? 'The fracture held, but no usable ore could be extracted. Mining skill still determines extraction success.'
            : receipt.miningFailure === 'fracture' ? 'Crossing fractures crushed the core. Keep each pocket on a single fracture path.' : 'No usable ore survived the break.'
        : harvesting ? cuts && cuts.tear >= 2 ? 'Cutting below the band tore the roots. Wait for the calm and cut at the gold line.'
            : cuts && cuts.clean + cuts.rough + cuts.wasted === 0 ? 'The kama never found a stalk.' : 'The cut stalks were too poor to keep. Cleaner cuts raise your success.'
        : 'Your kunai came back empty.'
        : receipt.outcome === 'expired' ? 'The attempt expired before you finished.' : 'You left the node before finishing.';
    const count = receipt.count ?? 1;
    return <section className={`gather-report gather-report--${receipt.activity} gather-report--${receipt.outcome}`} aria-label={`${activity} result`}>
        <div className="gather-report-find" role="status">
            <div className="gather-report-art" aria-hidden="true">
                {item ? <><img src={item.art} alt="" /><span>×{count}</span></>
                    : <img className="gather-report-empty" src={gatheringToolArtwork(EMPTY_TOOL[receipt.activity] ?? EMPTY_TOOL.fishing)} alt="" />}
            </div>
            <div className="gather-report-description">
                <p className="gather-report-label">{item ? mining ? 'Material recovered' : harvesting ? 'Harvest gathered' : 'Catch landed' : 'Field notes'}</p>
                <h3>{title}</h3>
                {item ? <>{item.grade !== undefined && <span className={`gather-report-grade gather-report-grade--${item.grade}`}>{RESOURCE_GRADES[item.grade]} quality</span>}
                    {harvesting && count > 1 && <span className="gather-report-grade gather-report-grade--2">Perfect row · double harvest</span>}
                    <p className="gather-report-stowed">Added to your inventory</p></>
                    : <p className="gather-report-stowed">{detail}</p>}
                {item && caught && <p className="gather-report-stowed">{caught.name} · Fishing Lv.{caught.requiredLevel}</p>}
                {cuts && <p className="gather-report-stowed">{cuts.clean} clean · {cuts.rough} rough{cuts.wasted ? ` · ${cuts.wasted} wasted` : ''}{cuts.tear ? ` · ${cuts.tear} torn` : ''}</p>}
            </div>
        </div>
        {trace && <div className="gather-report-trace"><img src={trace.art} alt="" /><span>{harvesting ? 'Rare meadow find' : 'Rare seam find'} <strong>+1 {trace.name}</strong></span></div>}
        <div className="gather-report-skill">
            <div className="gather-report-skill-heading"><span>{activity} <strong>Lv. {level}</strong></span><strong>{receipt.xp > 0 ? `+${receipt.xp} XP` : '+0 XP'}</strong></div>
            <progress aria-label={`${activity} skill progress`} value={next ? xp - floor : 1} max={next ? next - floor : 1} />
            <div className="gather-report-skill-note"><span>{beforeLevel < level ? `Level up · ${activity} ${level}` : receipt.xp === 0 ? 'Unfinished attempts grant no XP' : 'Skill experience gained'}</span><span>{next ? `${xp - floor} / ${next - floor} XP` : 'Max level'}</span></div>
        </div>
        {receipt.toolBroke && <p className="gather-report-tool" role="status">Your basic tool broke after its last use. Equip a replacement in Inventory.</p>}
        <div className="gather-report-supplies">
            <span><span className="gather-report-pips" aria-hidden="true">{[0, 1, 2].map(i => <i key={i} className={i < charges ? 'available' : ''} />)}</span><strong>{charges}/3</strong> attempts left</span>
            <span><strong>{Math.max(0, DAILY_RESOURCE_ATTEMPT_LIMIT - today)}</strong> {activity.toLowerCase()} attempts left today</span>
        </div>
        {!repeat && <p className="gather-report-return-note">{!usableTool ? 'Equip a tool to gather here again.' : charges === 0 ? 'This node replenishes in 10 minutes.' : !skilled ? `This node now requires skill ${requiredSkill}.` : 'Your daily gathering attempts reset at 00:00 UTC.'}</p>}
        <div className="gather-report-actions"><button type="button" className="gather-report-back" onClick={onBack}>Back to map</button>
            {repeat && <button type="button" className="gather-report-again" disabled={busy} onClick={onAgain}>{busy ? 'Starting…' : AGAIN[receipt.activity] ?? AGAIN.fishing}<span aria-hidden="true"> ↻</span></button>}
        </div>
    </section>;
}
