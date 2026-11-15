import assert from "node:assert/strict";
import { join } from "node:path";
import {
  apiUrl, baseUrl, choose, launchBrowser, openPage,
  screenshot, snapshot, waitForPlayback, waitForScene, writeJson,
} from "./helpers.mjs";

const branch = process.env.FRAMEBREAK_BRANCH ?? "take";
const evidence = process.env.FRAMEBREAK_EVIDENCE ?? join("evidence", `live-${branch}`);
const sceneChoices = {
  1: "scan_crossing",
  2: branch === "take" ? "take_battery" : "leave_battery",
  3: "follow_sign",
  4: "mark_trail",
  5: "search_cache",
  6: "radio_call",
  7: "answer_signal",
  8: "climb_boulder",
  9: "enter_house",
  10: "open_airlock",
};
const screenshots = new Set([1, 2, 3, 6, 7, 10]);

const browser = await launchBrowser();
try {
  const { context, page, errors } = await openPage(browser);
  const postChoices = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/choices")) postChoices.push(request.url());
  });

  await page.goto(`${baseUrl}/asset-hypotheses/episode.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.querySelector("#start").disabled, null, { timeout: 15_000 });
  const health = await page.locator("#intro-status").textContent();
  assert.match(health, /Model online/);

  await page.locator("#start").click();
  await waitForScene(page, 1);

  const run = {
    branch,
    startedAt: new Date().toISOString(),
    health,
    scenes: [],
    resumeCheck: null,
    noReloadCheck: { bootIds: [], navigationEntries: [] },
    outcome: null,
    export: null,
    consoleErrors: errors,
  };

  let bootId = (await snapshot(page)).bootId;
  let reloaded = false;
  let elapsedBeforeReload = 0;

  for (let number = 1; number <= 10; number += 1) {
    const sceneStart = Date.now();
    await waitForScene(page, number);

    if (number === 4 && !reloaded) {
      await page.waitForFunction(
        () => (window.__framebreak.snapshot().playback?.elapsedMs ?? 0) >= 10_000,
        null,
        { timeout: 30_000 },
      );
      const before = await snapshot(page);
      const postsBefore = postChoices.length;
      const revisionBefore = before.revision;
      const sceneBefore = before.scene;
      const titleBefore = await page.locator("#scene-title").textContent();
      elapsedBeforeReload = before.playback.elapsedMs;
      await page.reload({ waitUntil: "networkidle" });
      await waitForScene(page, sceneBefore);
      await page.waitForFunction(
        (minimum) => (window.__framebreak.snapshot().playback?.elapsedMs ?? 0) >= minimum,
        elapsedBeforeReload - 2_500,
        { timeout: 20_000 },
      );
      const after = await snapshot(page);
      run.resumeCheck = {
        scene: after.scene,
        revision: after.revision,
        title: await page.locator("#scene-title").textContent(),
        elapsedBeforeMs: Math.round(elapsedBeforeReload),
        elapsedAfterMs: Math.round(after.playback.elapsedMs),
        revisionBefore,
        postsBefore,
        postsAfter: postChoices.length,
        selectedChoiceCount: (await fetch(`${apiUrl}/api/episodes/${after.episodeId}/export`).then((response) => response.json())).episode.progress.choices.length,
        bootIdBefore: before.bootId,
        bootIdAfter: after.bootId,
        status: await page.locator("#scene-status").textContent(),
      };
      assert.equal(after.scene, sceneBefore);
      assert.equal(after.revision, revisionBefore);
      assert.equal(after.playback.elapsedMs >= elapsedBeforeReload - 2_500, true);
      assert.equal(run.resumeCheck.postsAfter, postsBefore, "resume must not submit another choice");
      assert.match(run.resumeCheck.title, new RegExp(titleBefore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      bootId = after.bootId;
      reloaded = true;
    }

    await waitForPlayback(page);
    const sceneSnapshot = await snapshot(page);
    const meta = await page.locator("#scene-meta").textContent();
    const title = await page.locator("#scene-title").textContent();
    const caption = await page.locator("#caption").textContent();
    const status = await page.locator("#scene-status").textContent();
    const consequenceVisible = await page.locator("#consequence").isVisible();
    const consequenceText = consequenceVisible ? await page.locator("#consequence").textContent() : null;
    const facts = await page.evaluate(() => window.__framebreak.episode.progress.facts);
    const recoveryText = await page.locator("#recovery").isVisible() ? await page.locator("#recovery").textContent() : null;
    const navigationEntries = await page.evaluate(() => performance.getEntriesByType("navigation").length);

    run.scenes.push({
      number,
      revision: sceneSnapshot.revision,
      meta,
      title,
      caption,
      status,
      elapsedMs: Math.round(sceneSnapshot.playback.elapsedMs),
      durationMs: sceneSnapshot.playback.durationMs,
      complete: sceneSnapshot.playback.complete,
      consequence: consequenceText,
      facts,
      frameStats: sceneSnapshot.frameStats,
      renderer: sceneSnapshot.renderer,
      bootId: sceneSnapshot.bootId,
      navigationEntries,
      wallClockPlaybackMs: Date.now() - sceneStart,
      recovery: recoveryText,
    });
    run.noReloadCheck.bootIds.push({ scene: number, bootId: sceneSnapshot.bootId });
    run.noReloadCheck.navigationEntries.push(navigationEntries);

    if (number > 1) {
      assert.equal(sceneSnapshot.playback.durationMs, 30_000);
      assert.equal(sceneSnapshot.playback.complete, true);
    }
    if (number === 1 || number === 6 || number === 10) {
      await screenshot(page, join(evidence, "screenshots", `scene-${String(number).padStart(2, "0")}-page.png`), { fullPage: true });
    }
    if (screenshots.has(number)) {
      await page.locator("#stage").screenshot({ path: join(evidence, "screenshots", `scene-${String(number).padStart(2, "0")}-stage.png`) });
    }

    if (number === 10) break;

    const choiceId = sceneChoices[number];
    const generationStart = Date.now();
    await choose(page, choiceId);
    await waitForScene(page, number + 1);
    run.scenes.at(-1).generationMs = Date.now() - generationStart;
    run.scenes.at(-1).nextChoice = choiceId;
  }

  assert.equal(run.noReloadCheck.bootIds.filter((entry) => entry.scene < 4).every((entry) => entry.bootId === run.noReloadCheck.bootIds[0].bootId), true);
  assert.equal(run.noReloadCheck.bootIds.filter((entry) => entry.scene > 4).every((entry) => entry.bootId === run.noReloadCheck.bootIds.at(-1).bootId), true);
  assert.equal(run.noReloadCheck.navigationEntries.every((value) => value === 1), true);
  assert.equal(run.scenes.every((scene) => scene.complete), true);
  assert.ok(run.scenes.find((scene) => scene.number === 6).consequence);
  assert.ok(run.scenes.find((scene) => scene.number === 7).consequence);
  assert.ok(run.scenes.find((scene) => scene.number === 10).consequence);

  const finalGenerationStart = Date.now();
  await choose(page, sceneChoices[10]);
  await page.locator("#completion").waitFor({ state: "visible", timeout: 180_000 });
  const finalSnapshot = await snapshot(page);
  run.outcome = {
    title: await page.locator("#completion-title").textContent(),
    summary: await page.locator("#completion-summary").textContent(),
    revision: finalSnapshot.revision,
    scene: finalSnapshot.scene,
    status: finalSnapshot.status,
  };
  run.scenes.at(-1).generationMs = Date.now() - finalGenerationStart;
  assert.equal(run.outcome.revision, 10);
  assert.equal(run.outcome.status, "complete");

  const episodeId = finalSnapshot.episodeId;
  const exported = await fetch(`${apiUrl}/api/episodes/${episodeId}/export`).then((response) => response.json());
  run.export = exported.episode;
  assert.equal(exported.episode.progress.choices.length, 10);
  assert.equal(exported.episode.progress.facts["battery.taken"], branch === "take");
  assert.equal(exported.episode.progress.facts["battery.owner"], branch === "take" ? "mara" : "cache");
  assert.equal(exported.episode.progress.choices[1].choiceId, sceneChoices[2]);

  await screenshot(page, join(evidence, "screenshots", "episode-complete.png"), { fullPage: true });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#completion").waitFor({ state: "visible", timeout: 30_000 });
  const resumedComplete = await snapshot(page);
  run.completeResume = {
    bootId: resumedComplete.bootId,
    episodeId: resumedComplete.episodeId,
    scene: resumedComplete.scene,
    revision: resumedComplete.revision,
    status: resumedComplete.status,
    completionTitle: await page.locator("#completion-title").textContent(),
  };
  assert.equal(resumedComplete.episodeId, episodeId);
  assert.equal(resumedComplete.status, "complete");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#completion").waitFor({ state: "visible", timeout: 30_000 });
  run.mobile = await page.evaluate(() => {
    const stage = document.querySelector("#stage").getBoundingClientRect();
    const completion = document.querySelector("#completion").getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      scrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      stage: { width: Math.round(stage.width), height: Math.round(stage.height) },
      completion: { width: Math.round(completion.width), height: Math.round(completion.height) },
      completionTitle: document.querySelector("#completion-title").textContent,
    };
  });
  assert.equal(run.mobile.horizontalOverflow, false);
  assert.ok(run.mobile.stage.width >= 340);
  await screenshot(page, join(evidence, "screenshots", "mobile-complete.png"), { fullPage: true });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    window.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__longTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) });
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      // Long Task API is optional
    }
  });
  const previousEpisode = episodeId;
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#new-episode").click();
  await page.waitForFunction(
    (id) => window.__framebreak.snapshot().episodeId !== id,
    previousEpisode,
    { timeout: 180_000 },
  );
  await waitForScene(page, 1);
  await page.waitForTimeout(8_000);
  const throttled = await snapshot(page);
  run.emulatedPhone = {
    emulated: true,
    note: "390x844 viewport with 4x CPU throttling in desktop Chrome; not a physical phone",
    viewport: throttled.viewport,
    renderer: throttled.renderer,
    frameStats: throttled.frameStats,
    longTasks: await page.evaluate(() => window.__longTasks.slice(-20)),
    hardwareConcurrency: throttled.hardwareConcurrency,
    deviceMemory: throttled.deviceMemory,
  };
  await screenshot(page, join(evidence, "screenshots", "mobile-active-throttled.png"), { fullPage: true });

  assert.equal(errors.length, 0, errors.join("\n"));
  run.finishedAt = new Date().toISOString();
  run.totalMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  await writeJson(join(evidence, "run.json"), run);
  console.log(`${branch}: PASS`, {
    episodeId,
    totalSeconds: Math.round(run.totalMs / 1000),
    resume: run.resumeCheck,
    outcome: run.outcome,
    sceneSeconds: run.scenes.map((scene) => [scene.number, Math.round(scene.elapsedMs / 1000)]),
    consequences: run.scenes.filter((scene) => scene.consequence).map((scene) => [scene.number, scene.consequence]),
  });
  await context.close();
} finally {
  await browser.close();
}
