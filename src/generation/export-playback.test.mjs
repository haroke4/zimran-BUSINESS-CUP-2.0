import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPlayback,assertSafeSvg,compileCaptions } from './export-playback.mjs';
import { makeDemoScene,demoBlock,demoPlan } from './demo.mjs';
import { generatePackage } from './cli.mjs';

test('exports only allowlisted playback and media, never internal prompts or future branches',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'framebreak-export-'));
  try {
    const scene=makeDemoScene(null);
    scene.visualBrief={secret:'PRIVATE_VISUAL_PROMPT'};scene.models=[{rawResponse:'PRIVATE_RAW_RESPONSE'}];scene.futureBranches=demoPlan.branches;
    const block=demoBlock(null);
    const result=await exportPlayback(scene,{sceneId:'opening',outputDir:folder,captions:block.captions,choices:block.choices,audio:false});
    assert.deepEqual(Object.keys(result.playback).sort(),['animationUrl','captions','choices','duration','layers','sceneId','terminal','title','viewport'].sort());
    for(const file of result.mediaFiles) {
      const content=await readFile(join(folder,'opening',file),'utf8');
      assert.doesNotMatch(content,/PRIVATE_VISUAL_PROMPT|PRIVATE_RAW_RESPONSE|heardRecording|Лёва оставил работающую/);
    }
    const animation=JSON.parse(await readFile(join(folder,'opening','animation.json'),'utf8'));
    assert.equal(animation.tracks.length,3);
    assert.ok(animation.camera.length>30);
    assert.ok(animation.camera[0].width<1600);
    for(const track of animation.tracks) {
      assert.ok(track.keyframes.length>0);assert.ok(track.frames.length>0);
      const atlas=await readFile(join(folder,'opening',track.svgUrl.split('/').at(-1)),'utf8');
      for(const {symbol}of track.frames)assert.ok(atlas.includes(`id="${symbol}"`));
    }
    assert.ok(result.playback.captions.some(c=>c.text.startsWith('Смотритель:')));
    assert.equal(result.playback.choices.options.length,2);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('both choices create different terminal scenes, persistent typed effects and non-silent finished audio',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'framebreak-branches-'));
  try {
    const results=[];
    for(const branch of ['open','leave']) {
      const result=await generatePackage({action:'generate',storyId:'story_test',sceneId:branch,outputDir:folder,mode:'demo',branch,state:{plan:demoPlan}});
      results.push(result);
      assert.equal(result.playback.terminal,true);assert.deepEqual(result.playback.choices.options,[]);
      assert.equal(result.internal.facts.doorOpened,branch==='open');
      const wav=await readFile(join(folder,branch,'audio.wav'));
      assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');
      assert.equal((wav.length-44)/44100,30);
      let peak=0;for(let i=44;i<wav.length;i+=2)peak=Math.max(peak,Math.abs(wav.readInt16LE(i)));
      assert.ok(peak>500,'audio must contain audible events');
      assert.deepEqual((await readdir(join(folder,branch))).sort(),result.internal.mediaFiles.slice().sort());
    }
    assert.notDeepEqual(results[0].playback.captions,results[1].playback.captions);
    const openAnimation=JSON.parse(await readFile(join(folder,'open','animation.json'),'utf8'));
    const leaveAnimation=JSON.parse(await readFile(join(folder,'leave','animation.json'),'utf8'));
    assert.ok(openAnimation.tracks[0].frames.length>2);
    assert.equal(leaveAnimation.tracks[0].frames.length,1);
    assert.ok(leaveAnimation.camera.at(-1).x<leaveAnimation.camera[0].x);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('rejects unsafe SVG and invalid media scene identifiers',async()=>{
  for(const value of ['<svg><script>bad()</script></svg>','<svg onload="bad()"/>','<svg><image href="https://bad"/></svg>','<svg><foreignObject/></svg>'])assert.throws(()=>assertSafeSvg(value));
  assert.equal(assertSafeSvg('<svg><path fill="url(#local)"/></svg>'),'<svg><path fill="url(#local)"/></svg>');
  await assert.rejects(exportPlayback(makeDemoScene(),{sceneId:'../private',outputDir:'/tmp'}));
});

test('dialogue captions replace narrative only during speech and preserve deterministic scrubbing',()=>{
  const result=compileCaptions([{start:0,end:10,text:'Narration'}],{actors:[{id:'mara',name:'Мара'}],lines:[{speaker:'mara',at:3,duration:2,text:'Привет'}]});
  assert.deepEqual(result,[{start:0,end:3,text:'Narration'},{start:3,end:5,text:'Мара: Привет'},{start:5,end:10,text:'Narration'}]);
});
