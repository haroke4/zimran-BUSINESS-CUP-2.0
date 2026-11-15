import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const requireGeneration = createRequire(new URL('../../generation/package.json', import.meta.url));
const { chromium } = requireGeneration('playwright');
const base = process.env.STORYFORK_BASE_URL || 'http://127.0.0.1:8000';
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' && existsSync(macChrome) ? macChrome : undefined);
const browser = await chromium.launch({
  ...(executablePath ? {executablePath} : {}),
  headless:true,
  args:['--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  page.setDefaultTimeout(20000);
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type()==='error') errors.push(message.text()); });
  let creates = 0;
  page.on('request', request => { if(request.method()==='POST' && new URL(request.url()).pathname==='/api/stories') creates++; });
  async function ready() {
    await page.waitForFunction(() => {
      const failure = document.querySelector('[role=alert]');
      if (failure) throw new Error(failure.textContent);
      return Boolean(document.querySelector('button[aria-label="Play"]'));
    }, {}, {timeout:90000});
    await page.waitForFunction(()=>!document.querySelector('button[aria-label="Play"]')?.disabled);
  }
  async function end() {
    await page.getByRole('slider',{name:'Playback position'}).focus();
    await page.keyboard.press('End');
  }
  await page.goto(base);
  await page.getByRole('button',{name:/play demo/i}).click();
  if (!new URL(page.url()).pathname.startsWith('/app')) {
    const interactive = page.getByRole('link', {name:'Try making a choice'});
    if (await interactive.count()) await interactive.click();
    else await page.goto(`${base}/app?demo=1`);
  }
  await ready();
  console.log('scene ready', page.url());
  assert.equal(creates,1,'The demo must be created once, including under StrictMode');
  assert.ok(!page.url().includes('job='),'Ready story URLs should not retain stale jobs');
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>0.2,{},{timeout:10000});
  await page.mouse.move(500,500);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.getByRole('button',{name:'Mute',exact:true}).click();
  assert.equal(await page.locator('audio').evaluate(media=>media.muted),true);
  await page.getByRole('button',{name:'Unmute',exact:true}).click();
  await end();
  for(let index=0;index<29;index++) await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('.choice-actions button').count(),2,'Choices appear before the scene ends');
  assert.equal(await page.locator('.choice-actions button').first().isEnabled(),false,'Choices remain disabled before 30 seconds');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('.choice-actions button').count(),0,'Scrubbing backwards hides unrevealed choices');
  await end();
  assert.equal(await page.locator('.choice-actions button').first().isEnabled(),true);
  const sourceStory = page.url();
  await page.locator('.choice-actions button').first().click();
  await ready();
  console.log('scene ready', page.url());
  await end();
  await page.getByRole('heading',{name:'The end',exact:true}).waitFor();
  console.log('terminal ready');
  await page.reload();
  await ready();
  console.log('scene ready', page.url());
  assert.equal(await page.locator('#player-title + p').textContent(),'Final scene','Reload must resume the chosen continuation');
  await page.setViewportSize({width:390,height:844});
  const size = await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  assert.ok(size.scroll<=size.client,'Mobile must not overflow horizontally');
  await page.goto(`${base}/app?demo=1`);
  await ready();
  console.log('scene ready', page.url());
  await end();
  await page.locator('.choice-actions button').last().click();
  await ready();
  console.log('scene ready', page.url());
  await end();
  await page.getByRole('heading',{name:'The end',exact:true}).waitFor();
  console.log('terminal ready');
  assert.deepEqual(errors,[],'Playback must not produce browser errors');
  console.log(JSON.stringify({demo:'ok',audio:'ok',choiceTiming:'ok',bothContinuations:'ok',resume:'ok',mobile:'ok',errors,sourceStory}));
} finally { await browser.close(); }
