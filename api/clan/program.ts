import type {ApiRequest,ApiResponse} from '../_vercel.js';
import {cors,safeName} from '../_utils.js';
import {authedPlayerOrAdmin} from '../_auth.js';
import {LockContendedError} from '../_lock.js';
import {SaveDebitRefusal} from '../_save-debit-saga.js';
import {actClanProgram,clanProgramView} from './_program.js';

export default async function handler(req:ApiRequest,res:ApiResponse){
    cors(res,req);if(req.method==='OPTIONS')return res.status(200).end();
    if(req.method!=='GET'&&req.method!=='POST')return res.status(405).end();
    const identity=await authedPlayerOrAdmin(req);
    if(!identity)return res.status(401).json({error:'Authentication required.'});
    res.setHeader('Cache-Control','private, no-store');
    try{
        const input=req.method==='GET'?req.query:typeof req.body==='string'?JSON.parse(req.body):req.body??{};
        const name=identity.admin?safeName(String(input.playerName??'')):identity.name;
        if(!name)return res.status(400).json({error:'Choose a current clan member.'});
        return res.status(200).json(req.method==='GET'?{view:await clanProgramView(name)}:await actClanProgram(name,input));
    }catch(error){
        if(error instanceof SaveDebitRefusal)return res.status(error.status).json({error:error.message,...error.details});
        if(error instanceof LockContendedError)return res.status(503).json({error:'The clan Hall is busy. Retry shortly.'});
        console.error('[clan/program]',error);return res.status(500).json({error:'Clan goals could not update. Retry the same action.'});
    }
}
