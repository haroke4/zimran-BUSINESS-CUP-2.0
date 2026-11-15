import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { assetCard, lexicalShortlist, shortlist } from "./retrieval.mjs";
import { queries, syntheticCatalog } from "./retrieval-fixtures.mjs";

const bytes = (entries) => Buffer.byteLength(JSON.stringify(entries.map(assetCard)));
const semanticFile = fileURLToPath(new URL("./retrieval-embeddings.swift", import.meta.url));

function compatible(asset, need) {
  return asset.category === need.category
    && (!need.requires || need.requires.every((action) => asset.capabilities.includes(action)))
    && (!need.excludeTags || need.excludeTags.every((tag) => !asset.tags.includes(tag)));
}

function run(catalog, search) {
  let hits = 0;
  let firstHits = 0;
  let emptyHits = 0;
  let incompatible = 0;
  let totalBytes = 0;
  const misses = [];
  const timings = [];

  for (const query of queries) search(catalog, query);

  for (const query of queries) {
    const started = performance.now();
    const result = search(catalog, query);
    timings.push(performance.now() - started);
    totalBytes += bytes(result);
    incompatible += result.filter((asset) => !compatible(asset, query)).length;

    if (query.expected.length === 0) {
      emptyHits += Number(result.length === 0);
      continue;
    }

    firstHits += Number(query.expected.includes(result[0]?.id));
    if (result.some((asset) => query.expected.includes(asset.id))) {
      hits += 1;
    } else {
      misses.push(query.name);
    }
  }

  timings.sort((left, right) => left - right);
  return {
    top1: firstHits,
    top4: hits,
    unknowns: emptyHits,
    incompatible,
    avgJSONBytes: Math.round(totalBytes / queries.length),
    localP95Ms: Number(timings[Math.ceil(timings.length * 0.95) - 1].toFixed(2)),
    misses,
  };
}

function embeddingIndex() {
  const assetText = ({ tags, description }) => `${tags.join(", ")}. ${description}.`;
  const queryText = ({ tags, hint }) => `${tags?.join(" ") ?? ""} ${hint ?? ""}`.trim();
  const documents = [...new Set([
    ...syntheticCatalog(10_000).map(assetText),
    ...queries.map(queryText),
  ])];
  const started = performance.now();
  const r = spawnSync("swift", [semanticFile], { input: JSON.stringify(documents), encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.error?.message ?? r.stderr.trim());
  const vectors = new Map(Object.entries(JSON.parse(r.stdout)));
  console.log(`Apple sentence embeddings: ${documents.length} distinct strings in ${(performance.now() - started).toFixed(0)} ms including Swift startup.`);

  function ranked(catalog, need) {
    const query = vectors.get(queryText(need));
    return catalog.filter((asset) => compatible(asset, need)).map((asset) => {
      const subject = vectors.get(assetText(asset));
      const score = subject.reduce((sum, component, index) => sum + component * query[index], 0);
      return { asset, score };
    }).sort((left, right) => right.score - left.score || left.asset.id.localeCompare(right.asset.id));
  }

  return {
    "Hard filters + semantic": (catalog, need) => ranked(catalog, need).slice(0, 4).map(({ asset }) => asset),
    "Hard filters + hybrid RRF": (catalog, need) => {
      const lexical = lexicalShortlist(catalog, need, 20);
      const semantic = ranked(catalog, need).slice(0, 20).map(({ asset }) => asset);
      const scores = new Map();

      for (const list of [lexical, semantic]) {
        list.forEach((asset, index) => scores.set(asset, (scores.get(asset) ?? 0) + 1 / (60 + index + 1)));
      }

      return [...scores.entries()]
        .sort(([first, left], [second, right]) => right - left || first.id.localeCompare(second.id))
        .slice(0, 4)
        .map(([asset]) => asset);
    },
  };
}

const searchMethods = {
  "Hard filters + lexical": lexicalShortlist,
  "Hard filters + lexical + aliases": shortlist,
  ...(process.argv.includes("--semantic") ? embeddingIndex() : {}),
};

for (const size of [100, 1_000, 10_000]) {
  const catalog = syntheticCatalog(size);
  assert.equal(catalog.length, size);
  const methods = Object.entries(searchMethods).map(([label, search]) => [label, run(catalog, search)]);

  for (const [label, result] of methods) {
    assert.equal(result.incompatible, 0, label);
    assert.equal(result.unknowns, 2, label);
  }

  console.log(`\n${size.toLocaleString("en-US")} metadata cards`);
  console.log(`Full catalog: ${bytes(catalog).toLocaleString("en-US")} JSON bytes per scene context. All gold assets are included by construction, unranked.`);
  console.table(Object.fromEntries(methods.map(([label, result]) => [label, { ...result, misses: result.misses.join(", ") }])));
}

console.log("Top-1/4 count of 16 answerable queries. Unknowns count of 2 impossible queries. Ranking timings use precomputed vectors for semantic methods. Byte counts cover asset cards only and are not model token counts.");
