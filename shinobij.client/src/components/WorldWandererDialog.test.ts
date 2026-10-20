import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import type { WorldWandererDialogProps } from './WorldWandererDialog';
import { ordinaryWandererActions } from '../lib/ordinary-wanderer-actions';
import { WorldWandererDialog } from './WorldWandererDialog';
import React,{ isValidElement,type ReactNode } from 'react';
import { QUEST_BOOK,epicForWanderer } from '../lib/questbook';
import { EMISSARY_BY_SLUG } from '../lib/legacy-emissaries';
const originalReact=Object.getOwnPropertyDescriptor(globalThis,'React');
Object.defineProperty(globalThis,'React',{configurable:true,value:React});
after(()=>{if(originalReact)Object.defineProperty(globalThis,'React',originalReact);else Reflect.deleteProperty(globalThis,'React');});

function dialog(verb:string,busy=false,home=false) {
    const calls:unknown[][]=[],w={id:'test',name:'Road NPC',verb,archetype:'merchant',patrolStance:home?'home':'rival',tellTint:'#abc',greeting:'Hello',level:20};
    const props=new Proxy({wandererDialog:{w,busy},character:{level:30,activeTrackerTrail:{step:1}},now:0},
        {get:(target,key)=>key in target?Reflect.get(target,key):(...args:unknown[])=>calls.push([key,...args])}) as unknown as WorldWandererDialogProps;
    return {actions:ordinaryWandererActions(props)!,calls,w};
}
test('ordinary NPC choices preserve labels, option order and action targets',()=>{
    const cases:[string,string[],string][]=[
        ['merchant',['Trade','Ask about the road','Leave'],'tradeWithWanderer'],
        ['medic',['Treat wounds','Ask about the road','Leave'],'visitWandererMedic'],
        ['patrol',['Stand your ground','Ask about the road','Move along'],'startPatrolFight'],
        ['angler',['Ask about the water','Ask about the road','Leave'],'askAngler'],
        ['contest',['Contest the seam','Leave him to it'],'startWandererAttack'],
        ['tracker',['Follow tracks','Take a favor','Ask about the road','Leave'],'followTracker'],
        ['trackerTrail',['Approach the beast','Give up the trail','Leave'],'followTrackerTrail'],
        ['courier',['Deliver favor','Leave'],'claimWandererFavor'],
        ['gift',['Take it','Ask about the road','Leave'],'claimWandererGift'],
        ['petDuel',['Send out your pet','Leave'],'startWandererPetDuel'],
        ['gamble',['Deal me in','Ask about the road','Leave'],'startWandererCardDuel'],
    ];
    for(const [verb,labels,callback] of cases){const {actions,calls,w}=dialog(verb);assert.deepEqual(actions.map(a=>a.label),labels,verb);actions[0].run();assert.equal(calls[0][0],callback);assert.equal(calls[0][1],w);actions.at(-1)!.run();assert.equal(calls.at(-1)![0],'closeWandererDialog');}
    assert.deepEqual(dialog('patrol',false,true).actions.map(a=>a.label),['Ask about the road','Move along']);
});
test('busy NPC choices retain the established disabled and leave behavior',()=>{
    for(const verb of ['merchant','medic','tracker','trackerTrail','courier','gift']){
        const {actions}=dialog(verb,true);assert.equal(actions[0].label,'…',verb);assert.equal(actions[0].disabled,true);assert.equal(actions.at(-1)!.disabled,false);
    }
    const contest=dialog('contest',true).actions;assert.equal(contest[0].label,'Contest the seam');assert.equal(contest[0].disabled,true);
    assert.equal(dialog('trackerTrail',true).actions[1].disabled,true);
});

function renderedDialog(verb:string,busy:boolean,character:Record<string,unknown>,extra:Record<string,unknown>={}) {
    const calls:unknown[][]=[],w={id:'test',name:'Road NPC',verb,archetype:'questgiver',greeting:'Hello',level:20};
    const props=new Proxy({wandererDialog:{w,busy,...extra},character:{level:30,...character},now:0,atWar:false,legacyTrial:null,emissaryDayBucket:0},
        {get:(target,key)=>key in target?Reflect.get(target,key):(...args:unknown[])=>calls.push([key,...args])}) as unknown as WorldWandererDialogProps;
    const buttons:{label:string;disabled:unknown;click:()=>unknown}[]=[];
    const text=(node:ReactNode):string=>Array.isArray(node)?node.map(text).join(''):isValidElement<{children?:ReactNode}>(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';
    const visit=(node:ReactNode)=>{if(Array.isArray(node))node.forEach(visit);else if(isValidElement<{children?:ReactNode;disabled?:unknown;onClick:()=>unknown}>(node)){
        if(node.type==='button')buttons.push({label:text(node.props.children),disabled:node.props.disabled,click:node.props.onClick});else visit(node.props.children);
    }};
    const tree=WorldWandererDialog(props);visit(tree);return {buttons,calls,w,text:text(tree)};
}

test('rendered hostile choices show the real flee price, preserve callback arguments and block ordinary actions',()=>{
    for(const verb of ['attack','bountyHunter','patrol'])for(const busy of [false,true])for(const nemesis of [false,true]){
        const w={id:'hostile',name:'Road hostile',verb,archetype:'bandit',patrolStance:'rivalWar',greeting:'Stop.',level:30};
        const view=renderedDialog(verb,busy,{hp:100,ryo:1000},{w,nemesis});
        assert.deepEqual(view.buttons.map(button=>button.label),['Fight','Flee']);
        assert.match(view.text,/If you flee, you lose 50 HP and drop 100 ryo\./);
        for(const button of view.buttons)assert.equal(button.disabled,busy);
        view.buttons[0].click();assert.deepEqual(view.calls[0],verb==='patrol'?['startPatrolFight',w]:['startWandererAttack',w,nemesis]);
        view.buttons[1].click();assert.deepEqual(view.calls[1],['fleeWanderer',w]);
        assert(!view.calls.some(call=>call[0]==='dismissWandererDialog'||call[0]==='closeWandererDialog'));
    }
});

test('rendered peaceful passage and wild-beast encounters retain their separate actions',()=>{
    const peace=renderedDialog('attack',false,{hp:100,ryo:1000},{peace:true});
    assert.deepEqual(peace.buttons.map(button=>button.label),['Pass in peace','Fight anyway']);
    peace.buttons[0].click();assert.deepEqual(peace.calls[0],['dismissWandererDialog']);
    peace.buttons[1].click();assert.deepEqual(peace.calls[1],['startWandererAttack',peace.w,false]);
    const beast=renderedDialog('petDuel',false,{});
    assert.deepEqual(beast.buttons.map(button=>button.label),['Send out your pet','Leave']);
    beast.buttons[0].click();assert.deepEqual(beast.calls[0],['startWandererPetDuel',beast.w]);
    beast.buttons[1].click();assert.deepEqual(beast.calls[1],['closeWandererDialog']);
});
test('quest button reuse preserves completed and unfinished errands, busy text and callback arguments',()=>{
    for(const busy of [false,true])for(const verb of ['quest','legacyQuest']){
        const emissary=EMISSARY_BY_SLUG.values().next().value!,id=verb==='quest'?'test-quest':emissary.quests[0].id;
        const metric=verb==='quest'?'totalAiKills':emissary.quests[0].metric;
        for(const done of [false,true]){
            const extra=verb==='legacyQuest'?{w:{id:'test',name:'Emissary',verb,archetype:emissary.slug,greeting:'Hello',level:20}}:{};
            const {buttons,calls,w}=renderedDialog(verb,busy,{activeWandererQuest:{id,baseline:0,target:2},[metric]:done?2:0},extra);
            assert.deepEqual(buttons.map(b=>b.label),done?[busy?'…':'Claim reward','Abandon','Leave']:[verb==='quest'?'Abandon':'Abandon errand','Leave']);
            assert.equal(buttons[0].disabled,busy);assert.equal(buttons.at(-1)!.disabled,undefined);
            buttons[0].click();assert.equal(calls[0][0],done?'claimWandererQuest':'abandonWandererQuest');assert.equal((calls[0][1] as {id:string}).id,w.id);
            buttons.at(-1)!.click();assert.equal(calls.at(-1)![0],'closeWandererDialog');
        }
    }
});
test('epic continue and final reward retain their callbacks, while leave and abandon remain available',()=>{
    const entry=Object.values(QUEST_BOOK).find(q=>q.stages.length>1&&!q.stages[0].choice&&!q.stages.at(-1)!.choice)!;
    for(const index of [0,entry.stages.length-1])for(const busy of [false,true]){
        const stage=entry.stages[index],{buttons,calls,w}=renderedDialog('quest',busy,{activeQuestbook:{id:entry.id,stage:index,baseline:0,choices:{}},[stage.metric]:stage.count});
        assert.deepEqual(buttons.map(b=>b.label),[busy?'…':index===0?'Continue':'Claim reward','Abandon','Leave']);
        assert.equal(buttons[0].disabled,busy);assert.equal(buttons[1].disabled,undefined);buttons[0].click();
        assert.deepEqual(calls[0],index===0?['advanceEpic',false]:['claimEpic',w]);buttons[1].click();assert.deepEqual(calls[1],['abandonEpic',w]);
    }
});
test('an unrecognized emissary still renders a Leave button, rather than an object',()=>{
    const {buttons}=renderedDialog('legacyQuest',false,{});assert.deepEqual(buttons.map(b=>b.label),['Leave']);
});
test('task acceptance and reckoning abandonment keep busy labels and their real action targets',()=>{
    for(const busy of [false,true]){
        const offered=renderedDialog('quest',busy,{});assert.equal(offered.buttons[0].label,busy?'…':'Accept task');
        offered.buttons[0].click();assert.deepEqual(offered.calls[0],['acceptWandererQuest',offered.w]);
        const w={id:'story-reckoning-test',name:'Traveler',verb:'quest',archetype:'questgiver',greeting:'Hello',level:20};
        const recalled=renderedDialog('quest',busy,{activeStoryReckoning:{id:w.id}},{w,msg:'An earlier request.'});
        assert.deepEqual(recalled.buttons.map(b=>b.label),[busy?'…':'Abandon reckoning','Leave']);assert.equal(recalled.buttons[0].disabled,busy);
        recalled.buttons[0].click();assert.deepEqual(recalled.calls[0],['handleStoryReckoningAbandon',w]);
    }
});
test('the shared epic-offer button preserves its busy state and passes the selected quest ID',()=>{
    const level=Array.from({length:100},(_,i)=>i+1).find(level=>epicForWanderer('test',level))!,offer=epicForWanderer('test',level)!;
    for(const busy of [false,true]){
        const {buttons,calls,w}=renderedDialog('quest',busy,{level});
        assert.deepEqual(buttons.map(b=>b.label),[busy?'…':'Accept task',busy?'…':'Begin epic','Leave']);
        assert.equal(buttons[1].disabled,busy);buttons[1].click();assert.deepEqual(calls[0],['acceptEpic',w,offer.id]);
    }
});
