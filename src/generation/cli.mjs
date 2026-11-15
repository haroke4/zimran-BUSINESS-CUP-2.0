import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { exportPlayback } from './export-playback.mjs';
import { demoPlan,demoBlock,makeDemoScene } from './demo.mjs';
import { createSceneModel } from './engine/model-router.mjs';
import { generateScene } from './engine/scene.mjs';
import { planEpisode,writeCurrentBlock } from './planner.mjs';
import { commandEnd } from './engine/object-timeline.mjs';

for(const file of [new URL('../../.env',import.meta.url),new URL('./.env',import.meta.url)]) {
  try {
    const values=parseEnv(await readFile(file,'utf8'));
    for(const[key,value]of Object.entries(values))if(process.env[key]===undefined)process.env[key]=value;
  }catch(error){if(error.code!=='ENOENT')throw error;}
}

export async function generatePackage(input) {
  if(input.action!=='generate'||!input.outputDir||!input.storyId)throw new Error('Invalid generation request');
  const branch=input.branch??null;
  if(branch!==null&&!['open','leave'].includes(branch))throw new Error('Invalid branch');
  const mode=input.mode??'live';
  if(!['live','demo'].includes(mode))throw new Error('Invalid generation mode');
  let scene,block,plan;
  if(mode==='demo') {
    plan=input.state?.plan??demoPlan;
    block=demoBlock(branch);scene=makeDemoScene(branch);
  }else {
    const model=createSceneModel(process.env,{logger:{warn:message=>console.error(message)}});
    plan=input.state?.plan??await planEpisode(model,input);
    block=await writeCurrentBlock(model,plan,branch);
    scene=await generateScene(model,block.brief,undefined,{screens:2});
    const maximum=Math.max(...scene.staging.route.map(l=>l.arrivalAt),...(scene.commands??[]).map(commandEnd));
    if(maximum>22) {
      const scale=22/maximum;
      for(const leg of scene.staging.route){leg.departureAt*=scale;leg.arrivalAt*=scale;}
      for(const command of scene.commands??[]){command.at*=scale;command.duration*=scale;if(command.period)command.period*=scale;}
    }
    scene.dialogue={actors:[{id:'mara',name:plan.protagonist,skin:'kit'},
      {id:'partner',name:plan.partner,skin:'morgan',visible:block.partnerVisible,x:Math.max(8,Math.min(scene.width/10-8,scene.staging.stopX+18))}],lines:block.lines};
    scene.audioEvents=block.audioEvents;
  }
  const {playback,mediaFiles}=await exportPlayback(scene,{sceneId:input.sceneId,outputDir:input.outputDir,
    captions:block.captions,choices:block.choices,terminal:block.terminal,title:block.title});
  return {playback,internal:{version:1,mode,plan,currentBranch:branch,
    facts:branch?{...(input.state?.facts??{}),...plan.branches[branch].effect}:{},mediaFiles}};
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]) {
  try {
    let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>1000000)throw new Error('Input too large');}
    const result=await generatePackage(JSON.parse(text));
    process.stdout.write(JSON.stringify(result));
  }catch(error){
    console.error('[generation]',error.stack??error.message);
    process.exitCode=1;
  }
}
