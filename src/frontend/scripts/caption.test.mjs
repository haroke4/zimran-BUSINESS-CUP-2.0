import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {captionTimeline,captionFrame,CaptionSoundGate} from '../src/lib/caption.ts';

test('speaker is immediate, graphemes are intact, and scrubbing is deterministic',()=>{
 const line=captionTimeline({start:3,end:8,text:'Мара: Привет 👋🏽 е́!'});
 assert.equal(captionFrame(line,3).text,'Мара: ');
 assert.equal(captionFrame(line,3.05).text,'Мара: П');
 assert(line.glyphs.includes('👋🏽'));assert(line.glyphs.includes('е́'));
 assert.equal(captionFrame(line,4).text,line.text);
 assert.deepEqual(captionFrame(line,3.05),captionFrame(line,3.05));
 assert.equal(captionFrame(line,3,true).text,line.text);
});

test('long lines finish early enough to read, with a pause after punctuation',()=>{
 const long=captionTimeline({start:0,end:2,text:'Мара: '+ 'Длинная реплика '.repeat(25)});
 assert.equal(captionFrame(long,1.31).complete,true);
 assert.equal(captionFrame(long,0).complete,false);
 const punctuation=captionTimeline({start:0,end:10,text:'Да, хорошо.'});
 assert(punctuation.revealAt[3]-punctuation.revealAt[2] > punctuation.revealAt[1]-punctuation.revealAt[0]);
});

test('sound is sparse and skips punctuation, mute, pause, seeks and stalled frames',()=>{
 const line=captionTimeline({start:0,end:10,text:'abcdefghijklmnopqrstuvwxyz'.repeat(4)});
 const gate=new CaptionSoundGate();
 const advance=(time,count,enabled=true)=>gate.advance({line,time,count},enabled);
 assert.equal(advance(0,0),false);
 assert.equal(advance(.03,1),true);
 assert.equal(advance(.06,2),false);
 assert.equal(advance(.14,5),true);
 assert.equal(advance(2.5,80),false,'no forward-seek backlog');
 assert.equal(advance(.04,1),false,'no backward-seek sound');
 assert.equal(advance(.08,2,false),false,'paused or muted');
 assert.equal(advance(.09,2),false,'unmuting does not replay letters');
 assert.equal(advance(.12,4),true);
 gate.reset();assert.equal(advance(1,33),false,'seeking establishes a silent baseline');
 const punctuation=captionTimeline({start:0,end:4,text:'...'});
 gate.reset();assert.equal(gate.advance({line:punctuation,time:.04,count:1},true),false);
});

test('finished audio sample is short, quiet, and fades to silence at both ends',async()=>{
 const wav=await readFile(new URL('../../static/audio/text-tap-v1.wav',import.meta.url));
 assert.equal(wav.toString('ascii',0,4),'RIFF');
 const rate=wav.readUInt32LE(24),samples=(wav.length-44)/2;
 assert.equal(samples/rate,.045);
 let peak=0;for(let i=44;i<wav.length;i+=2)peak=Math.max(peak,Math.abs(wav.readInt16LE(i)));
 assert(peak<=3277 && peak>=3000);
 assert.equal(wav.readInt16LE(44),0);
 assert(Math.abs(wav.readInt16LE(wav.length-2))<5);
});
