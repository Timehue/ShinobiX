import { useState, type ComponentProps } from 'react';
import { HunterBoard } from './HunterBoard';
import { RESOURCE_NODES } from '../../../shared/resource-nodes';
import { readResourceGathering, resourceSkillLevel, RESOURCE_SKILL_XP, resourceSuccessRate, resourceQualityWeights, resourceActionsToday, RESOURCE_GRADES, type ResourceActivity } from '../../../shared/resource-gathering';
import { sectorName } from '../../../shared/sector-geo';
import { GatheringEquipment } from '../components/GatheringEquipment';
import { ResourceRefinery } from '../components/ResourceRefinery';
import { handleHorizontalTabKeyDown } from '../lib/tab-keyboard';
import '../components/resource-gathering.css';

export function ShinobiOutpost(props: ComponentProps<typeof HunterBoard>) {
    const [tab, setTab] = useState<'hunting' | ResourceActivity>(() => {
        try { const saved = sessionStorage.getItem('shinobiOutpost.tab'); return saved === 'fishing' || saved === 'mining' ? saved : 'hunting'; } catch { return 'hunting'; }
    });
    function selectTab(value: 'hunting' | ResourceActivity) {
        setTab(value); try { sessionStorage.setItem('shinobiOutpost.tab', value); } catch { /* optional navigation preference */ }
    }
    function visitWorkshop() {
        if (tab === 'mining') {
            try { sessionStorage.setItem('centralHub.initialPanel', 'crafter'); } catch { /* Central still provides the Crafter entrance */ }
        }
        props.setScreen(tab === 'mining' ? 'centralHub' : 'cafeteria');
    }
    const state = readResourceGathering(props.character.resourceGathering), activity = tab === 'hunting' ? 'fishing' : tab;
    const xp = state[`${activity}Xp`], level = resourceSkillLevel(xp), next = RESOURCE_SKILL_XP[level];
    const weights = resourceQualityWeights(level, 3);
    return <div className="shinobi-outpost">
        <header className="outpost-header"><div><p className="resource-kicker">Central · Field command</p><h1>Shinobi Outpost</h1><p>Track the wilds. Read the water. Follow the fault.</p></div><strong>{Math.max(0, 100 - resourceActionsToday(props.character))}<small> / 100 shared actions left</small></strong></header>
        <div role="tablist" aria-label="Outpost activities" className="outpost-tabs">
            {(['hunting', 'fishing', 'mining'] as const).map(value => <button type="button" key={value} role="tab" id={`outpost-tab-${value}`} onKeyDown={handleHorizontalTabKeyDown}
                aria-selected={tab === value} aria-controls={`outpost-panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => selectTab(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>
        <div role="tabpanel" id={`outpost-panel-${tab}`} aria-labelledby={`outpost-tab-${tab}`}>
            {tab === 'hunting' ? <HunterBoard {...props} /> : <div className="outpost-resource-panel">
                <section className="outpost-skill-card"><div><p className="resource-kicker">Independent field skill</p><h2>{tab === 'mining' ? 'Mining' : 'Fishing'} · Level {level}</h2>
                    <p>{tab === 'mining' ? 'Place chakra charges along visible fractures. Expose the core without sending two cracks into the same face.' : 'Hook when the float dips, then hold and release Reel to keep the line tension under control.'}</p>
                    <p>Success awards 10 skill XP. A completed failed attempt awards 3. Higher skill improves success and quality.</p></div>
                    <div className="outpost-skill-progress"><strong>{level === 10 ? 'Mastered' : `${xp} / ${next} XP`}</strong><progress max={next ?? 1} value={next ? xp : 1}/><p>{resourceSuccessRate(level, 1)}% baseline success at basic sites</p></div>
                </section>
                <div className="outpost-quality" aria-label="Skill quality chances at a master site">{RESOURCE_GRADES.map((grade, index) => <div key={grade}><span>{grade}</span><strong>{weights[index].toFixed(1)}%</strong><small>{index === 0 ? 'Available now' : `Unlocks at skill ${[1, 2, 4, 7][index]}`}</small></div>)}</div>
                <p className="resource-note">Quality is capped by the site: basic sites yield up to Fine, rich sites up to Superior, and master sites up to Pristine. Better grades remain gated by your skill.</p>
                <GatheringEquipment character={props.character} commit={props.onVersionedCharacter} />
                {tab === 'mining' && <ResourceRefinery character={props.character} commit={props.onVersionedCharacter} />}
                <section><div className="resource-section-heading"><h2>{tab === 'mining' ? 'Known mineral seams' : 'Known fishing waters'}</h2><button type="button" onClick={() => props.setScreen('worldMap')}>Open world map</button></div>
                    <div className="outpost-node-directory">{RESOURCE_NODES.filter(node => node.activity === tab).map(node => <article key={node.id}><strong>{node.name}</strong><span>{sectorName(node.sector)}</span><small>Skill {node.difficulty} · up to {RESOURCE_GRADES[node.ceiling]}</small><span>{level < node.difficulty ? `Unlocks at skill ${node.difficulty}` : `${resourceSuccessRate(level, node.difficulty)}% baseline success`}</span></article>)}</div>
                </section>
                <footer className="outpost-consumers"><p>{tab === 'mining' ? 'Use Fine ore for rare gear, Superior ore for epic weapons, and Pristine ore for legendary weapons. Regional crystals and ores supply specialized recipes.' : 'Cook five same-grade fish with one Field Herb, one Heartwood Bark for fuel, and 30 Ryo. Higher grades produce 5, 10, 15 or 20 Ration Packs, within the existing 40-ration daily cooking allowance.'}</p><button type="button" onClick={visitWorkshop}>{tab === 'mining' ? 'Visit the Crafter in Central' : 'Visit the Cafeteria'}</button></footer>
            </div>}
        </div>
    </div>;
}
