/* Dry run by default. --apply removes only verified replacements in the two
 * Chronicle runtime folders; --check guards against reintroducing them. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {CHRONICLE_PAINTED_ART,CHRONICLE_PAINTED_FIGURES}=require('../shared/chronicle-painted-art.ts');
const {chronicleLegacyArtTarget}=require('../shared/chronicle-legacy-art.ts');
const root=path.resolve(__dirname,'..'),publicRoot=path.join(root,'shinobij.client/public');
const base=path.join(root,'shinobij.client/art-source/chronicle-refresh');
const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const active=new Set();
for(const row of manifest.cards){
    if(row.status!=='packaged'||row.visualReview?.runtimeSha256!==row.runtimeSha256||row.visualReview?.result!=='accepted')throw Error('Unreviewed replacement: '+row.id);
    if(CHRONICLE_PAINTED_ART[row.id]!==row.runtimePath)throw Error('Registry differs: '+row.id);
    for(const [url,sha] of [[row.runtimePath,row.runtimeSha256],[row.smallPath,row.smallSha256]]){
        if(!url?.startsWith('/chronicle/cards/')||digest(path.join(publicRoot,url))!==sha)throw Error('Invalid replacement: '+url);
        active.add(url);
    }
    if(row.needsFigures){
        if(row.figureVisualReview?.result!=='accepted')throw Error('Unreviewed figure: '+row.id);
        for(const direction of ['front','back']){
            const figure=row.figures?.[direction];
            if(!figure||CHRONICLE_PAINTED_FIGURES[row.id]?.[direction]!==figure.runtimePath||row.figureVisualReview[direction+'Sha256']!==figure.sha256||digest(path.join(publicRoot,figure.runtimePath))!==figure.sha256)throw Error('Invalid figure: '+row.id+' '+direction);
            active.add(figure.runtimePath);
        }
    }
}
const files=[];
for(const folder of ['cards','figures']){
    const allowed=path.resolve(publicRoot,'chronicle',folder);
    for(const entry of fs.readdirSync(allowed,{withFileTypes:true})){
        const url='/chronicle/'+folder+'/'+entry.name;
        if(active.has(url))continue;
        const target=chronicleLegacyArtTarget(url);
        if(!target||!active.has(target))throw Error('Unrecognized asset; inspect rather than delete: '+url);
        const absolute=path.resolve(allowed,entry.name);
        if(!entry.isFile()||entry.isSymbolicLink()||path.dirname(absolute)!==allowed)throw Error('Unsafe removal target: '+absolute);
        files.push({url,target,bytes:fs.statSync(absolute).size,sha256:digest(absolute)});
    }
}
const report={files:files.length,bytes:files.reduce((sum,f)=>sum+f.bytes,0),assets:files};
if(process.argv.includes('--check')){
    console.log(JSON.stringify({obsoleteFiles:report.files,bytes:report.bytes}));
    if(files.length)process.exitCode=1;
}else if(process.argv.includes('--apply')){
    // Refuse to discard uncommitted edits: every removed byte must be recoverable
    // from HEAD. Check the complete list before deleting any files.
    for(const file of files){
        const relative='shinobij.client/public'+file.url;
        const committed=execFileSync('git',['show','HEAD:'+relative],{cwd:root,maxBuffer:20*1024*1024,windowsHide:true});
        if(crypto.createHash('sha256').update(committed).digest('hex')!==file.sha256)throw Error('Uncommitted asset changes: '+relative);
    }
    fs.mkdirSync(path.join(base,'review'),{recursive:true});
    if(files.length)fs.writeFileSync(path.join(base,'review/obsolete-art-removal.json'),JSON.stringify(report,null,2)+'\n');
    for(const file of files)fs.unlinkSync(path.resolve(publicRoot,'.'+file.url));
    console.log(JSON.stringify({removed:report.files,bytesFreed:report.bytes}));
}else console.log(JSON.stringify({candidates:report.files,bytes:report.bytes,example:files.slice(0,5)},null,2));
