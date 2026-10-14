/** Shared presentation/rules for the Hall's verified weekly goals. */
export const CLAN_CONTRACTS={
    campaign:{name:'Stand together',target:8,clanXp:300,description:'Complete 8 scored clan-war matches together. Every battle specialty counts; winning is optional.'},
    operation:{name:'Coordinated operations',target:3,clanXp:450,description:'Bank 3 Clan Boss assaults with at least two active clanmates. Wipes with verified damage still count.'},
} as const;
export type ClanContractId=keyof typeof CLAN_CONTRACTS;
export const CLAN_ASSIGNMENTS={fighter:'Fighter',partner:'Team organizer',scout:'Shrine scout',quartermaster:'Quartermaster',mentor:'Mentor'} as const;
export type ClanAssignment=keyof typeof CLAN_ASSIGNMENTS;
export const CLAN_PROJECT={name:'Restore the Hall',target:40,memberLimit:10,clanXp:500,decorationWeeks:4} as const;
export interface ClanProgramWeek {
    key:string;claimed:Partial<Record<ClanContractId,{at:number;contributors:string[]}>>;
    supplies:Record<string,number>;projectCompletedAt?:number;
}
export interface ClanProgram {
    version:1;weeks:ClanProgramWeek[];assignments:Record<string,ClanAssignment>;
    completedProjects:number;hallRestored:boolean;
}
export interface ClanProgramView {
    weekKey:string;resetsAt:number;serverNow:number;clan:string;
    contracts:Array<{id:ClanContractId;progress:number;contributors:string[];claimed:boolean;available:boolean}>;
    project:{progress:number;memberUsed:number;completed:boolean;completedProjects:number;hallRestored:boolean};
    assignments:Record<string,ClanAssignment>;
}
