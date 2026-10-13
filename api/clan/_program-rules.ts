import {CLAN_ASSIGNMENTS,CLAN_PROJECT,type ClanProgram,type ClanProgramWeek,type ClanAssignment} from '../../shared/clan-program.js';
import {addClanXpServer} from './_mission-catalog.js';

export function clanProgram(record:Record<string,unknown>):ClanProgram {
    const raw=record.program;
    if(raw===undefined)return {version:1,weeks:[],assignments:{},completedProjects:0,hallRestored:false};
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Clan goal record is invalid.');
    const value=raw as ClanProgram;
    if(value.version!==1||!Array.isArray(value.weeks)||value.weeks.length>14||!value.assignments||typeof value.assignments!=='object'
        ||Array.isArray(value.assignments)||!Number.isSafeInteger(value.completedProjects)||value.completedProjects<0||typeof value.hallRestored!=='boolean')
        throw new Error('Clan goal record is invalid.');
    for(const week of value.weeks){
        if(!/^\d{4}-W\d{2}$/.test(week.key)||!week.claimed||!week.supplies||Array.isArray(week.supplies)
            ||Object.keys(week.supplies).length>60||Object.values(week.supplies).some(amount=>!Number.isSafeInteger(amount)||amount<0||amount>CLAN_PROJECT.memberLimit))
            throw new Error('Clan weekly goal record is invalid.');
    }
    if(Object.keys(value.assignments).length>60||Object.values(value.assignments).some(role=>!(role in CLAN_ASSIGNMENTS)))throw new Error('Clan assignments are invalid.');
    return structuredClone(value);
}
export function programWeek(program:ClanProgram,key:string):ClanProgramWeek {
    let week=program.weeks.find(entry=>entry.key===key);
    if(!week){week={key,claimed:{},supplies:{}};program.weeks.push(week);program.weeks.sort((a,b)=>b.key.localeCompare(a.key));program.weeks=program.weeks.slice(0,14);}
    return week;
}
export function projectProgress(week:ClanProgramWeek):number{return Math.min(CLAN_PROJECT.target,Object.values(week.supplies).reduce((sum,amount)=>sum+amount,0));}
export function projectMemberUse(week:ClanProgramWeek,name:string):number{return Object.hasOwn(week.supplies,name)?week.supplies[name]:0;}
export type ClanProjectPlan={weekKey:string;name:string;count:number;itemId:string};
/** Called by the debit saga with its sealed plan, after the actual material debit. */
export function applyClanProjectFunding(record:Record<string,unknown>,plan:ClanProjectPlan,now:number):Record<string,unknown> {
    const program=clanProgram(record),week=programWeek(program,plan.weekKey);
    if(week.projectCompletedAt||!Number.isSafeInteger(plan.count)||plan.count<1
        ||projectMemberUse(week,plan.name)+plan.count>CLAN_PROJECT.memberLimit||projectProgress(week)+plan.count>CLAN_PROJECT.target)
        throw new Error('The sealed project contribution exceeds its original allowance.');
    week.supplies={...week.supplies,[plan.name]:projectMemberUse(week,plan.name)+plan.count};
    let next={...record,program};
    if(projectProgress(week)===CLAN_PROJECT.target){
        week.projectCompletedAt=now;program.completedProjects+=1;
        program.hallRestored=program.completedProjects>=CLAN_PROJECT.decorationWeeks;
        next={...next,...addClanXpServer(Number(record.xp)||0,Number(record.level)||1,CLAN_PROJECT.clanXp)};
    }
    return next;
}
export function programAssignment(value:unknown):value is ClanAssignment{return typeof value==='string'&&Object.hasOwn(CLAN_ASSIGNMENTS,value);}
