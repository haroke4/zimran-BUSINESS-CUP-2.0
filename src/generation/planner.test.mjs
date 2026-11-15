import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBlock,writeCurrentBlock} from './planner.mjs';

const valid=()=>({title:'Scene',brief:'A continuous corridor.',partnerVisible:true,
  captions:[{start:0,end:7,text:'A'},{start:7,end:14,text:'B'},{start:14,end:22,text:'C'},{start:22,end:30,text:'D'}],
  lines:[{speaker:'mara',text:'Where?',at:3,duration:2}],audioEvents:[]});

test('block validator enforces original schema, caption intervals, dialogue speakers and scene duration',()=>{
  validateBlock(valid());
  assert.throws(()=>validateBlock({...valid(),title:'x'.repeat(101)}));
  assert.throws(()=>validateBlock({...valid(),captions:[{start:0,end:7,text:'A'}]}));
  assert.throws(()=>validateBlock({...valid(),captions:valid().captions.map((c,i)=>i===1?{...c,start:6}:c)}));
  assert.throws(()=>validateBlock({...valid(),lines:[{speaker:'future_character',text:'No',at:3,duration:2}]}));
  assert.throws(()=>validateBlock({...valid(),lines:[{speaker:'mara',text:'Late',at:26,duration:7}]}));
  assert.throws(()=>validateBlock({...valid(),lines:[{speaker:'mara',text:'One',at:3,duration:3},{speaker:'partner',text:'Two',at:4,duration:3}]}));
});

test('opening writer receives only current outline, while continuation consumes selected outcome',async()=>{
  const inputs=[];
  const model={generate:async(_system,input)=>{inputs.push(input);return{value:valid()};}};
  const plan={title:'Episode',setting:'Corridor',protagonist:'Мара',partner:'Смотритель',centralQuestion:'Who knocks?',
    opening:'A locked door',answer:'PRIVATE_FUTURE_ANSWER',openLabel:'Open',leaveLabel:'Leave',
    branches:{open:{opening:'PRIVATE_OPEN_OUTCOME',consequence:'Found a radio'},leave:{opening:'PRIVATE_LEAVE_OUTCOME',consequence:'Missed radio'}}};
  const opening=await writeCurrentBlock(model,plan,null);
  assert.equal(opening.terminal,false);assert.equal(opening.choices.length,2);
  assert.doesNotMatch(JSON.stringify(inputs[0]),/PRIVATE_FUTURE_ANSWER|PRIVATE_OPEN_OUTCOME|PRIVATE_LEAVE_OUTCOME/);
  const continuation=await writeCurrentBlock(model,plan,'open');
  assert.equal(continuation.terminal,true);assert.deepEqual(continuation.choices,[]);
  assert.match(JSON.stringify(inputs[1]),/PRIVATE_OPEN_OUTCOME/);
  assert.doesNotMatch(JSON.stringify(inputs[1]),/PRIVATE_LEAVE_OUTCOME/);
});
