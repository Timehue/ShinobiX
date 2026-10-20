import type {Page} from '@playwright/test';

declare global {interface Window {dateOnlyClock:{set:(epoch:number)=>void;proof:()=>Record<string,boolean>}}}

/** Control the scenario's epoch across navigation without replacing native frames or timers. */
export async function installDateOnlyClock(page:Page,epoch:number){
    if(!Number.isSafeInteger(epoch))throw Error('Date-only clock needs an integer epoch');
    await page.addInitScript({content:`(()=>{
        const NativeDate=Date,originalNow=NativeDate.now.bind(NativeDate),key='qa.date-only-clock';
        const api={raf:requestAnimationFrame,cancel:cancelAnimationFrame,timeout:setTimeout,interval:setInterval,clearTimeout,clearInterval,performance,performanceNow:performance.now};
        let base=Number(sessionStorage.getItem(key)??${JSON.stringify(epoch)}),realStart=originalNow();
        const now=()=>Math.floor(base+originalNow()-realStart);
        window.Date=new Proxy(NativeDate,{
            apply:()=>new NativeDate(now()).toString(),
            construct:(target,args,newTarget)=>Reflect.construct(target,args.length?args:[now()],newTarget),
            get:(target,key,receiver)=>key==='now'?now:Reflect.get(target,key,receiver),
        });
        window.dateOnlyClock={set:epoch=>{base=epoch;realStart=originalNow();sessionStorage.setItem(key,String(epoch));},proof:()=>({
            noPlaywrightClock:!('__pwClock'in window),nativeRAF:requestAnimationFrame===api.raf,nativeCancellation:cancelAnimationFrame===api.cancel,
            nativeTimeout:setTimeout===api.timeout,nativeInterval:setInterval===api.interval,nativeClearTimeout:clearTimeout===api.clearTimeout,nativeClearInterval:clearInterval===api.clearInterval,
            nativePerformance:performance===api.performance&&performance.now===api.performanceNow,
        })};
    })();`});
}

export async function setDateOnlyClock(page:Page,epoch:number){
    if(!Number.isSafeInteger(epoch))throw Error('Date-only clock needs an integer epoch');
    await page.evaluate(epoch=>window.dateOnlyClock.set(epoch),epoch);
}
