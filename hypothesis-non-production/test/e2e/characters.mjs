import assert from "node:assert/strict";
import { join } from "node:path";
import {
  baseUrl, launchBrowser, openPage, screenshot, writeJson,
} from "./helpers.mjs";

const evidence = "evidence/characters";

const browser = await launchBrowser();
try {
  const { context, page, errors } = await openPage(browser, {
    viewport: { width: 1440, height: 1120 },
  });
  await page.goto(`${baseUrl}/character-lab.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__characterLab) && Boolean(document.querySelector("#stage canvas")));
  await page.waitForTimeout(900);

  assert.equal(await page.locator(".character-card").count(), 6);
  assert.equal(await page.locator(".clip-button").count(), 12);
  assert.equal(await page.locator("#selection-label").textContent(), "Вэйл — Капитан смены");

  await screenshot(page, join(evidence, "lineup.png"), { fullPage: true });

  await page.locator('.clip-button[data-clip="run"]').click();
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.__characterLab.state.clip), "run");
  await screenshot(page, join(evidence, "run.png"), { fullPage: true });

  await page.locator('.clip-button[data-clip="wave"]').click();
  await page.locator('.character-card[data-character="or7"]').click();
  await page.locator("#debug").check();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__characterLab.state.debug), true);
  await screenshot(page, join(evidence, "skeleton.png"), { fullPage: true });

  await page.locator("#flip").click();
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => window.__characterLab.state.facing), -1);
  await screenshot(page, join(evidence, "flipped.png"), { fullPage: true });

  await page.locator("#debug").uncheck();
  await page.locator("#sync").uncheck();
  await page.locator('.clip-button[data-clip="jump"]').click();
  await page.waitForTimeout(700);
  await screenshot(page, join(evidence, "solo-jump.png"), { fullPage: true });

  assert.equal(errors.length, 0, errors.join("\n"));
  await writeJson(join(evidence, "characters.json"), {
    characters: await page.evaluate(() => window.__characterLab.characters.map(({ id, name, role }) => ({ id, name, role }))),
    clips: await page.evaluate(() => window.__characterLab.clipList.map(({ id, duration, loop }) => ({ id, duration, loop }))),
    consoleErrors: errors,
  });
  console.log("characters: PASS", await page.locator("#clip-label").textContent());
  await context.close();
} finally {
  await browser.close();
}
