import type { WorldWandererDialogProps } from '../components/WorldWandererDialog';
type ActionResult=void|Promise<unknown>;
type WandererAction=(wanderer:WorldWandererDialogProps['wandererDialog']['w'])=>ActionResult;
/** One action model for ordinary road conversations, including busy rules. */
export function ordinaryWandererActions(props:WorldWandererDialogProps) {
    const {wandererDialog,character,closeWandererDialog,askRoadRumor,tradeWithWanderer,visitWandererMedic,startPatrolFight,askAngler,startWandererAttack,followTracker,startWandererFavor,followTrackerTrail,abandonTrackerTrail,claimWandererFavor,claimWandererGift,startWandererPetDuel,startWandererCardDuel}=props;
    const w=wandererDialog.w,busy=!!wandererDialog.busy;
    const action=(label:string,run:()=>ActionResult,disabled=false,muted=false)=>({label,run,disabled,muted});
    const call=(label:string,run:WandererAction)=>action(label,()=>run(w));
    const work=(label:string,run:WandererAction)=>action(busy?'…':label,()=>run(w),busy);
    const leave=action('Leave',closeWandererDialog),rumor=call('Ask about the road',askRoadRumor);
    const ordinaryActions:Partial<Record<WorldWandererDialogProps['wandererDialog']['w']['verb'],ReturnType<typeof action>[]>>={
        merchant:[work('Trade',tradeWithWanderer),rumor,leave],
        medic:[work('Treat wounds',visitWandererMedic),rumor,leave],
        patrol:[...(w.patrolStance!=='home'?[call('Stand your ground',startPatrolFight)]:[]),rumor,action('Move along',closeWandererDialog)],
        angler:[call('Ask about the water',askAngler),rumor,leave],
        contest:[action('Contest the seam',()=>startWandererAttack(w,false),busy),action('Leave him to it',closeWandererDialog)],
        tracker:[work('Follow tracks',followTracker),work('Take a favor',startWandererFavor),rumor,leave],
        trackerTrail:[work(character.activeTrackerTrail?.step===1?'Approach the beast':'Keep following',followTrackerTrail),action('Give up the trail',()=>abandonTrackerTrail(w),busy,true),leave],
        courier:[work('Deliver favor',claimWandererFavor),leave],
        gift:[work('Take it',claimWandererGift),rumor,leave],
        petDuel:[call('Send out your pet',startWandererPetDuel),leave],
        gamble:[call('Deal me in',startWandererCardDuel),rumor,leave],
    };
    return ordinaryActions[w.verb];
}
