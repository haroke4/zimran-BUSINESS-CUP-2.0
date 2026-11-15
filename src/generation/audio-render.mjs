import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

export async function renderSceneAudio(scene, file, duration = 30) {
  const allowed = new Set(['/audio-render-client.mjs','/engine/sound-engine.mjs','/engine/sound-plan.mjs']);
  const server = createServer(async (req,res) => {
    if (req.url === '/') { res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Offline audio renderer</title>'); return; }
    if (!allowed.has(req.url)) {res.writeHead(404).end();return;}
    try {res.writeHead(200,{'Content-Type':'text/javascript'}).end(await readFile(new URL('.'+req.url,import.meta.url)));}
    catch {res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const installedChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const configuredChrome=process.env.STORYFORK_CHROME_EXECUTABLE || process.env.FRAMEBREAK_CHROME_PATH;
    if(configuredChrome&&!existsSync(configuredChrome))throw new Error('Configured Chrome executable does not exist; check STORYFORK_CHROME_EXECUTABLE or FRAMEBREAK_CHROME_PATH.');
    const executablePath = configuredChrome
      || (!existsSync(chromium.executablePath()) && process.platform==='darwin' && existsSync(installedChrome)?installedChrome:undefined);
    browser = await chromium.launch({headless:true,...(executablePath && {executablePath}),args:['--no-sandbox']});
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const base64 = await page.evaluate(async ({scene,duration})=>{
      const {renderAudio}=await import('/audio-render-client.mjs');
      return renderAudio(scene,duration);
    },{scene,duration});
    await writeFile(file,Buffer.from(base64,'base64'));
  } finally {
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
