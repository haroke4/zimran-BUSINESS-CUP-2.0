import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const playwrightPath = process.env.FRAMEBREAK_PLAYWRIGHT
  ?? "/private/tmp/framebreak-browser.2dcK2k/node_modules/playwright-core/index.mjs";
const chromePath = process.env.FRAMEBREAK_CHROME
  ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const baseUrl = process.env.FRAMEBREAK_BASE ?? "http://127.0.0.1:5173";
export const apiUrl = process.env.FRAMEBREAK_API ?? "http://127.0.0.1:8787";

export async function launchBrowser() {
  const { chromium } = await import(playwrightPath);
  return chromium.launch({
    executablePath: chromePath,
    args: ["--enable-unsafe-swiftshader"],
  });
}

export async function openPage(browser, { viewport = { width: 1280, height: 900 }, reducedMotion = false } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (event) => {
    if (event.type() !== "error") return;
    if (event.location().url.endsWith("/favicon.ico")) return;
    errors.push(`console: ${event.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      errors.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  return { context, page, errors };
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function screenshot(page, path, { fullPage = false } = {}) {
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage });
}

export async function waitForScene(page, number) {
  await page.waitForFunction(
    (scene) => !document.querySelector("#player")?.hidden
      && window.__framebreak?.snapshot().scene === scene,
    number,
    { timeout: 180_000 },
  );
}

export async function waitForPlayback(page) {
  await page.waitForFunction(
    () => document.querySelector("#stage")?.dataset.playbackComplete === "true",
    null,
    { timeout: 60_000 },
  );
}

export async function snapshot(page) {
  return page.evaluate(() => window.__framebreak.snapshot());
}

export async function choose(page, choiceId) {
  const button = page.locator(`#choices button[data-choice-id="${choiceId}"]`);
  await button.waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(
    (id) => {
      const target = document.querySelector(`#choices button[data-choice-id="${id}"]`);
      return target && !target.disabled;
    },
    choiceId,
    { timeout: 60_000 },
  );
  await button.click();
}
