import assert from 'node:assert/strict';
import { request } from '../src/generation/node_modules/playwright/index.mjs';

const baseURL = process.env.STORYFORK_URL || process.argv[2] || 'http://127.0.0.1:8000';
const author = await request.newContext({baseURL});
const visitor = await request.newContext({baseURL});
const forbidden = new Set(['prompt','prompts','visualBrief','internal','provider','reasoning','rawResponse','plan','effects','future','nextOpening']);
function inspect(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { assert(!forbidden.has(key), `Private field in public response: ${key}`); inspect(child); }
}
async function json(response, status = 200) {
  assert.equal(response.status(), status, await response.text());
  return response.json();
}
async function ready(client, ticket) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const job = await json(await client.get(`/api/jobs/status?job_id=${ticket.jobId}`));
    if (job.status === 'failed') throw new Error(job.error);
    if (job.status === 'ready') return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Generation timed out.');
}
async function packageFor(client, storyId) {
  const pkg = await json(await client.get(`/api/playback?story_id=${storyId}`));
  inspect(pkg);
  const animation = await json(await client.get(pkg.animationUrl));
  inspect(animation);
  assert.equal(animation.duration, pkg.duration);
  assert(animation.camera.length > 0);
  const svgUrls = [...pkg.layers.map(layer => layer.svgUrl), ...animation.tracks.map(track => track.svgUrl)];
  for (const url of svgUrls) {
    assert(url.startsWith(`/media/${pkg.sceneId}/`));
    const svg = await client.get(url); assert.equal(svg.status(), 200);
    assert((await svg.text()).includes('<svg'));
  }
  const audioResponse = await client.get(pkg.audioUrl);
  assert.equal(audioResponse.status(), 200);
  const audio = await audioResponse.body();
  assert.equal(audio.toString('ascii',0,4),'RIFF');
  const samples = audio.readUInt32LE(40)/2, rate = audio.readUInt32LE(24);
  assert.equal(samples/rate, pkg.duration);
  let power=0;
  for (let offset=44;offset<audio.length;offset+=2) power+=(audio.readInt16LE(offset)/32768)**2;
  assert(power > 0.1, 'Mixed audio is silent.');
  return pkg;
}
try {
  const ticket = await json(await author.post('/api/stories',{data:{premise:'A quiet corridor. Someone knocks behind a locked door.',mode:'demo'}}),202);
  await ready(author,ticket);
  const opening = await packageFor(author,ticket.storyId);
  assert.equal(opening.revision,0);
  assert.equal(opening.choices.options.length,2);
  const firstDecision = {storyId:ticket.storyId,choiceId:'open',expectedRevision:0,requestId:crypto.randomUUID()};
  const first = await json(await author.post('/api/choices',{data:firstDecision}),202);
  assert.deepEqual(await json(await author.post('/api/choices',{data:firstDecision}),202),first);
  await ready(author,first);
  const opened = await packageFor(author,ticket.storyId);
  assert.equal(opened.revision,1);
  assert.equal(opened.terminal,true);
  assert.notEqual(opened.sceneId,opening.sceneId);
  const independent = await packageFor(visitor,ticket.storyId);
  assert.equal(independent.sceneId,opening.sceneId);
  assert.equal(independent.revision,0);
  const second = await json(await visitor.post('/api/choices',{data:{storyId:ticket.storyId,choiceId:'leave',expectedRevision:0,requestId:crypto.randomUUID()}}),202);
  await ready(visitor,second);
  const left = await packageFor(visitor,ticket.storyId);
  assert.equal(left.terminal,true);
  assert.notDeepEqual(left.captions,opened.captions);
  assert.equal((await packageFor(author,ticket.storyId)).sceneId,opened.sceneId);
  assert.equal((await author.post('/api/choices',{data:{...firstDecision,requestId:crypto.randomUUID()}})).status(),409);
  for (const path of ['/src/generation/planner.mjs','/assets/stickman/rig.js','/static/../generation/planner.mjs',`/media/${opening.sceneId}/internal.json`]) assert.equal((await author.get(path)).status(),404,path);
  console.log(JSON.stringify({status:'passed',storyId:ticket.storyId,branches:['open','leave'],mixedAudioSeconds:30,anonymousProgress:'independent',publicExports:'allowlisted',resumeUrl:`${baseURL}/app?story=${ticket.storyId}`},null,2));
} finally { await author.dispose(); await visitor.dispose(); }
