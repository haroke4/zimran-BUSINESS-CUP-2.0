import { SceneSound } from './engine/sound-engine.mjs';
import { footfallsBetween } from './engine/sound-plan.mjs';

// This module executes only inside the private offline renderer, never the player.
export async function renderAudio(scene, duration = 30) {
  const rate = 22050;
  const context = new OfflineAudioContext(1, Math.ceil(rate * duration), rate);
  const sound = new SceneSound();
  sound.context = context;
  sound.master = context.createGain();
  sound.master.gain.value = 0.65;
  sound.master.gain.setValueAtTime(0.65,Math.max(0,duration-.25));
  sound.master.gain.linearRampToValueAtTime(0,duration);
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.ratio.value = 8;
  sound.master.connect(limiter).connect(context.destination);
  sound.noise = context.createBuffer(1, rate * 2, rate);
  const noise = sound.noise.getChannelData(0);
  let seed = 17487;
  for (let i = 0; i < noise.length; i++) {
    seed = (seed * 16807) % 2147483647;
    noise[i] = seed / 1073741823.5 - 1;
  }
  sound.start(scene, 0, duration);
  for (const {at, index} of footfallsBetween(scene.staging.route, 0.12, duration)) sound.step(at, index);
  if (sound.plan.ambience === 'forest') {
    for (let at = 3; at < duration - 1; at += 6) {
      sound.tone(at, .15, 2100, .012, 2600);
      sound.tone(at + .2, .12, 2400, .009, 2000);
    }
  }
  for (const event of scene.audioEvents ?? []) {
    if (event.kind === 'knock') {
      for (const offset of [0,.23,.46,1.12,1.35]) {
        sound.noiseVoice(event.at + offset, .08, 480, .20, {type:'bandpass'});
        sound.tone(event.at + offset, .09, 150, .10, 80);
      }
    } else if (event.kind === 'door') {
      sound.noiseVoice(event.at, 1.1, 620, .17, {type:'bandpass'});
      sound.tone(event.at, .95, 190, .045, 390);
      sound.noiseVoice(event.at + 1, .15, 300, .14);
    } else if (event.kind === 'signal') {
      sound.tone(event.at, .15, 760, .055);
      sound.tone(event.at + .3, .15, 980, .055);
    }
  }
  const buffer = await context.startRendering();
  const samples = buffer.getChannelData(0);
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  function text(at, value) { for (let i=0;i<value.length;i++) bytes[at+i]=value.charCodeAt(i); }
  text(0,'RIFF'); view.setUint32(4,bytes.length-8,true); text(8,'WAVE'); text(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,rate,true); view.setUint32(28,rate*2,true); view.setUint16(32,2,true);
  view.setUint16(34,16,true); text(36,'data'); view.setUint32(40,samples.length*2,true);
  for (let i=0;i<samples.length;i++) view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
  let binary='';
  for (let i=0;i<bytes.length;i+=16384) binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary);
}
