import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {docker,loadImage,pins} from './images.mjs';
import {qualify} from './scenarios.mjs';
const[artifactArg,outputArg]=process.argv.slice(2);assert.ok(artifactArg&&outputArg,'Supply artifact directory and output directory');
const artifacts=resolve(artifactArg),output=resolve(outputArg),root=import.meta.dirname;mkdirSync(output,{recursive:true});
const nonce=randomBytes(6).toString('hex'),prefix='wbqual-'+nonce,network=prefix,pgName=prefix+'-pg',database='wbqual_'+nonce,password=randomBytes(24).toString('hex'),secret=randomBytes(32).toString('hex'),created=[];
const result={startedAt:new Date().toISOString(),productionAccess:false,scope:'New retained synthetic-build images, not Railway source rebuild',images:{},runtime:[],checks:[]};
const wait=ms=>new Promise(done=>setTimeout(done,ms));let networkCreated=false;
const control=(runtime,input)=>{const text=docker(['exec','--interactive',runtime.name,'node','/qualification/control.cjs'],{input:JSON.stringify(input)});const line=text.split(/\r?\n/).find(x=>x.startsWith('QUALIFICATION_RESULT '));assert.ok(line,'Missing fixture result');return JSON.parse(line.slice(21));};
const env=['DATABASE_URL=postgresql://wb_qual:'+password+'@'+pgName+':5432/'+database,'PG_SSL=disable','SESSION_SECRET='+secret,'QUALIFICATION_DISPOSABLE=1','DISABLE_SCHEDULED_JOBS=1','DISABLE_SNAPSHOT_CRON=1','DISABLE_PRESENCE_STATE_JOBS=1','DISABLE_COMBAT_RECEIPTS=1','PORT=3000'];
async function start(role){
 const image=result.images[role],name=prefix+'-'+role+'-'+created.length;
 created.push(name);docker(['run','--detach','--name',name,'--network',network,'--read-only','--tmpfs','/tmp:rw,nosuid,noexec,size=64m','--cap-drop','ALL','--security-opt','no-new-privileges','--publish','127.0.0.1::3000','--mount','type=bind,src='+root+',dst=/qualification,readonly',...env.flatMap(x=>['--env',x]),image.imageId]);
 const inspect=JSON.parse(docker(['container','inspect',name]))[0];assert.equal(inspect.Image,image.imageId);assert.equal(inspect.Config.User,'node');assert.deepEqual(inspect.Config.Cmd,['node','dist/server.js']);assert.deepEqual(inspect.Config.Entrypoint,['docker-entrypoint.sh']);
 assert.deepEqual(Object.keys(inspect.NetworkSettings.Networks),[network]);
 assert.ok(inspect.Mounts.every(m=>(m.Type==='bind'&&m.Destination==='/qualification'&&!m.RW)||(m.Type==='tmpfs'&&m.Destination==='/tmp')),'No application filesystem overlay allowed');
 const binding=inspect.NetworkSettings.Ports['3000/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');const port=binding.HostPort,base='http://127.0.0.1:'+port;
 let health;const deadline=Date.now()+60000;for(;;){try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(2000)});if(r.status===200){health=await r.json();break;}}catch{}assert.ok(Date.now()<deadline,'Image health timed out');await wait(250);}
 const node=docker(['exec',name,'node','--version']).trim();assert.equal(node,'v'+pins.node);assert.equal(health.commit,pins[role]);
 const pid1=JSON.parse(docker(['exec',name,'node','-e',"const fs=require('node:fs');console.log(JSON.stringify({command:fs.readFileSync('/proc/1/cmdline','utf8').split('\\0').filter(Boolean),executable:fs.readlinkSync('/proc/1/exe'),uid:process.getuid()}))"]));
 assert.deepEqual(pid1.command,['node','dist/server.js']);assert.equal(pid1.uid,1000);assert.equal(pid1.executable,'/usr/local/bin/node');
 const evidence={role,imageId:inspect.Image,node,pid1,defaultCommand:true,user:inspect.Config.User,readOnlyRoot:inspect.HostConfig.ReadonlyRootfs,healthCommit:health.commit};assert.equal(evidence.readOnlyRoot,true);result.runtime.push(evidence);return{name,base};
}
async function stop(runtime){
 docker(['stop','--time','65',runtime.name]);assert.equal(JSON.parse(docker(['container','inspect',runtime.name]))[0].State.Running,false);
 const deadline=Date.now()+5000;for(;;){const sessions=docker(['exec',pgName,'psql','-U','wb_qual','-d',database,'-tAc',"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"]);if(Number(sessions.trim())===0)break;assert.ok(Date.now()<deadline,'Stopped image retains database sessions');await wait(100);}
 result.runtime.at(-1).retiredAndNoDatabaseSessions=true;
}
try{
 for(const role of['candidate','recovery'])result.images[role]=loadImage(join(artifacts,role),role);
 assert.equal(result.images.candidate.schemaSha256,result.images.recovery.schemaSha256);
 docker(['network','create','--internal',network]);networkCreated=true;
 assert.equal(JSON.parse(docker(['network','inspect',network]))[0].Internal,true);
 docker(['pull','postgres:16'],{stdio:'inherit'});const pgImage=JSON.parse(docker(['image','inspect','postgres:16']))[0];result.postgres={imageId:pgImage.Id,repoDigests:pgImage.RepoDigests};
 created.push(pgName);docker(['run','--detach','--name',pgName,'--network',network,'--mount','type=bind,src='+join(artifacts,'candidate')+',dst=/fixture-schema,readonly','--env','POSTGRES_DB='+database,'--env','POSTGRES_USER=wb_qual','--env','POSTGRES_PASSWORD='+password,pgImage.Id]);
 const pgContainer=JSON.parse(docker(['container','inspect',pgName]))[0];assert.deepEqual(Object.keys(pgContainer.NetworkSettings.Networks),[network]);assert.ok(Object.values(pgContainer.NetworkSettings.Ports).every(binding=>binding===null));
 const deadline=Date.now()+60000;for(;;){try{docker(['exec',pgName,'pg_isready','-U','wb_qual','-d',database]);break;}catch{assert.ok(Date.now()<deadline,'Disposable Postgres startup timed out');await wait(250);}}
 result.postgres.version=docker(['exec',pgName,'postgres','--version']).trim();assert.match(result.postgres.version,/PostgreSQL\) 16\./);
 docker(['exec',pgName,'psql','-U','wb_qual','-d',database,'-v','ON_ERROR_STOP=1','-f','/fixture-schema/schema.sql']);
 Object.assign(result,await qualify({start,stop,control}));
}catch(error){result.failed=1;result.checks=error.qualificationChecks??[];result.error=String(error.stack??error);process.exitCode=1;}
finally{
 const redact=text=>String(text).replaceAll(password,'[synthetic-password]').replaceAll(secret,'[synthetic-session-secret]');
 const diagnostics=[];for(const name of created){
  try{const state=JSON.parse(docker(['container','inspect','--format','{{json .State}}',name]));diagnostics.push({name,state});}catch{diagnostics.push({name,stateUnavailable:true});}
  const logs=spawnSync('docker',['logs','--timestamps',name],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024,windowsHide:true});
  writeFileSync(join(output,name+'.log'),redact(String(logs.stdout??'')+'\n'+String(logs.stderr??'')));diagnostics.at(-1).logsCaptured=logs.status===0;
 }
 result.diagnostics=diagnostics;
 const errors=[];for(const name of created.reverse()){try{docker(['rm','--force','--volumes',name]);}catch(error){errors.push('Container cleanup failed: '+name);}}
 if(networkCreated)try{docker(['network','rm',network]);}catch{errors.push('Network cleanup failed');}
 result.cleanup={complete:errors.length===0,errors};if(errors.length){result.failed=1;process.exitCode=1;}result.finishedAt=new Date().toISOString();const report=redact(JSON.stringify(result,null,2));writeFileSync(join(output,'qualification.json'),report+'\n');console.log(report);
}
