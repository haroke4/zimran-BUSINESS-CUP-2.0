import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
const requireGeneration=createRequire(new URL('../../generation/package.json',import.meta.url));
const {chromium}=requireGeneration('playwright');
const base=process.env.STORYFORK_BASE_URL||'http://127.0.0.1:18080';
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(process.platform==='darwin'&&existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
 const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__tapEvents=[];window.__tapBlocked=[];
  const play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){
   const tap=this.src.includes('text-tap-v1.wav')&&!this.muted&&this.volume>0;
   if(tap)window.__tapEvents.push({time:document.querySelector('main audio')?.currentTime,volume:this.volume});
   const result=play.call(this);
   if(tap)result.catch(e=>{if(e.name==='NotAllowedError')window.__tapBlocked.push(e.message)});
   return result;
  };
 });
 let storyId=process.env.STORYFORK_TEST_STORY;
 if(!storyId){
  const response=await context.request.post(base+'/api/stories',{data:{premise:'A quiet corridor and a familiar knock.',mode:'demo'}});
  assert.equal(response.status(),202,await response.text());
  const ticket=await response.json();storyId=ticket.storyId;
  for(let i=0;i<90;i++){
   const job=await(await context.request.get(base+'/api/jobs/status?job_id='+ticket.jobId)).json();
   if(job.status==='failed')throw new Error(job.error);
   if(job.status==='ready')break;
   await new Promise(r=>setTimeout(r,500));
  }
 }
 await page.goto(base+'/app?story='+storyId);
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Play"]')?.disabled===false);
 async function seek(time){
  await page.getByRole('slider',{name:'Playback position'}).focus();await page.keyboard.press('Home');
  for(let i=0;i<Math.round(time*10);i++)await page.keyboard.press('ArrowRight');
 }
 await seek(22);
 const caption=page.locator('.caption-visible');
 assert.equal(await caption.textContent(),'Смотритель: ');
 const before=await page.locator('.player-caption').boundingBox();
 const initialTicks=await page.evaluate(()=>window.__tapEvents.length);
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('main audio').currentTime>22.65);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 const partial=await caption.textContent();assert(partial.length>12);
 const full=await page.locator('.caption-placeholder').textContent();assert(partial.length<full.length);
 const count=await page.evaluate(()=>window.__tapEvents.length);assert(count-initialTicks>=3&&count-initialTicks<=9);
 const after=await page.locator('.player-caption').boundingBox();assert.equal(before.height,after.height);assert.equal(before.y,after.y);
 const paused=await caption.textContent();await page.waitForTimeout(200);assert.equal(await caption.textContent(),paused);
 await seek(22);assert.equal(await caption.textContent(),'Смотритель: ');
 assert.equal(await page.evaluate(()=>window.__tapEvents.length),count,'paused seeking must be silent');
 await page.getByRole('button',{name:'Mute',exact:true}).click();
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('main audio').currentTime>22.5);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__tapEvents.length),count,'muted typing must be silent');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(expected=>document.querySelector('.caption-visible')?.textContent===expected,full);
 assert.equal(await caption.textContent(),full);
 const volumes=await page.evaluate(()=>window.__tapEvents.map(e=>e.volume));assert(volumes.every(v=>v<=.26));
 assert.deepEqual(await page.evaluate(()=>window.__tapBlocked),[]);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({typing:'ok',speaker:'immediate',quietSample:'ok',pause:'ok',seek:'ok',mute:'ok',stableLayout:'ok',reducedMotion:'ok',ticks:count,errors}));
 await context.close();
}finally{await browser.close()}
