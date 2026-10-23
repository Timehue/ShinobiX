import { useState, type ComponentProps } from 'react';
import { HunterBoard } from './HunterBoard';
import { resourceActionsToday, type ResourceActivity } from '../../../shared/resource-gathering';
import { OutpostResourcePanel } from '../components/OutpostResourcePanel';
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
    return <div className="shinobi-outpost">
        <header className="outpost-header"><div><p className="resource-kicker">Central · Field command</p><h1>Shinobi Outpost</h1><p>Track the wilds. Read the water. Follow the fault.</p></div><strong>{Math.max(0, 100 - resourceActionsToday(props.character))}<small> / 100 shared actions left</small></strong></header>
        <div role="tablist" aria-label="Outpost activities" className="outpost-tabs">
            {(['hunting', 'fishing', 'mining'] as const).map(value => <button type="button" key={value} role="tab" id={`outpost-tab-${value}`} onKeyDown={handleHorizontalTabKeyDown}
                aria-selected={tab === value} aria-controls={`outpost-panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => selectTab(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>
        <div role="tabpanel" id={`outpost-panel-${tab}`} aria-labelledby={`outpost-tab-${tab}`}>
            {tab === 'hunting' ? <HunterBoard {...props} /> : <OutpostResourcePanel activity={tab} character={props.character}
                commit={props.onVersionedCharacter} onBack={() => props.setScreen('centralHub')}
                onMap={() => props.setScreen('worldMap')} onWorkshop={visitWorkshop} />}
        </div>
    </div>;
}
