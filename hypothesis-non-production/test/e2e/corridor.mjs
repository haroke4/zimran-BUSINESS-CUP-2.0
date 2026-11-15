import assert from "node:assert/strict";
import { join } from "node:path";
import {
  baseUrl, launchBrowser, openPage, screenshot, writeJson,
} from "./helpers.mjs";

const evidence = "evidence/corridor";

const browser = await launchBrowser();
try {
  const { context, page, errors } = await openPage(browser);
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.querySelector("#play").disabled);
  await page.locator("#play").click();
  await page.waitForFunction(() => !document.querySelector("#choices").hidden, null, { timeout: 20_000 });
  const caption = await page.locator("#caption").textContent();
  assert.match(caption, /Это я\. Открой/);
  await screenshot(page, join(evidence, "screenshots/choice.png"), { fullPage: true });
  await page.locator("#open-door").click();
  await page.waitForFunction(() => document.querySelector("#caption").textContent === "За шлюзом кто-то есть.", null, { timeout: 10_000 });
  assert.equal(await page.locator("#play").textContent(), "Сыграть заново");
  assert.equal(errors.length, 0, errors.join("\n"));
  await screenshot(page, join(evidence, "screenshots/ending.png"), { fullPage: true });
  await writeJson(join(evidence, "corridor.json"), {
    caption,
    ending: await page.locator("#caption").textContent(),
    consoleErrors: errors,
  });
  console.log("corridor: PASS", caption);
  await context.close();
} finally {
  await browser.close();
}
