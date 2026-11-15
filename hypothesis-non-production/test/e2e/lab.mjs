import assert from "node:assert/strict";
import { join } from "node:path";
import {
  baseUrl, launchBrowser, openPage, screenshot, writeJson,
} from "./helpers.mjs";

const evidence = "evidence/lab";

const browser = await launchBrowser();
try {
  const { context, page, errors } = await openPage(browser);
  await page.goto(`${baseUrl}/asset-hypotheses/`, { waitUntil: "networkidle" });

  await page.waitForFunction(() => document.querySelector("#interact")?.textContent === "Open cabinet"
    && !document.querySelector("#interact").disabled);
  assert.match(await page.locator("#status").textContent(), /Cabinet: closed/);
  await screenshot(page, join(evidence, "screenshots/rainy-crossing.png"), { fullPage: true });

  await page.locator("#interact").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Radio battery revealed · Cabinet: open"));
  await page.locator("#take").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Battery picked up"));

  await page.locator("#location").selectOption("dry");
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Cabinet: closed"));
  assert.ok(await page.locator("#stage canvas").count() === 1);
  await screenshot(page, join(evidence, "screenshots/quiet-block.png"), { fullPage: true });

  await page.locator("#location").selectOption("trail");
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Cabinet: closed"));
  await screenshot(page, join(evidence, "screenshots/pine-trail.png"), { fullPage: true });

  await page.locator("#location").selectOption("wet");
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Cabinet: open"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.querySelector("#interact").disabled);
  const resumed = await page.locator("#status").textContent();
  assert.match(resumed, /Battery picked up/);
  assert.match(resumed, /Cabinet: open/);

  await page.evaluate(() => {
    sessionStorage.setItem("framebreak-asset-lab-v1", JSON.stringify({
      "rainy-crossing": { cache: "burning", batteryChoice: "taken" },
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.querySelector("#interact").disabled);
  const recovered = await page.locator("#status").textContent();
  assert.match(recovered, /Saved state for cache was “burning”; reset to closed/);
  assert.match(recovered, /Cabinet: closed/);
  assert.equal(await page.locator("#interact").textContent(), "Open cabinet");
  assert.equal(errors.length, 0, errors.join("\n"));
  await screenshot(page, join(evidence, "screenshots/unknown-state-recovery.png"), { fullPage: true });

  await writeJson(join(evidence, "lab.json"), {
    resumed,
    recovered,
    viewport: page.viewportSize(),
    consoleErrors: errors,
  });
  console.log("asset lab: PASS", { resumed, recovered });
  await context.close();
} finally {
  await browser.close();
}
