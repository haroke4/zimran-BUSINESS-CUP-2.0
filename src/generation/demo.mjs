const svg=(content)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 90">${content}</svg>`;
const layer=(name,content,role='scenery')=>({name,role,x:0,y:0,width:3200,height:900,svg:svg(content)});

export const demoPlan={version:1,title:'Три удара, потом два',centralQuestion:'Кто подаёт семейный сигнал из запертого коридора?',
  answer:'Лёва оставил работающую рацию; сигнал передаёт таймер, а не человек за дверью.',
  setting:'Заброшенная исследовательская станция. Длинный технический коридор, закрытая дверь, лестница к выходу.',
  cast:[{id:'mara',name:'Мара',skin:'kit'},{id:'warden',name:'Смотритель',skin:'morgan'}],
  branches:{open:{effect:{doorOpened:true,heardRecording:true},opening:'Мара открывает дверь и находит рацию, оставленную Лёвой.'},
    leave:{effect:{doorOpened:false,heardRecording:false},opening:'Мара уходит к лестнице; семейный сигнал остаётся за закрытой дверью.'}}};

export function demoBlock(branch) {
  if(branch==='open')return {title:'Оставленное сообщение',terminal:true,choices:[],
    captions:[{start:0,end:6,text:'Мара тянет ручку. Дверь поддаётся с протяжным скрипом.'},
      {start:7,end:13,text:'На пустом стуле мигает рация. Рядом лежит записка Лёвы.'},
      {start:14,end:21,text:'«Если ты это слышишь, я уже выбрался. Иди к северной лестнице».'},
      {start:22,end:30,text:'Мара забирает сообщение. Теперь у неё есть направление. Конец эпизода.'}],
    lines:[{speaker:'mara',text:'Лёва оставил это для меня.',at:8,duration:4},{speaker:'warden',text:'Значит, за дверью никого не было.',at:14,duration:5}]};
  if(branch==='leave')return {title:'По другую сторону',terminal:true,choices:[],
    captions:[{start:0,end:6,text:'Мара отпускает ручку и отходит от двери.'},
      {start:7,end:13,text:'Смотритель остаётся у поста. Мара идёт к аварийной лестнице.'},
      {start:14,end:21,text:'За спиной снова слышны три удара, пауза, два. Дверь остаётся закрытой.'},
      {start:22,end:30,text:'С лестницы тянет свежим воздухом. Мара выходит, так и не узнав, кто звал. Конец эпизода.'}],lines:[]};
  return {title:demoPlan.title,terminal:false,choices:[{id:'open',label:'Открыть дверь'},{id:'leave',label:'Уйти к лестнице'}],
    captions:[{start:0,end:6,text:'Старая станция. Мара идёт по коридору, где в последний раз видели её брата.'},
      {start:7,end:13,text:'В конце коридора горит единственная лампа. Смотритель ждёт у запертой двери.'},
      {start:14,end:21,text:'Три удара, пауза, два. Семейный сигнал Лёвы доносится из-за двери.'},
      {start:22,end:30,text:'Ручка холодная. Мара может открыть дверь или уйти к лестнице.'}],
    lines:[{speaker:'mara',text:'Ты тоже слышал? Три, потом два.',at:18,duration:3.5},
      {speaker:'warden',text:'Слышал. Но ключ здесь только у тебя.',at:22,duration:4}]};
}

export function makeDemoScene(branch) {
  const niches=Array.from({length:9},(_,i)=>{
    const x=10+i*35;
    return `<path d="M${x} 21h25v43h-25Z" fill="#1b2a32"/><path d="M${x} 21h3v43h-3Z" fill="#293a42"/><path d="M${x+3} 24h19v34h-19Z" fill="#22353d"/><path d="M${x+3} 58h19v6h-19Z" fill="#14242c"/>`;
  }).join('');
  const pools=[48,155,247].map((x,i)=>`<ellipse cx="${x}" cy="75.2" rx="${i===2?20:15}" ry="3.8" fill="#e2ba72" opacity=".08"/><path d="M${x-1.8} 19h3.6l10 52h-24Z" fill="#ebc587" opacity=".025"/><rect x="${x-3}" y="17" width="6" height="2.6" rx=".6" fill="#dbc18e"/><rect x="${x-4}" y="15.8" width="8" height="1.3" fill="#37464b"/>`).join('');
  const layers=[layer('Architecture',`<defs><linearGradient id="wall" x2="0" y2="1"><stop stop-color="#273b46"/><stop offset="1" stop-color="#172830"/></linearGradient><linearGradient id="floor" x2="0" y2="1"><stop stop-color="#3a494d"/><stop offset="1" stop-color="#202d35"/></linearGradient></defs><rect width="320" height="90" fill="#13232e"/><path d="M0 0h320v14L0 19Z" fill="#101e28"/><path d="M0 16L320 12v59H0Z" fill="url(#wall)"/><path d="M0 69h320v21H0Z" fill="url(#floor)"/><path d="M0 65h320v6H0Z" fill="#12222a"/>${niches}`),
    layer('Local light',pools,'light'),layer('Station details',`<path d="M0 27h17v25H0Z" fill="#263940"/><rect x="1" y="30" width="11" height="16" rx="1" fill="#334951"/><rect x="3" y="32" width="7" height="9" fill="#8d9e99"/><rect x="110" y="55" width="27" height="3" rx=".8" fill="#53615e"/><path d="M114 58h1v12h-1Zm17 0h1v12h-1Z" fill="#243036"/><path d="M292 47h28v23h-28Z" fill="#233b3e"/><path d="M295 65h25v4h-25Zm4-7h21v4h-21Zm4-7h17v4h-17Z" fill="#3a5553"/><rect x="296" y="38" width="12" height="4" rx=".6" fill="#668a73"/><path d="M299 40h6m-2-1 2 1-2 1" fill="none" stroke="#d0d5ae" stroke-width=".6"/>`),
    layer('Foreground shade','<path d="M0 86Q50 83 100 86T210 85T320 86V90H0Z" fill="#101d26" opacity=".38"/>','foreground')];
  const door={id:'sealed-door',label:'Дверь',kind:'door',initial:'closed',side:1,hingeX:253,
    opening:{x:237,y:42,width:16,height:34},contact:{x:239,y:60},recessColor:'#111e26',
    states:{closed:{opacity:1,scaleX:1,dy:0},open:{opacity:1,scaleX:.08,dy:0}},
    fixedSvg:svg('<rect x="235.5" y="40.5" width="19" height="37" fill="#415258"/><rect x="236.4" y="41.4" width="17.2" height="35.6" fill="#26353d"/>'),
    movingSvg:svg('<rect x="237" y="42" width="16" height="34" fill="#4a5d62"/><path d="M239 44h12v28h-12Z" fill="#405258"/><path d="M239 44h12v1h-12Z" fill="#61726f"/><rect x="238.2" y="59.2" width="3" height="1" rx=".4" fill="#c2bca3"/>')};
  if(branch==='open')layers.splice(2,0,layer('Visible recording',`<path d="M237 42h16v34h-16Z" fill="#21373e"/><rect x="241" y="63" width="8" height="1.4" fill="#5c6159"/><path d="M242 64h1v12h-1Zm5 0h1v12h-1Z" fill="#323e3d"/><rect x="243" y="57" width="4.6" height="6" rx=".6" fill="#586b62"/><path d="M243.7 56v-5" stroke="#65776e" stroke-width=".4"/><circle cx="246.2" cy="58.3" r=".5" fill="#b6c583"/>`));
  if(branch==='open')door.recessColor='none';
  const block=demoBlock(branch);
  const route=branch==='leave'?[{startX:234,endX:65,departureAt:0,arrivalAt:17}]
    :branch==='open'?[{startX:234,endX:234,departureAt:0,arrivalAt:2},{startX:234,endX:242,departureAt:3,arrivalAt:5}]
    :[{startX:42,endX:234,departureAt:0,arrivalAt:16}];
  return {title:block.title,width:3200,height:900,layers,
    staging:{groundY:76,route},objects:[door],commands:branch==='open'?[{op:'interact',target:door.id,state:'open',at:.4,duration:1.2}]:[],
    dialogue:{actors:[{id:'mara',name:'Мара',skin:'kit'},{id:'warden',name:'Смотритель',skin:'morgan',x:262}],lines:block.lines},
    sound:{version:1,ambience:'industrial',surface:'concrete',ambienceGain:.35,stepsGain:.7},
    audioEvents:branch==='open'?[{kind:'door',at:.75},{kind:'signal',at:9}]:[{kind:'knock',at:branch==='leave'?15:16.5}]};
}
