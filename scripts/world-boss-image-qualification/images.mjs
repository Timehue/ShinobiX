import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,openSync,readSync,closeSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const pins=JSON.parse(readFileSync(new URL('./pins.json',import.meta.url)));
export const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,...options});
export function hashFile(path){const hash=createHash('sha256'),file=openSync(path,'r'),buffer=Buffer.alloc(1024*1024);try{for(;;){const size=readSync(file,buffer,0,buffer.length,null);if(!size)break;hash.update(buffer.subarray(0,size));}}finally{closeSync(file);}return hash.digest('hex');}
export function validateImage(inspect,role){
 assert.ok(['candidate','recovery'].includes(role));assert.match(inspect.Id,/^sha256:[a-f0-9]{64}$/);
 assert.equal(inspect.Os,'linux');assert.equal(inspect.Architecture,'amd64');
 assert.equal(inspect.Config.User,'node');assert.equal(inspect.Config.WorkingDir,'/app');assert.deepEqual(inspect.Config.Cmd,['node','dist/server.js']);
 assert.deepEqual(inspect.Config.Entrypoint,['docker-entrypoint.sh']);
 assert.equal(inspect.Config.Labels?.['org.opencontainers.image.revision'],pins[role]);
 assert.ok(inspect.Config.Env.includes('NODE_ENV=production'));assert.ok(inspect.Config.Env.includes('BUILD_COMMIT='+pins[role]));
 return true;
}
export function loadImage(directory,role){
 const record=JSON.parse(readFileSync(join(directory,'identity.json')));assert.equal(record.role,role);assert.equal(record.source,pins[role]);
 assert.equal(hashFile(join(directory,'image.tar')),record.archiveSha256,'Image archive checksum mismatch');
 assert.equal(hashFile(join(directory,'schema.sql')),record.schemaSha256,'Fixture schema checksum mismatch');
 docker(['image','load','--input',join(directory,'image.tar')]);
 const inspect=JSON.parse(docker(['image','inspect',record.imageId]))[0];validateImage(inspect,role);assert.equal(inspect.Id,record.imageId);
 assert.deepEqual(inspect.RootFS.Layers,record.layers);return record;
}
export function buildImage(role,source,output){
 assert.ok(['candidate','recovery'].includes(role));source=resolve(source);output=resolve(output);mkdirSync(output,{recursive:true});
 const revision=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(revision,pins[role]);
 assert.equal(readFileSync(join(source,'.nvmrc'),'utf8').trim(),pins.node);
 const tag='wb-qualification-'+role+':'+revision;
 const publicArgs={VITE_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic-public-qualification-key',VITE_SENTRY_DSN:'',VITE_SENTRY_RELEASE:'qualification-'+revision,VITE_BUILD_COMMIT:revision,VITE_PRODUCT_ANALYTICS_ENABLED:'false',VITE_PRODUCT_ANALYTICS_PROVIDER:'',VITE_POSTHOG_KEY:'',VITE_POSTHOG_HOST:''};
 docker(['build','--platform',pins.platform,'--progress=plain','--build-arg','BUILD_COMMIT='+revision,'--label','org.opencontainers.image.revision='+revision,...Object.entries(publicArgs).flatMap(([key,value])=>['--build-arg',key+'='+value]),'--tag',tag,'.'],{cwd:source,stdio:'inherit',timeout:3600000});
 const inspect=JSON.parse(docker(['image','inspect',tag]))[0];validateImage(inspect,role);
 const node=docker(['run','--rm','--network','none','--entrypoint','node',inspect.Id,'--version']).trim();assert.equal(node,'v'+pins.node);
 const schema=readFileSync(join(source,'supabase-schema.sql'),'utf8').replaceAll('\r\n','\n');let selected='';
 for(const[from,to]of[['create table if not exists public.kv_store (','\n);'],...['kv_set_nx','kv_compare_set','kv_incr','kv_hset','kv_hdel'].map(n=>[`create or replace function public.${n}(`,'\n$$;'])]){const start=schema.indexOf(from),end=schema.indexOf(to,start);assert.ok(start>=0&&end>start,'Pinned schema block missing');selected+=schema.slice(start,end+to.length)+'\n';}
 writeFileSync(join(output,'schema.sql'),selected);docker(['image','save','--output',join(output,'image.tar'),inspect.Id]);
 const record={role,source:revision,platform:pins.platform,imageId:inspect.Id,registryManifestDigest:null,archiveSha256:hashFile(join(output,'image.tar')),schemaSha256:hashFile(join(output,'schema.sql')),dockerfileSha256:hashFile(join(source,'Dockerfile')),rootLockSha256:hashFile(join(source,'package-lock.json')),clientLockSha256:hashFile(join(source,'shinobij.client/package-lock.json')),node,config:{user:inspect.Config.User,workingDir:inspect.Config.WorkingDir,entrypoint:inspect.Config.Entrypoint,cmd:inspect.Config.Cmd},layers:inspect.RootFS.Layers,baseImageReference:'node:24.21.0-bookworm-slim',buildArgs:publicArgs,qualified:false,railwayImage:false};
 writeFileSync(join(output,'identity.json'),JSON.stringify(record,null,2)+'\n');return record;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[command,role,source,output]=process.argv.slice(2);assert.equal(command,'build');console.log(JSON.stringify(buildImage(role,source,output),null,2));
}
