import test from 'node:test';
import assert from 'node:assert/strict';
import { transientRequest } from './engine/vertex-model.mjs';

test('retries capacity failures with bounded exponential delay, but rejects invalid requests immediately',async()=>{
  let calls=0;const waits=[];
  assert.equal(await transientRequest(async()=>{if(++calls<3)throw Object.assign(new Error('capacity'),{status:429});return 'ok';},{wait:async ms=>waits.push(ms)}),'ok');
  assert.equal(calls,3);assert.deepEqual(waits,[1500,3000]);
  calls=0;
  await assert.rejects(transientRequest(async()=>{calls++;throw Object.assign(new Error('schema'),{status:400});},{wait:async()=>assert.fail('must not wait')}));
  assert.equal(calls,1);
});
