import { RESOURCE_ITEMS, RESOURCE_GRADES, RESOURCE_SKILL_XP, readResourceGathering, resourceSkillLevel, type ResourceReceipt } from '../../../shared/resource-gathering';
import { gatheringToolRemaining } from '../../../shared/gathering-tools';
import type { ResourceNode } from '../../../shared/resource-nodes';
import type { Character } from '../types/character';

export function GatheringResult({ character, receipt, node, charges, today, busy, onBack, onAgain }: {
    character: Character; receipt: ResourceReceipt; node: ResourceNode | null | undefined;
    charges: number; today: number; busy: boolean; onBack: () => void; onAgain: () => void;
}) {
    const mining = receipt.activity === 'mining', activity = mining ? 'Mining' : 'Fishing';
    const item = RESOURCE_ITEMS.find(candidate => candidate.id === receipt.itemId);
    const trace = RESOURCE_ITEMS.find(candidate => candidate.id === receipt.traceId);
    const state = readResourceGathering(character.resourceGathering), xp = state[mining ? 'miningXp' : 'fishingXp'];
    const level = resourceSkillLevel(xp), beforeLevel = resourceSkillLevel(Math.max(0, xp - receipt.xp));
    const floor = RESOURCE_SKILL_XP[level - 1], next = RESOURCE_SKILL_XP[level];
    const toolId = character.equipment?.[mining ? 'pickaxe' : 'fishingPole'];
    const usableTool = Boolean(toolId && gatheringToolRemaining(character, toolId) !== 0);
    const repeat = Boolean(node && charges > 0 && today < 100 && usableTool);
    const title = item?.name ?? (receipt.outcome === 'failed' ? mining ? 'The seam gave way.' : 'This one got away.'
        : receipt.outcome === 'expired' ? 'Time to move on.' : 'Tools down.');
    const detail = receipt.outcome === 'failed' ? mining ? 'No usable ore survived the break.' : 'The line came back empty.'
        : receipt.outcome === 'expired' ? 'The attempt expired before you finished.' : 'You left the node before finishing.';
    return <section className={`gather-report gather-report--${mining ? 'mining' : 'fishing'} gather-report--${receipt.outcome}`} aria-label={`${activity} result`}>
        <div className="gather-report-find" role="status">
            <div className="gather-report-art" aria-hidden="true">
                {item ? <><img src={item.activity === 'fishing' ? '/items/gather-river-fish.svg' : `/items/${item.family}-v1.webp`} alt="" /><span>×1</span></>
                    : <img className="gather-report-empty" src={`/items/tool-basic-${mining ? 'pickaxe' : 'fishing-pole'}.svg`} alt="" />}
            </div>
            <div className="gather-report-description">
                <p className="gather-report-label">{item ? mining ? 'Material recovered' : 'Catch landed' : 'Field notes'}</p>
                <h3>{title}</h3>
                {item ? <><span className={`gather-report-grade gather-report-grade--${item.grade}`}>{RESOURCE_GRADES[item.grade]} quality</span><p className="gather-report-stowed">Added to your inventory</p></>
                    : <p className="gather-report-stowed">{detail}</p>}
            </div>
        </div>
        {trace && <div className="gather-report-trace"><img src={`/items/${trace.family}-v1.webp`} alt="" /><span>Rare seam find <strong>+1 {trace.name}</strong></span></div>}
        <div className="gather-report-skill">
            <div className="gather-report-skill-heading"><span>{activity} <strong>Lv. {level}</strong></span><strong>{receipt.xp > 0 ? `+${receipt.xp} XP` : '+0 XP'}</strong></div>
            <progress aria-label={`${activity} skill progress`} value={next ? xp - floor : 1} max={next ? next - floor : 1} />
            <div className="gather-report-skill-note"><span>{beforeLevel < level ? `Level up · ${activity} ${level}` : receipt.xp === 0 ? 'Unfinished attempts grant no XP' : 'Skill experience gained'}</span><span>{next ? `${xp - floor} / ${next - floor} XP` : 'Max level'}</span></div>
        </div>
        {receipt.toolBroke && <p className="gather-report-tool" role="status">Your basic tool broke after its 50th use. Equip a replacement in Inventory.</p>}
        <div className="gather-report-supplies">
            <span><span className="gather-report-pips" aria-hidden="true">{[0, 1, 2].map(i => <i key={i} className={i < charges ? 'available' : ''} />)}</span><strong>{charges}/3</strong> attempts left</span>
            <span><strong>{Math.max(0, 100 - today)}</strong> actions left today</span>
        </div>
        {!repeat && <p className="gather-report-return-note">{!usableTool ? 'Equip a tool to gather here again.' : charges === 0 ? 'This node replenishes in 10 minutes.' : 'Your shared daily actions reset at 00:00 UTC.'}</p>}
        <div className="gather-report-actions"><button type="button" className="gather-report-back" onClick={onBack}>Back to map</button>
            {repeat && <button type="button" className="gather-report-again" disabled={busy} onClick={onAgain}>{busy ? 'Starting…' : mining ? 'Mine again' : 'Fish again'}<span aria-hidden="true"> ↻</span></button>}
        </div>
    </section>;
}
