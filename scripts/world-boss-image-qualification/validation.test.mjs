import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pins,validateImage,loadImage,hashFile} from './images.mjs';
const fixture=()=>({Id:'sha256:'+'a'.repeat(64),Os:'linux',Architecture:'amd64',RootFS:{Layers:['sha256:'+'b'.repeat(64)]},Config:{User:'node',WorkingDir:'/app',Cmd:['node','dist/server.js'],Entrypoint:['docker-entrypoint.sh'],Labels:{'org.opencontainers.image.revision':pins.candidate},Env:['NODE_ENV=production','BUILD_COMMIT='+pins.candidate]}});
test('valid pinned compiled-server image configuration is accepted',()=>assert.equal(validateImage(fixture(),'candidate'),true));
for(const[field,value]of[['Id','invalid'],['Os','windows'],['Architecture','arm64']])test('reject incorrect '+field,()=>{const image=fixture();image[field]=value;assert.throws(()=>validateImage(image,'candidate'));});
for(const[field,value]of[['User','root'],['WorkingDir','/tmp'],['Cmd',['node','fixture.js']],['Entrypoint',[]],['Labels',{'org.opencontainers.image.revision':'0'.repeat(40)}],['Env',['NODE_ENV=test']]])test('reject incorrect runtime '+field,()=>{const image=fixture();image.Config[field]=value;assert.throws(()=>validateImage(image,'candidate'));});
test('wrong recovery identity is rejected',()=>assert.throws(()=>validateImage(fixture(),'recovery')));
for(const tamper of['archive','schema'])test('reject altered '+tamper+' before invoking Docker',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wb-image-check-'));try{
  writeFileSync(join(dir,'image.tar'),'synthetic image archive');writeFileSync(join(dir,'schema.sql'),'synthetic schema');
  const record={role:'candidate',source:pins.candidate,archiveSha256:hashFile(join(dir,'image.tar')),schemaSha256:hashFile(join(dir,'schema.sql'))};writeFileSync(join(dir,'identity.json'),JSON.stringify(record));
  writeFileSync(join(dir,tamper==='archive'?'image.tar':'schema.sql'),'altered');assert.throws(()=>loadImage(dir,'candidate'),/checksum mismatch/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('workflow permits scoped same-repository PR execution without publication or secrets',()=>{
 const local=new URL('./workflow.yml',import.meta.url);const workflow=readFileSync(existsSync(local)?local:new URL('../../.github/workflows/world-boss-image-qualification.yml',import.meta.url),'utf8');assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/pull_request:/);assert.match(workflow,/head\.repo\.full_name == github\.repository/);assert.doesNotMatch(workflow,/pull_request_target:|workflow_run:|push:|secrets\.|packages:|contents: write|railway up|docker push|node-version:/);
 assert.match(workflow,/node-version-file: \.nvmrc/);assert.match(workflow,/actions\/upload-artifact@v7/);assert.match(workflow,/actions\/download-artifact@v8/);assert.match(workflow,/if-no-files-found: error/);
 assert.equal((workflow.match(/uses: actions\/checkout@v7/g)||[]).length,(workflow.match(/persist-credentials: false/g)||[]).length);
 assert.match(workflow,/artifact-ids: \$\{\{ needs\.retain\.outputs\.candidate_artifact_id \}\}/);assert.match(workflow,/artifact-ids: \$\{\{ needs\.retain\.outputs\.recovery_artifact_id \}\}/);
});
