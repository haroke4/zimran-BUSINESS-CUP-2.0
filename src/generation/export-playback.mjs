import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawCommands, skeletonFor, colorToCss } from './rig/render.js';
import { clips } from './rig/animations.js';
import { skins } from './rig/skins.js';
import { resolvePose, solveSkeleton, blendPose, smoothstep } from './rig/rig.js';
import { positionAt, cameraFrame } from './engine/panorama.mjs';
import { compileObjectTimeline, objectContact, objectTransform, commandEnd, reachTime } from './engine/object-timeline.mjs';
import { compileDialogue } from './engine/dialogue.mjs';
import { renderSceneAudio } from './audio-render.mjs';

const NS='http://www.w3.org/2000/svg';
const round=value=>Math.round(value*1000)/1000;
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const strip=svg=>svg.replace(/^<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'');

export function assertSafeSvg(svg) {
  if (/<(?:script|foreignObject|iframe|image|use)\b|\bon\w+\s*=|javascript:|(?:href|src)\s*=/i.test(svg)
    || /url\(\s*['"]?(?:https?:|data:|\/\/)/i.test(svg)) throw new Error('Unsafe exported SVG');
  return svg;
}

function atlasSvg(entries) {
  return `<svg xmlns="${NS}"><defs>${entries.map(([id,content])=>`<g id="${id}">${content}</g>`).join('')}</defs></svg>`;
}

function figureSvg(skin,pose,time) {
  return drawCommands(skin,solveSkeleton(skeletonFor(skin),pose),time).map(command=>
    `<path d="${escape(command.d)}" fill="${command.fill===undefined?'none':colorToCss(command.fill)}" stroke="${command.stroke===undefined?'none':colorToCss(command.stroke)}" stroke-width="${command.width??0}" opacity="${command.alpha??1}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
}

function sampleTimes(duration) { return Array.from({length:duration*12+1},(_,i)=>i/12); }

export function compileCaptions(captions,dialogue) {
  const spoken=(dialogue?.lines??[]).map(line=>({start:line.at,end:line.at+line.duration,
    text:`${dialogue.actors.find(actor=>actor.id===line.speaker)?.name??''}: ${line.text}`}));
  const edges=[...new Set([...captions,...spoken].flatMap(c=>[c.start,c.end]))].sort((a,b)=>a-b);
  const result=[];
  for(let i=0;i<edges.length-1;i++) {
    const start=edges[i],end=edges[i+1];
    const line=spoken.find(c=>c.start<=start&&c.end>=end)??captions.find(c=>c.start<=start&&c.end>=end);
    if(!line)continue;
    if(result.at(-1)?.text===line.text&&result.at(-1).end===start)result.at(-1).end=end;
    else result.push({start,end,text:line.text});
  }
  return result;
}

function actorTrack(scene,participant,index,times,timeline,dialogue,url) {
  const skin=skins.find(s=>s.id===participant.skin)??skins.find(s=>s.id===(index?'morgan':'kit'));
  const metrics=skeletonFor(skin);
  const atlas=new Map(),frames=[],keyframes=[];
  let lastSymbol;
  for(const t of times) {
    const motion=positionAt(scene.staging.route,t);
    const speech=dialogue.frame(t);
    const x=index?participant.x:motion.x;
    const walking=!index&&motion.walking;
    const current=timeline.frame(t);
    const interaction=!index&&current.interaction;
    const speaking=speech.line?.speaker===participant.id;
    const clipName=walking?'walk':interaction?'reach':speaking?'talk':'idle';
    const clip=clips[clipName];
    const phase=Math.floor(((t/clip.duration)%1)*16)/16;
    const poseTime=phase*clip.duration;
    let pose=resolvePose(clip.pose(phase,metrics),metrics);
    let variant=`${clipName}-${Math.round(phase*16)}`;
    if(interaction) {
      const object=scene.objects.find(object=>object.id===interaction.target);
      const elapsed=t-interaction.at;
      const reach=smoothstep(elapsed/reachTime);
      const release=smoothstep((commandEnd(interaction)-t)/.35);
      const idle=resolvePose(clips.idle.pose(phase,metrics),metrics);
      pose=blendPose(idle,resolvePose(clips.reach.pose(Math.min(1,elapsed/clips.reach.duration),metrics),metrics),reach*release);
      const contact=objectContact(object,current.poses.get(object.id));
      pose.handR={x:(contact.x-x)*object.side*10/.95-metrics.handRadius,y:(contact.y-scene.staging.groundY)*10/.95};
      pose.handWeightR=reach*release;
      variant=`interaction-${Math.round(t*12)}`;
    }
    if(!atlas.has(variant))atlas.set(variant,figureSvg(skin,pose,poseTime));
    if(lastSymbol!==variant)frames.push({t:round(t),symbol:variant});
    lastSymbol=variant;
    const primary=motion.x;
    const companion=dialogue.actors.slice(1).find(actor=>actor.visible!==false);
    const facing=index?Math.sign(primary-x)||-1:interaction?scene.objects.find(o=>o.id===interaction.target).side
      :speech.active&&!walking&&companion?Math.sign(companion.x-x)||motion.facing:motion.facing;
    keyframes.push({t:round(t),x:round(x*10),y:round(scene.staging.groundY*10),scaleX:.95*(facing||1),scaleY:.95,rotation:0,opacity:1});
  }
  return {track:{id:`actor-${index}`,svgUrl:url,keyframes,frames},svg:atlasSvg([...atlas])};
}

function objectTrack(scene,object,index,times,timeline,url) {
  const atlas=new Map(),frames=[];
  let previous;
  for(const t of times) {
    const pose=timeline.frame(t).poses.get(object.id);
    const key=JSON.stringify([round(pose.opacity),round(pose.scaleX),round(pose.dy),round(pose.angle??0)]);
    let entry=atlas.get(key);
    if(!entry) {
      const id=`object-${atlas.size}`;
      const transform=objectTransform(object,pose);
      const opening=object.opening;
      const clipId=`opening-${index}`;
      const edgeId=`edge-${index}`;
      const rect=opening?`<rect x="${opening.x}" y="${opening.y}" width="${opening.width}" height="${opening.height}"/>`:'';
      const defs=opening?`<defs><clipPath id="${clipId}">${rect}</clipPath><clipPath id="${edgeId}"><path d="M0 0H${scene.width/10}V90H0Z M${opening.x} ${opening.y}h${opening.width}v${opening.height}h${-opening.width}Z" clip-rule="evenodd"/></clipPath></defs>`:'';
      const recess=opening?rect.replace('/>',` fill="${object.recessColor??'#1a2230'}"/>`):'';
      const fixed=`<g${opening?` clip-path="url(#${edgeId})"`:''}>${strip(object.fixedSvg)}</g>`;
      const moving=`<g${opening?` clip-path="url(#${clipId})"`:''}><g opacity="${round(pose.opacity)}" transform="${transform}">${strip(object.movingSvg)}</g></g>`;
      entry={id,svg:`<g transform="scale(10)">${defs}${recess}${fixed}${moving}</g>`};
      atlas.set(key,entry);
    }
    if(previous!==entry.id)frames.push({t:round(t),symbol:entry.id});
    previous=entry.id;
  }
  return {track:{id:`object-${index}`,svgUrl:url,keyframes:[{t:0,x:0,y:0,scaleX:1,scaleY:1,rotation:0,opacity:1}],frames},svg:atlasSvg([...atlas.values()].map(({id,svg})=>[id,svg]))};
}

export async function exportPlayback(scene,{sceneId,outputDir,captions=[],choices=[],terminal=false,title=scene.title,audio=true}={}) {
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(sceneId))throw new Error('Invalid scene ID');
  const folder=join(outputDir,sceneId);
  await mkdir(folder,{recursive:true});
  const files=[];
  async function save(name,value) {files.push(name);await writeFile(join(folder,name),value);return `/media/${sceneId}/${name}`;}
  const layers=[];
  for(const placement of ['background','foreground']) {
    const content=scene.layers.filter(layer=>(layer.role==='foreground')===(placement==='foreground')).map(layer=>{
      const svg=assertSafeSvg(layer.svg);
      return svg.replace(/^<svg\b/,`<svg x="${layer.x??0}" y="${layer.y??0}" width="${layer.width??scene.width}" height="${layer.height??scene.height}"`);
    }).join('');
    if(content)layers.push({svgUrl:await save(`${placement}.svg`,`<svg xmlns="${NS}" viewBox="0 0 ${scene.width} ${scene.height}">${content}</svg>`),placement});
  }
  const duration=30,times=sampleTimes(duration),dialogue=compileDialogue(scene.dialogue);
  const timeline=compileObjectTimeline(scene.objects,scene.commands);
  const tracks=[];
  for(const [index,object]of (scene.objects??[]).entries()) {
    const filename=`object-${index}.svg`,url=`/media/${sceneId}/${filename}`;
    const result=objectTrack(scene,object,index,times,timeline,url);
    await save(filename,assertSafeSvg(result.svg));tracks.push(result.track);
  }
  const actors=dialogue.actors.length?dialogue.actors.filter(actor=>actor.visible!==false):[{id:'mara',name:'Мара',skin:'kit'}];
  for(const [index,participant]of actors.entries()) {
    const filename=`actor-${index}.svg`,url=`/media/${sceneId}/${filename}`;
    const result=actorTrack(scene,participant,index,times,timeline,dialogue,url);
    await save(filename,assertSafeSvg(result.svg));tracks.push(result.track);
  }
  const camera=times.map(t=>{
    const actor=positionAt(scene.staging.route,t),speech=dialogue.frame(t);
    // A distant standing actor must never drag the camera away from the walker.
    const nearby=actors.slice(1).filter(a=>Math.abs(a.x-actor.x)<=100).map(a=>a.x);
    const frame=cameraFrame(scene.width/10,actor.x,scene.staging.groundY,{zoom:1.8,focusXs:speech.active?nearby:[]});
    return {t:round(t),...Object.fromEntries(Object.entries(frame).map(([key,value])=>[key,round(value*10)]))};
  });
  const animationUrl=await save('animation.json',JSON.stringify({version:1,duration,viewBox:[0,0,scene.width,scene.height],camera,tracks}));
  const audioUrl=`/media/${sceneId}/audio.wav`;
  if(audio){await renderSceneAudio(scene,join(folder,'audio.wav'),duration);files.push('audio.wav');}
  // Deliberate allowlist: no spread of a scene, model result, or internal story object.
  const playback={sceneId,title:String(title).slice(0,120),duration,viewport:{width:1600,height:900},layers,animationUrl,
    ...(audio&&{audioUrl}),captions:compileCaptions(captions,scene.dialogue),
    choices:{revealAt:27,enableAt:30,options:choices.map(c=>({id:c.id,label:c.label}))},terminal:Boolean(terminal)};
  return {playback,mediaFiles:files};
}
