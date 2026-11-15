const synonyms = [
  ["city", "metropolitan", "urban"],
  ["puddle", "rainwater", "standing water"],
  ["tower", "high-rise", "skyscraper"],
  ["detached", "freestanding", "standalone"],
  ["low-rise", "short building", "low building"],
  ["night", "nocturnal", "after dark"],
  ["alley", "side passage", "service lane"],
  ["cabinet", "cupboard", "locker"],
  ["industrial", "factory", "warehouse"],
].map((group) => group.map((term) => ` ${term.replaceAll("-", " ")} `));

function words(text) {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function matchedAliases(text) {
  const normalized = ` ${words(text).join(" ")} `;
  const matches = new Set();

  for (const group of synonyms) {
    if (group.some((term) => normalized.includes(term))) {
      matches.add(group[0]);
    }
  }

  return matches;
}

function scoreMatches(query, subject) {
  let score = 0;
  for (const term of query) {
    if (subject.has(term)) score += 1;
  }
  return score;
}

function rank(catalog, need, limit, expandAliases) {
  const text = (value) => new Set(words(value));
  const query = `${need.tags?.join(" ") ?? ""} ${need.hint ?? ""}`;
  const exactQuery = text(query);
  const aliasedQuery = expandAliases ? matchedAliases(query) : null;
  const scores = [];

  for (const asset of catalog) {
    if (asset.category !== need.category) continue;
    if (need.requires?.some((value) => !asset.capabilities?.includes(value))) continue;
    if (need.excludeTags?.some((value) => asset.tags.includes(value))) continue;

    const tagText = asset.tags.join(" ");
    const description = `${asset.id} ${asset.description}`;
    let score = 3 * scoreMatches(exactQuery, text(tagText));
    score += scoreMatches(exactQuery, text(description));
    if (aliasedQuery?.size) {
      score += 4 * scoreMatches(aliasedQuery, matchedAliases(tagText));
      score += scoreMatches(aliasedQuery, matchedAliases(description));
    }
    scores.push({ asset, score });
  }

  scores.sort((left, right) => right.score - left.score || left.asset.id.localeCompare(right.asset.id));
  return scores.slice(0, limit).map(({ asset }) => asset);
}

export function shortlist(catalog, need, limit = 4) {
  return rank(catalog, need, limit, true);
}

export function lexicalShortlist(catalog, need, limit = 4) {
  return rank(catalog, need, limit, false);
}

export function assetCard({ id, category, tags, description, capabilities }) {
  return { id, category, tags, description, ...(capabilities?.length && { capabilities }) };
}
