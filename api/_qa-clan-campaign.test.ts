import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
const previous={...process.env};
process.env.NODE_ENV='test';process.env.SHINOBIX_QA_MEMORY_KV='1';process.env.CLAN_CAMPAIGN_QA='1';process.env.ADMIN_PASSWORD='qa-campaign-unit-admin';
let enabled:typeof import('./_qa-clan-campaign.js').clanCampaignQaEnabled,handler:typeof import('./_qa-clan-campaign.js').default;
let kv:typeof import('./_storage.js').kv;
before(async()=>{({kv}=await import('./_storage.js'));const module=await import('./_qa-clan-campaign.js');enabled=module.clanCampaignQaEnabled;handler=module.default as unknown as typeof handler;});
after(()=>{for(const key of ['NODE_ENV','SHINOBIX_QA_MEMORY_KV','CLAN_CAMPAIGN_QA','ADMIN_PASSWORD']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
async function post(body:Record<string,unknown>,admin=true){
    const out:{status:number;body?:Record<string,unknown>}={status:200};
    const res={setHeader(){},status(status:number){out.status=status;return this;},json(body:Record<string,unknown>){out.body=body;return this;},end(){}};
    await handler({method:'POST',headers:admin?{'x-admin-password':process.env.ADMIN_PASSWORD}:{},body} as never,res as never);return out;
}
test('the campaign fixture requires all three test-only switches and is never enabled in production',()=>{
    assert.equal(enabled({NODE_ENV:'production',SHINOBIX_QA_MEMORY_KV:'1',CLAN_CAMPAIGN_QA:'1'}),false);
    assert.equal(enabled({NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1'}),false);
    assert.equal(enabled({NODE_ENV:'test',CLAN_CAMPAIGN_QA:'1'}),false);
    assert.equal(enabled({NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1',CLAN_CAMPAIGN_QA:'1'}),true);
});
test('even an enabled fixture refuses unauthenticated setup and unregistered, repeated or non-QA identities',async()=>{
    assert.equal((await post({action:'seed-clans'},false)).status,403);
    const clan={name:'qatestazure',members:['missing1','missing2','missing3','missing4']};
    assert.equal((await post({action:'seed-clans',clans:[clan,{...clan,name:'qatestember'}]})).status,409);
    assert.equal(await kv.get('save:clan-qatestazure'),null);
    assert.equal((await post({action:'seed-clans',clans:[{...clan,name:'Azure'},clan]})).status,400);
});
test('the QA route is mounted only in the explicitly enabled disposable server',async()=>{
    const {registerApiRoutes}=await import('../server-api-routes.js');
    const paths=()=>{const routes=new Set<string>();registerApiRoutes(path=>routes.add(path));return routes;};
    assert.equal(paths().has('/_qa/clan-campaign'),true);
    delete process.env.CLAN_CAMPAIGN_QA;assert.equal(paths().has('/_qa/clan-campaign'),false);
    process.env.CLAN_CAMPAIGN_QA='1';process.env.NODE_ENV='production';assert.equal(paths().has('/_qa/clan-campaign'),false);process.env.NODE_ENV='test';
});
