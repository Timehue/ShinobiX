import assert from 'node:assert/strict';

export const postgresCommand=(name,database,password,args)=>[
 'exec','--env','PGPASSWORD='+password,name,'psql','-X','-h','127.0.0.1','-U','wb_qual','-d',database,'-v','ON_ERROR_STOP=1',...args,
];

// The image's initialization server accepts Unix sockets before the final TCP server starts.
export async function waitForPostgres({docker,name,database,password,timeoutMs=60000,now=Date.now,pause=ms=>new Promise(done=>setTimeout(done,ms))}){
 const deadline=now()+timeoutMs;
 for(;;){
  try{assert.equal(docker(postgresCommand(name,database,password,['-tAqc','SELECT 1']),{timeout:Math.max(1,Math.min(5000,deadline-now()))}).trim(),'1');return;}catch{}
  assert.ok(now()<deadline,'Disposable Postgres authenticated TCP startup timed out');
  await pause(250);
 }
}
