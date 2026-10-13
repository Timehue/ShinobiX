import {test,before,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {CLAN_PROJECT} from '../../shared/clan-program.js';
import {validateClanSaveWrite} from '../_clan-save-validate.js';
process.env.NODE_ENV='test';process.env.SHINOBIX_QA_MEMORY_KV='1';
let kv:typeof import('../_storage.js').kv,act:typeof import('./_program.js').actClanProgram,view:typeof import('./_program.js').clanProgramView;
before(async()=>{({kv}=await import('../_storage.js'));({actClanProgram:act,clanProgramView:view}=await import('./_program.js'));});
beforeEach(async()=>{const keys=await kv.keys('*');if(keys.length)await kv.del(...keys);});
async function seed(){
    const members=['akira','rei','kuro','mei'];
    await kv.set('save:clan-azure',{name:'Azure',founderName:'akira',members:members.map(name=>({name})),xp:0,level:1,treasury:{items:[]}});
    for(const name of members)await kv.set(`save:${name}`,{_saveVersion:1,character:{name,clan:'Azure',itemStacks:[{itemId:'gather-field-herb',count:20}],inventory:[],clanPoints:0}});
    return members;
}
async function character(name='akira'){return (await kv.get<Record<string,any>>(`save:${name}`))!.character;}
test('contracts count exact completed war matches and active cooperative assaults, excluding proxies, invalid matches and idle parties',async()=>{
    await seed();const now=Date.now(),initial=await view('akira',now);
    const matches=Object.fromEntries(Array.from({length:8},(_,i)=>[`match-${i}`,{id:`match-${i}`,status:'completed',scoreEligible:true,completedAt:now,
        fromClan:'Azure',toClan:'Ember',fromPlayers:['akira'],toPlayers:['enemy']}]));
    await kv.set('clan-war:azure-vs-ember',{id:'azure-vs-ember',clans:['Azure','Ember'],campaign:{matches:{...matches,
        late:{...matches['match-0'],scoreEligible:false},active:{...matches['match-0'],status:'active'},previous:{...matches['match-0'],completedAt:now-8*86_400_000}}}});
    await kv.set(`clan-boss:progress:${initial.weekKey}:azure`,{assaults:[
        {runId:'coop-1',at:now,damage:100,party:['akira','rei'],contributions:{akira:{active:true},rei:{active:true}}},
        {runId:'idle-1',at:now,damage:100,party:['akira','rei'],contributions:{akira:{active:true},rei:{active:false}}},
        {runId:'legacy-no-proof',at:now,damage:100,party:['akira','rei']},
        {runId:'zero-damage',at:now,damage:0,party:['akira','rei'],contributions:{akira:{active:true},rei:{active:true}}},
    ]});
    const current=await view('akira',now);assert.equal(current.contracts[0].progress,8);assert.equal(current.contracts[1].progress,1);
    assert.deepEqual(current.contracts[0].contributors,['akira']);assert.deepEqual(current.contracts[1].contributors,['akira','rei']);
    await act('akira',{action:'claim',contractId:'campaign'},now);const after=await kv.get<Record<string,any>>('save:clan-azure');
    assert.equal(after!.xp,300);await act('rei',{action:'claim',contractId:'campaign'},now+1);assert.equal((await kv.get<Record<string,any>>('save:clan-azure'))!.xp,300);
    await assert.rejects(act('akira',{action:'claim',contractId:'operation'},now),/verified activity/);
    assert.equal((await character()).clanPoints,0);
});
test('four actual donors complete one project, consume exact materials and cannot exceed their share or mint personal CP',async()=>{
    const members=await seed(),now=Date.now();
    for(const name of members){
        const request={action:'fund',itemId:'gather-field-herb',count:10,requestId:`hall-project-${name}-original-001`,clan:'Azure'};
        await act(name,request,now);await act(name,request,now+1);
        assert.equal((await character(name)).itemStacks[0].count,10);assert.equal((await character(name)).clanPoints,0);
    }
    const current=await view('akira',now);assert.equal(current.project.progress,40);assert.equal(current.project.completed,true);assert.equal(current.project.completedProjects,1);
    assert.equal((await kv.get<Record<string,any>>('save:clan-azure'))!.xp,CLAN_PROJECT.clanXp);
    assert.deepEqual((await kv.get<Record<string,any>>('save:clan-azure'))!.treasury.items,[],'materials are consumed, not reusable treasury stock');
    await assert.rejects(act('akira',{action:'fund',itemId:'gather-field-herb',count:1,requestId:'hall-project-excess-001'},now),/remaining project/);
    assert.equal((await character()).itemStacks[0].count,10);
});
test('next week opens a new contribution allowance while prior paid requests remain tied to their original week',async()=>{
    await seed();const now=Date.now(),request={action:'fund',itemId:'gather-field-herb',count:10,requestId:'hall-project-week-replay-001',clan:'Azure'};
    await act('akira',request,now);await act('akira',request,now+7*86_400_000);
    assert.equal((await character()).itemStacks[0].count,10);
    const next=await view('akira',now+7*86_400_000);assert.equal(next.project.progress,0);assert.equal(next.project.memberUsed,0);
});
test('paid project recovery survives departure and lost shared replies without duplicating consumption',async()=>{
    await seed();const original=kv.compareSet,key='save:clan-azure';let armed=true;
    kv.compareSet=async(k,expected,value,options)=>{const committed=await original.call(kv,k,expected,value,options);if(committed&&armed&&k===key){armed=false;throw new Error('lost clan answer');}return committed;};
    const request={action:'fund',itemId:'gather-field-herb',count:10,requestId:'hall-project-lost-answer-001',clan:'Azure'};
    try{await act('akira',request);}finally{kv.compareSet=original;}
    const save=await kv.get<Record<string,any>>('save:akira');await kv.set('save:akira',{...save,character:{...save!.character,clan:''}});
    const replay=await act('akira',request);assert.equal(replay.view,null);assert.equal((await character()).itemStacks[0].count,10);
    assert.equal((await kv.get<Record<string,any>>(key))!.program.weeks[0].supplies.akira,10);
});
test('a definite uncommitted project credit failure compensates materials without advancing the Hall',async()=>{
    await seed();const original=kv.compareSet;
    kv.compareSet=async(key,expected,value,options)=>{if(key==='save:clan-azure')throw new Error('project write failed');return original.call(kv,key,expected,value,options);};
    try{await assert.rejects(act('akira',{action:'fund',itemId:'gather-field-herb',count:10,requestId:'hall-project-refund-001'}),/materials were returned/);}finally{kv.compareSet=original;}
    assert.equal((await character()).itemStacks.reduce((sum:number,item:{count:number})=>sum+item.count,0),20);
    assert.equal((await view('akira')).project.progress,0);
});
test('members volunteer for themselves; leadership coordinates others without granting treasury or rank permissions',async()=>{
    await seed();await act('rei',{action:'assign',assignment:'quartermaster'});
    assert.equal((await view('rei')).assignments.rei,'quartermaster');
    await assert.rejects(act('rei',{action:'assign',member:'kuro',assignment:'fighter'}),/leadership/);
    await act('akira',{action:'assign',member:'kuro',assignment:'scout'});
    assert.equal((await view('akira')).assignments.kuro,'scout');
    await assert.rejects(act('rei',{action:'assign',assignment:'Founder'}),/assignment/);
    assert.equal((await kv.get<Record<string,any>>('save:clan-azure'))!.roleOverrides,undefined);
    await act('rei',{action:'assign',assignment:null});assert.equal((await view('rei')).assignments.rei,undefined);
});
test('generic clan saves cannot forge or erase server-owned goals, awards or assignments',()=>{
    const program={version:1,weeks:[],assignments:{rei:'quartermaster'},completedProjects:1,hallRestored:false};
    const current={name:'Azure',founderName:'akira',members:[{name:'akira',isFounder:true}],program};
    const permissions={callerName:'akira',isAdmin:false};
    assert.deepEqual(validateClanSaveWrite(current,{...current,program:{...program,completedProjects:100,hallRestored:true}},permissions).next.program,program);
    const incoming={...current};delete (incoming as Partial<typeof current>).program;
    assert.deepEqual(validateClanSaveWrite(current,incoming,permissions).next.program,program);
    assert.equal(validateClanSaveWrite(null,current,permissions).next.program,undefined);
});
test('a prototype-like member name remains an ordinary contributor and assignment owner',async()=>{
    await seed();const record=(await kv.get<Record<string,any>>('save:clan-azure'))!;
    await kv.set('save:clan-azure',{...record,members:[...record.members,{name:'constructor'}]});
    await kv.set('save:constructor',{_saveVersion:1,character:{name:'constructor',clan:'Azure',itemStacks:[{itemId:'gather-field-herb',count:10}],inventory:[]}});
    await act('constructor',{action:'fund',itemId:'gather-field-herb',count:10,requestId:'hall-project-constructor-001'});
    await act('constructor',{action:'assign',assignment:'quartermaster'});
    const actual=await view('constructor');assert.equal(actual.project.progress,10);assert.equal(actual.project.memberUsed,10);
    assert.equal(actual.assignments.constructor,'quartermaster');
});
