import { addOwned, applyForge, countOwned, removeOwned } from '../craft/_forge.js';
import { planSelectedCraftIngredients } from '../../shared/crafting-recipes.js';
import { buildingHasService, sectorBuilding } from '../../shared/sector-buildings.js';
import { BUILDING_REPAIR_INGREDIENTS, buildingCompanion, buildingCourierRoute, buildingRecipeTrust, buildingRegisterEntries, buildingTeaClosure, buildingWorkshopRecipes, buildingWorkView } from '../../shared/sector-building-content.js';
import { buildingContactProtocol, buildingFestivalTasks } from '../../shared/sector-building-stories.js';
import { BUILDING_DELIVERY_DAILY_CAP, BUILDING_RECEIPT_LIMIT, BUILDING_REPAIR_REWARDS, buildingDay, buildingStanding, readBuildingProgress, readSharedBuilding } from '../../shared/sector-building-state.js';
import type { BuildingAction, BuildingPoint, BuildingReceipt, BuildingReward, BuildingWorkOrder, SectorBuildingProgress, SharedBuildingState } from '../../shared/sector-building-types.js';
import { applyCafeteriaMeal, CAFETERIA_MEALS } from '../player/_cafeteria.js';
import { inventoryGrowthBlock } from '../_inventory-capacity.js';

type Character = Record<string, unknown>;
export type BuildingDecision = { ok:true; character:Character; shared:SharedBuildingState; sharedChanged:boolean; receipt:BuildingReceipt; replayed:boolean }
    | { ok:false; error:string };
export type BuildingActionContext = { now:number; orderId:string; displayName:string; conditions?:string; territory?:Record<string,unknown> };
const emptyReward = ():BuildingReward => ({ryo:0,boneCharms:0,fateShards:0});
const positive=(v:unknown)=>Math.max(0,Number.isFinite(Number(v))?Math.floor(Number(v)):0);

/** The endpoint derives this target INSIDE the save lock. Neither request tile
 * nor caller-supplied destination can authorize work. */
export function buildingActionTarget(character:Character,action:BuildingAction,now:number):BuildingPoint|undefined{
    const building=sectorBuilding(action.buildingId);if(!building)return;
    const progress=readBuildingProgress(character.sectorBuildings,now);
    if(action.action==='step')return progress.active&&buildingWorkView(progress.active)?.target;
    if(action.action==='survey')return building.evidence?.[buildingStanding(progress,building.id).survey?.step??0];
    return {sector:building.sector,tile:building.approach,label:building.name,description:building.description};
}
export function reduceBuildingAction(character:Character,action:BuildingAction,rawShared:unknown,ctx:BuildingActionContext):BuildingDecision{
    const building=sectorBuilding(action.buildingId);if(!building)return{ok:false,error:'This building is not in the road register.'};
    const progress=readBuildingProgress(character.sectorBuildings,ctx.now), shared=readSharedBuilding(rawShared);
    const prior=progress.receipts.find(r=>r.requestId===action.requestId);
    if(prior){
        if(prior.buildingId!==building.id||prior.action!==action.action)return{ok:false,error:'This request belongs to a different building action.'};
        return{ok:true,character,shared,sharedChanged:false,receipt:prior,replayed:true};
    }
    let next={...character}, state:SectorBuildingProgress={...progress,standing:{...progress.standing},titles:[...progress.titles]};
    const standing={...buildingStanding(state,building.id)};state.standing[building.id]=standing;
    let communal={...shared}, sharedChanged=false, reward=emptyReward(), message='',materials:Record<string,number>|undefined;
    const refuse=(error:string):BuildingDecision=>({ok:false,error});
    const requireService=(service:Parameters<typeof buildingHasService>[1])=>buildingHasService(building,service);
    const title=(name:string)=>{if(!state.titles.includes(name))state.titles.push(name);};
    if(action.action==='visit'){
        const day=buildingDay(ctx.now);
        if(standing.visitDay!==day){standing.visits++;standing.trust=Math.min(100,standing.trust+1);standing.visitDay=day;}
        standing.metAt ||= ctx.now;
        message=`${building.keeper} has entered your visit in the public counter book.`;
    }else if(action.action==='begin'||action.action==='tea'){
        if(state.active)return refuse('Finish or cancel your current building work before taking another order.');
        const kind=action.action==='tea'?'tea':action.service;
        if(!kind||!requireService(kind))return refuse('This counter does not offer that service.');
        if(kind==='tea'){const closed=buildingTeaClosure(building,ctx.now,ctx.territory);if(closed)return refuse(closed);}
        if(kind==='courier'&&state.deliveriesToday>=BUILDING_DELIVERY_DAILY_CAP)return refuse('You have completed all three paid deliveries for today.');
        if(kind==='intelligence'&&standing.intelDay===state.day)return refuse('The contact has already settled your handoff today.');
        if(kind==='intelligence'&&(standing.suspicionUntil??0)>ctx.now)return refuse('The contact is keeping the window shuttered until the suspicion passes.');
        if(kind==='festival'&&standing.festivalDay===state.day)return refuse('Your festival participation has already been recorded today.');
        if(kind==='watch'&&standing.watchDay===state.day)return refuse('Your paid watch round at this post is complete for today.');
        if(kind==='tea'&&(standing.teaUntil??0)>ctx.now)return refuse('The host is still tending your last tea service. Come back after the next kettle round.');
        if(kind==='repair'){
            if(!Array.isArray(action.materials))return refuse('Choose the exact ore, hunting materials, fish and harvested materials for this order.');
            const plan=planSelectedCraftIngredients(BUILDING_REPAIR_INGREDIENTS,id=>countOwned(next,id),1,action.materials);
            if(!plan)return refuse('The selected materials do not cover this work order. Nothing has been spent.');
            materials=plan;for(const[id,count]of Object.entries(plan))next=removeOwned(next,id,count);
        }
        if(kind==='tea'){
            if(positive(next.ryo)<30)return refuse('Tea and a short rest cost 30 ryo.');
            next={...next,ryo:positive(next.ryo)-30};standing.teaUntil=ctx.now+15*60_000;
        }
        const route=kind==='courier'?buildingCourierRoute(building):undefined;
        if(kind==='courier'&&route?.length!==2)return refuse('This relay has no verified onward route.');
        const order:BuildingWorkOrder={id:ctx.orderId,buildingId:building.id,kind,startedAt:ctx.now,stepAt:ctx.now,step:0,day:state.day,...(materials?{materials}:{}),...(route?{route}:{}),...(kind==='intelligence'?{protocol:buildingContactProtocol(building.id,ctx.now)}:{}),...(kind==='watch'?{watchStage:shared.stage}:{}),observations:[]};
        state.active=order;
        message=kind==='repair'?'The keeper has set aside your exact materials. Your three work steps can be resumed after reconnecting.'
            :kind==='courier'?'The clerk gives you a sealed pouch and names the two receiving relays. Follow the stamped route.'
            :kind==='tea'?'The host takes 30 ryo and begins pouring. Settle beside the kettle; a quiet rest will restore you as a small meal would.'
            :'The keeper has entered the work in the counter book. Follow the marked steps.';
    }else if(action.action==='cancel'){
        const active=state.active;
        if(!active||active.buildingId!==building.id||active.id!==action.orderId)return refuse('This work order is no longer active.');
        materials=active.materials;
        for(const[id,count]of Object.entries(materials??{}))next=addOwned(next,id,count,true);
        if(active.kind==='tea'){next={...next,ryo:positive(next.ryo)+30};delete standing.teaUntil;}
        delete state.active;message=active.kind==='repair'?'The unused materials have been returned in their original grades.':active.kind==='tea'?'The unserved tea has been cancelled and its 30 ryo returned.':'The keeper has closed the unfinished order. No completion reward was paid.';
    }else if(action.action==='step'){
        const active=state.active;
        if(!active||active.buildingId!==building.id||active.id!==action.orderId||active.step!==action.step)return refuse('This work step has changed. Reopen the counter book.');
        const work=buildingWorkView(active);if(!work)return refuse('This work order could not be read. Return to the keeper to cancel it.');
        if(ctx.now<work.readyAt)return refuse('Let the current work step finish before recording it.');
        if(active.kind==='intelligence'){
            const expected=['observe','read-mark',active.protocol?`handoff-${active.protocol}`:'quiet-handoff'][active.step];
            if(action.choice!==expected){
                if(!work.choices?.some(choice=>choice.id===action.choice))return refuse('Choose one of the contact’s handling instructions.');
                standing.suspicionUntil=ctx.now+5*60_000;standing.trust=Math.max(0,standing.trust-2);delete state.active;
                message='The handoff has been exposed. The contact shutters the window for five minutes. No reward is paid; the personal story ledger is unchanged.';
            }
        }
        if(!message&&active.kind==='festival'&&action.choice!==buildingFestivalTasks(building.id)[active.step]?.choice){
            if(!work.choices?.some(choice=>choice.id===action.choice))return refuse('Choose one of the keeper’s preparation steps.');
            state.active={...active,step:0,stepAt:ctx.now};message='The keeper resets the practice. Begin again with the first instruction; no supplies or rewards have changed.';
        }else if(!message){
            const observation=active.kind==='watch'?`${work.target.label} — ${ctx.conditions??'conditions not included in this report'}`:work.target.label;
            if(!work.final){state.active={...active,step:active.step+1,stepAt:ctx.now,observations:[...active.observations??[],observation]};message=`${work.target.label} is recorded. Continue with the next step.`;}
            else{
                if(active.kind==='repair'){
                    state.repairs++;state.repairsToday++;standing.repairCount++;standing.trust=Math.min(100,standing.trust+2);
                    reward.ryo=BUILDING_REPAIR_REWARDS.ryo;
                    reward.boneCharms=state.repairs%BUILDING_REPAIR_REWARDS.boneCharms.repairs===0?BUILDING_REPAIR_REWARDS.boneCharms.amount:0;
                    // Pay every earned batch, including any deferred by the retired weekly cap.
                    const unpaidMilestones=Math.max(0,Math.floor(state.repairs/BUILDING_REPAIR_REWARDS.fateShards.repairs)-state.shardClaims);
                    reward.fateShards=unpaidMilestones*BUILDING_REPAIR_REWARDS.fateShards.amount;
                    state.shardClaims+=unpaidMilestones;
                    const contributors=shared.contributors.filter(c=>c.name!==ctx.displayName),old=shared.contributors.find(c=>c.name===ctx.displayName);
                    contributors.push({name:ctx.displayName,repairs:Math.max((old?.repairs??0)+1,standing.repairCount)});
                    contributors.sort((a,b)=>b.repairs-a.repairs||a.name.localeCompare(b.name));
                    communal=readSharedBuilding({...shared,revision:shared.revision+1,repairs:shared.repairs+1,updatedAt:ctx.now,contributors});sharedChanged=true;materials=active.materials;
                    if(state.repairs>=10)title('Road Restorer');
                    message=communal.stage>shared.stage?'The crew completes the next restoration stage. Your materials and work are recorded in the public roll.':'Your repair order is complete. The crew records the shelter work and your contribution.';
                }else if(active.kind==='courier'){
                    if(state.deliveriesToday>=BUILDING_DELIVERY_DAILY_CAP)return refuse('Today’s paid delivery allowance is complete. The sealed pouch can be delivered tomorrow.');
                    state.deliveries++;state.deliveriesToday++;standing.trust=Math.min(100,standing.trust+2);reward.ryo=120;
                    if(state.deliveries>=5)title('Trusted Courier');message='Both receiving clerks have stamped the route. The sealed pouch is delivered and the commission is settled.';
                }else if(active.kind==='watch'){
                    state.watches++;standing.watchDay=state.day;reward.ryo=80;standing.trust=Math.min(100,standing.trust+1);title('Bridge Watch Volunteer');
                    communal={...shared,revision:shared.revision+1,updatedAt:ctx.now,reports:[...shared.reports,{name:ctx.displayName,at:ctx.now,text:[...active.observations??[],observation].join(' ')}].slice(-8)};sharedChanged=true;
                    message='The watch keeper files your crossing report. The next visitor can read the report at this post.';
                }else if(active.kind==='intelligence'){
                    standing.intelDay=state.day;standing.trust=Math.min(100,standing.trust+3);reward.ryo=100;message='The seal reaches the speaking window intact. The contact records the kept trust and settles the handoff.';
                }else if(active.kind==='festival'){
                    standing.festivalDay=state.day;standing.trust=Math.min(100,standing.trust+2);reward.ryo=60;title('Sunscar Participant');message='The keeper records your completed festival duty. All borrowed practice equipment is returned and the public approach is clear for the next group.';
                }else if(active.kind==='tea'){
                    // The 30-ryo price is already reserved by the admitted tea order.
                    // Reuse the existing small-meal restoration formula without a second charge.
                    const rested=applyCafeteriaMeal(next,{...CAFETERIA_MEALS['small-ramen'],cost:0});
                    if(!rested.ok)return refuse('The tea service could not be completed. Reopen the counter book.');
                    next=rested.character;standing.trust=Math.min(100,standing.trust+1);message=`The host sets down the tea. Warmth and a quiet rest restore HP, chakra and stamina as a small meal would. ${buildingCompanion(next)}`;
                }
                delete state.active;
            }
        }
    }else if(action.action==='survey'){
        if(!requireService('survey')||!building.evidence?.length)return refuse('There is no field investigation at this frontage.');
        const survey=standing.survey??{step:0,evidence:[]};if(survey.recordedAt||survey.step>=building.evidence.length)return refuse('The evidence is already collected. Return to the keeper to record the account.');
        if(action.step!==survey.step)return refuse('This evidence step has changed. Check your field notes.');
        const evidence=building.evidence[survey.step];standing.survey={...survey,step:survey.step+1,evidence:[...survey.evidence,evidence.label]};
        message=`${evidence.label} is entered in your field notes. A Chronicle account still needs the keeper’s review.`;
    }else if(action.action==='record'){
        const survey=standing.survey;if(!requireService('survey')||!survey||survey.step!==building.evidence?.length||survey.recordedAt)return refuse('Collect the complete evidence before recording this place.');
        if(!['evidence-only','open-question'].includes(action.choice??''))return refuse('Choose whether to record only the evidence or mark an unanswered question.');
        standing.survey={...survey,recordedAt:ctx.now,interpretation:action.choice};state.surveys++;standing.trust=Math.min(100,standing.trust+2);reward.ryo=90;
        if(state.surveys>=3)title('Chronicle Field Witness');message='The keeper confirms the account against the collected evidence. The Chronicle entry records this place without inventing a witness.';
    }else if(action.action==='register'){
        if(!requireService('register'))return refuse('This counter does not keep a public witness register.');
        const entry=buildingRegisterEntries(building,state).find(e=>e.id===action.choice);if(!entry?.eligible)return refuse(entry?.reason??'Choose a verified account from this register.');
        standing.registerEntry=entry.id;message=`The keeper enters “${entry.title}” beside your name. This is a record of a witnessed deed, never a new campaign outcome.`;
    }else if(action.action==='craft'){
        if(!requireService('workshop')||!buildingWorkshopRecipes(building).includes(action.recipeId??''))return refuse('This workshop does not hold that recipe.');
        if(standing.trust<buildingRecipeTrust(building,action.recipeId!))return refuse('Build 5 local trust through visits or public work before using this keeper’s third regional recipe. Its other crafting locations remain available.');
        if(state.active)return refuse('Finish or cancel the work in your hands before using the workshop.');
        if(!Array.isArray(action.materials))return refuse('Choose the exact materials before asking the workshop to craft.');
        const crafted=applyForge(next,'supply',action.recipeId!,1,action.materials);if(!crafted)return refuse('The keeper cannot begin: check the recipe’s level, selected materials and room for the finished item. Nothing was spent.');
        const full=inventoryGrowthBlock(next,crafted);if(full)return refuse(full.error);
        next=crafted;message='The keeper checks your selected materials and hands over the finished item.';
    }else return refuse('Choose an action from the building counter.');
    next={...next,ryo:positive(next.ryo)+reward.ryo,boneCharms:positive(next.boneCharms)+reward.boneCharms,fateShards:positive(next.fateShards)+reward.fateShards};
    if(reward.ryo||reward.boneCharms||reward.fateShards)state.rewardsToday++;
    const receipt:BuildingReceipt={id:ctx.orderId,requestId:action.requestId,buildingId:building.id,buildingName:building.name,sector:building.sector,action:action.action,at:ctx.now,message,reward,...(materials?{materials}:{})};
    state={...state,receipts:[...state.receipts,receipt].slice(-BUILDING_RECEIPT_LIMIT)};
    return{ok:true,character:{...next,sectorBuildings:state},shared:communal,sharedChanged,receipt,replayed:false};
}
