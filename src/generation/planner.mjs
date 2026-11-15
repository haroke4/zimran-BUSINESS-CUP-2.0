import { readFile } from 'node:fs/promises';
import { validateSchema } from './engine/model-client.mjs';
import { validateDialogue } from './engine/dialogue.mjs';

const text={type:'string',minLength:1,maxLength:1200};
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const line=obj({speaker:{type:'string',enum:['mara','partner']},text:{...text,maxLength:200},at:{type:'number',minimum:0,maximum:26},duration:{type:'number',minimum:1,maximum:7}});
const caption=obj({start:{type:'number',minimum:0,maximum:29},end:{type:'number',minimum:1,maximum:30},text:{...text,maxLength:350}});
const outline=obj({opening:text,consequence:text,ending:text});
const planSchema=obj({title:{...text,maxLength:100},centralQuestion:text,answer:text,setting:text,
  protagonist:{...text,maxLength:60},partner:{...text,maxLength:60},opening:text,open:outline,leave:outline,
  openLabel:{...text,maxLength:70},leaveLabel:{...text,maxLength:70}});
const blockSchema=obj({title:{...text,maxLength:100},brief:{...text,maxLength:2600},
  partnerVisible:{type:'boolean'},
  captions:{type:'array',items:caption,minItems:4,maxItems:6},
  lines:{type:'array',items:line,maxItems:5},
  audioEvents:{type:'array',items:obj({kind:{type:'string',enum:['knock','door','signal']},at:{type:'number',minimum:0,maximum:28}}),maxItems:5}});

function checkSchema(value,schema) {
  const errors=validateSchema(value,schema);
  if(errors.length)throw new Error(`Invalid episode structure: ${errors.slice(0,3).join('; ')}`);
}

export async function planEpisode(model,{premise,mood,notes}) {
  const reference=await readFile(new URL('./prompts/episode-v5.md',import.meta.url),'utf8');
  const result=await model.generate(`You are the private episode planner for FRAMEBREAK. Plan a coherent short interactive episode: one 30-second opening and two distinct 30-second endings chosen after it. All output story text follows the language of the user's premise. The only choice IDs are open and leave; labels should fit the actual premise, not necessarily literal doors. Preserve requested people, environment, weather and mood. Each branch must start by visibly executing its selected action, preserve established facts, and resolve the central question differently. The hidden answer is never included in the opening scene or choice labels. Choices must be concrete physical actions that can be staged with walking, looking, reaching, speaking, doors, gates, barriers and light changes. Do not require combat or complex acrobatics. Use the following writing reference for causality and dialogue, but follow the compact three-block output schema rather than the reference's block count.\n${reference}`,{premise,mood,notes},planSchema,{label:'episode_plan',maxTokens:2800});
  checkSchema(result.value,planSchema);
  return {...result.value,version:1,branches:{open:{effect:{selectedAction:'open'},...result.value.open},leave:{effect:{selectedAction:'leave'},...result.value.leave}}};
}

export async function writeCurrentBlock(model,plan,branch) {
  if(branch!==null&&!['open','leave'].includes(branch))throw new Error('Unsupported branch');
  const current=branch?plan.branches[branch]:{opening:plan.opening};
  const result=await model.generate(`Write ONLY the current 30-second animated block. Output in the story language. Four concise observable captions at 0–7, 7–14, 14–22, 22–30 seconds, with up to five short spoken lines. Lines cannot overlap. Brief must describe a continuous side-on panorama with the actual location/time/light/materials, specific recognizable landmarks, protagonist's visible action, and only visible character/object states. In an opening, do not reveal the hidden answer or outcomes of future branches, and end at the choice before the action occurs. In an ending, execute previousChoice immediately and show the consequence. Supported visuals: one walking main actor, one standing partner, reaching, looking, talking, door/gate/barrier open/close, practical light changes. Set partnerVisible=false for a voice heard offscreen or when no second person is physically present; otherwise true. Never add a visible duplicate of the protagonist. No visible offscreen characters. Name the protagonist mara and partner partner in speaker IDs. Spoken dialogue is captioned and gestured, with no synthetic voices. Sound kinds support knocks, door creaks and electronic signals; use only when required by this block. Keep the panorama walk achievable within 22 seconds.`,
    {title:plan.title,setting:plan.setting,protagonist:plan.protagonist,partner:plan.partner,centralQuestion:plan.centralQuestion,
      current,previousChoice:branch,...(branch&&{answer:plan.answer}),duration:30},blockSchema,
    {label:'block_writer',maxTokens:2600,validateResult:block=>validateBlock(block)});
  validateBlock(result.value);
  return {...result.value,terminal:Boolean(branch),choices:branch?[]:[{id:'open',label:plan.openLabel},{id:'leave',label:plan.leaveLabel}]};
}

export function validateBlock(block) {
  checkSchema(block,blockSchema);
  const captions=[...block.captions].sort((a,b)=>a.start-b.start);
  if(captions.some((c,i)=>c.end<=c.start||(i&&captions[i-1].end>c.start)))throw new Error('Invalid caption intervals');
  if(block.lines.some(line=>line.at+line.duration>30))throw new Error('Dialogue exceeds block duration');
  validateDialogue({actors:[{id:'mara',name:'Main'},{id:'partner',name:'Partner',x:10}],lines:block.lines},{worldWidth:320});
}
