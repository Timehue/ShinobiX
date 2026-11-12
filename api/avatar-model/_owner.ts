import { randomUUID } from 'node:crypto';
import { kv, type KvCasOp } from '../_storage.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { pushSaveVersion } from '../_realtime/notify.js';

export type ModelOwner={owner:string;id:string;state:'active'|'deleting';createdAt:number};
export type ModelReset = { id: string; active: boolean };
export const modelResetKey = 'avatar-model:reset-epoch';
export const modelOwnerKey=(id:string)=>'avatar-model:owner:'+id;
export const validModelOwnerId=(id:unknown):id is string=>typeof id==='string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);

/** This internal identity is server-owned save data, never a credential or a client choice. */
export async function ensureModelOwner(owner:string) {
    return mutatePlayerSave<ModelOwner>(owner,async({character})=>{
        const reset = await kv.get<ModelReset>(modelResetKey);
        if (reset?.active) return { ok:false, status:503, error:'Model creation is temporarily unavailable.' };
        const existing=character.playerModelOwnerId;
        if(existing!==undefined) {
            if(!validModelOwnerId(existing)) return {ok:false,status:503,error:'Model ownership is unavailable.'};
            const row=await kv.get<ModelOwner>(modelOwnerKey(existing));
            if(row?.owner!==owner || row.id!==existing || row.state!=='active')
                return {ok:false,status:409,error:'Model ownership is unavailable.'};
            return {ok:true,character,write:false,value:row};
        }
        const id=randomUUID(),row:ModelOwner={owner,id,state:'active',createdAt:Date.now()};
        return {ok:true,character:{...character,playerModelOwnerId:id},value:row,
            atomicProof:{key:modelOwnerKey(id),expected:null,value:row,
                additionalOps:[{op:'assert',key:modelResetKey,expected:reset}]},
            afterCommit:({_saveVersion})=>pushSaveVersion(owner,_saveVersion)};
    });
}

/** Guard producer writes against account deletion or a later user reusing its name. */
export async function modelOwnerProof(owner:string,id:string):Promise<KvCasOp[] | null> {
    if(!validModelOwnerId(id)) return null;
    const [save,row,reset]=await Promise.all([kv.get<{character?:{playerModelOwnerId?:string}}>('save:'+owner),
        kv.get<ModelOwner>(modelOwnerKey(id)),kv.get<ModelReset>(modelResetKey)]);
    if(reset?.active || save?.character?.playerModelOwnerId!==id || row?.id!==id || row.owner!==owner || row.state!=='active') return null;
    return [{op:'assert',key:'save:'+owner,expected:save},{op:'assert',key:modelOwnerKey(id),expected:row},
        {op:'assert',key:modelResetKey,expected:reset}];
}

export async function modelBelongsToAccount(owner:string,id:unknown) {
    return typeof id==='string' && await modelOwnerProof(owner,id)!==null;
}
