import assert from 'node:assert/strict';

const secondsPerScene = 30;
const scenesPerChapter = 20;
const recentSceneCount = 3;
const fixtureMemoryBudgetBytes = 2_200;
const pinnedFacts = ['cast.mara.status', 'thread.signal_origin'];
const currentSceneFacts = [
    'gear.maintenance_key.owner',
    'prop.south_service_locker.state',
    'knowledge.iris.maintenance_bypass',
    'knowledge.mara.maintenance_bypass',
];

function makeScene(number) {
    const chapter = Math.ceil(number / scenesPerChapter);
    const scene = {
        number,
        chapter,
        synopsis: `Iris follows the repeated distress signal through service passage ${number}. `
            + 'A ventilation grille rattles behind her as the emergency lights go dark. '
            + 'Mara warns her over the radio that the next pulse may trigger the station locks.',
        choice: 'Follow the signal before the lights come back.',
        changes: { 'cast.iris.location': `passage_${number}` },
    };

    if (number === 2) {
        scene.synopsis = 'Iris takes a hidden maintenance key from the south service locker and reads the bypass sequence. '
            + 'Mara hears the distress signal from the far end of the station and asks Iris to trace it.';
        scene.changes = {
            ...scene.changes,
            'cast.mara.status': 'alive',
            'gear.maintenance_key.owner': 'iris',
            'prop.south_service_locker.state': 'open',
            'knowledge.iris.maintenance_bypass': '7291',
            'knowledge.mara.maintenance_bypass': false,
            'thread.signal_origin': 'open',
        };
    }
    if (number === 62) {
        scene.synopsis = 'Iris hands the maintenance key to Mara while they cross the flooded bridge.';
        scene.changes['gear.maintenance_key.owner'] = 'mara';
    }
    return scene;
}

function newStory() {
    return {
        archive: [],
        facts: new Map(),
        checkpoint: { throughScene: 0, recap: 'Find the source of the distress signal.' },
    };
}

function saveCheckpoint(story) {
    const throughScene = story.archive.length;
    const chapterStartIndex = Math.floor((throughScene - 1) / scenesPerChapter) * scenesPerChapter;
    const chapterStart = story.archive[chapterStartIndex];
    const chapterEnd = story.archive.at(-1);
    story.checkpoint = {
        throughScene,
        recap: `Iris traced the distress signal from passage ${chapterStart.number} through passage ${chapterEnd.number}. `
            + 'The signal still leads farther into the station.',
    };
}

function commit(story, scene, expectedRevision) {
    assert.equal(story.archive.length, expectedRevision, 'Reject a stale branch');
    assert.equal(scene.number, expectedRevision + 1, 'Commit each scene once and in sequence');
    for (const [id, value] of Object.entries(scene.changes)) {
        story.facts.set(id, { value, lastChangedAt: scene.number });
    }
    story.archive.push(scene);
    if (scene.number % scenesPerChapter === 0) {
        saveCheckpoint(story);
    }
}

function getWriterMemory(story, requestedFacts) {
    const factIds = new Set([...pinnedFacts, 'cast.iris.location', ...requestedFacts]);
    const facts = {};
    for (const id of factIds) {
        if (story.facts.has(id)) {
            facts[id] = story.facts.get(id);
        }
    }
    const recent = story.archive.slice(-recentSceneCount).map(({ number, synopsis, choice }) => ({
        number,
        synopsis,
        choice,
    }));
    return { checkpoint: story.checkpoint, recent, facts };
}

function byteSize(memory) {
    return Buffer.byteLength(JSON.stringify(memory));
}

function assertRecall(story, sceneNumber, owner) {
    const packet = getWriterMemory(story, currentSceneFacts);
    const { facts, recent, checkpoint } = packet;
    assert.equal(facts['gear.maintenance_key.owner'].value, owner);
    assert.equal(facts['prop.south_service_locker.state'].value, 'open');
    assert.equal(facts['knowledge.iris.maintenance_bypass'].value, '7291');
    assert.equal(facts['knowledge.mara.maintenance_bypass'].value, false);
    assert.equal(facts['cast.mara.status'].value, 'alive');
    assert.equal(facts['thread.signal_origin'].value, 'open');
    assert.equal(facts['prop.south_service_locker.state'].lastChangedAt, 2);
    assert.equal(recent.at(-1).number, sceneNumber);
    assert.equal(recent.length, recentSceneCount);
    assert.ok(!JSON.stringify({ checkpoint, recent }).includes('south service locker'), 'Prose has dropped the early fact');
    assert.equal(story.archive[1].changes['prop.south_service_locker.state'], 'open', 'The archive still carries the original delta');
    assert.ok(!Object.hasOwn(getWriterMemory(story, []).facts, 'prop.south_service_locker.state'));
}

function runEpisode(sceneCount) {
    const story = newStory();
    let fullTotal = 0;
    let boundedTotal = 0;
    let boundedPeak = 0;
    for (let number = 1; number <= sceneCount; number += 1) {
        fullTotal += byteSize(story.archive);
        const boundedBytes = byteSize(getWriterMemory(story, currentSceneFacts));
        boundedTotal += boundedBytes;
        boundedPeak = Math.max(boundedPeak, boundedBytes);
        commit(story, makeScene(number), number - 1);
        if ([10, 60, 120].includes(number)) {
            assertRecall(story, number, number < 62 ? 'iris' : 'mara');
        }
    }

    if (story.checkpoint.throughScene < sceneCount) {
        saveCheckpoint(story);
    }
    const revision = story.archive.length;
    assert.equal(story.checkpoint.throughScene, revision);
    const memory = getWriterMemory(story, currentSceneFacts);
    const fullBytes = byteSize(story.archive);
    const boundedBytes = byteSize(memory);
    assert.ok(Math.max(boundedBytes, boundedPeak) <= fixtureMemoryBudgetBytes);
    assert.ok(boundedBytes < fullBytes);
    return { story, revision, fullBytes, boundedBytes, fullTotal, boundedTotal, boundedPeak };
}

const budgets = { input: 3_300, billedOutput: 900 };
const price = { input: 0.30, billedOutput: 2.50 };
const pricePerCandidate = (budgets.input * price.input + budgets.billedOutput * price.billedOutput) / 1_000_000;
const episodes = [runEpisode(10), runEpisode(120)];

console.log('Synthetic writer-memory benchmark. Sizes are JSON UTF-8 bytes, with no tokenizer or model call.');
console.table(episodes.map(({ revision, fullBytes, boundedBytes, fullTotal, boundedTotal, boundedPeak }) => ({
    scenes: revision,
    playbackMinutes: revision * secondsPerScene / 60,
    fullPromptMemoryBytes: fullBytes,
    boundedPromptMemoryBytes: boundedBytes,
    cumulativeFullMemoryBytes: fullTotal,
    cumulativeBoundedMemoryBytes: boundedTotal,
    peakBoundedRequestBytes: boundedPeak,
})));

const paid = episodes.at(-1);
const checkpoint = paid.story.checkpoint;
const archivedLastScene = paid.story.archive.at(-1);
const savedStory = JSON.parse(JSON.stringify({ ...paid.story, facts: [...paid.story.facts] }));
const partTwo = { ...savedStory, facts: new Map(savedStory.facts) };
const candidate = makeScene(121);
const unchosenCandidate = { ...candidate, changes: { 'cast.mara.status': 'dead' } };
commit(partTwo, candidate, 120);
assert.throws(() => commit(partTwo, unchosenCandidate, 120), /Reject a stale branch/);
assertRecall(partTwo, 121, 'mara');
assert.equal(checkpoint.throughScene, 120);
assert.deepEqual(partTwo.archive[119], archivedLastScene);
assert.deepEqual(partTwo.checkpoint, checkpoint);
console.log('PASS early locker state and private knowledge at scenes 10/60/120; updated key owner; open thread.');
console.log('PASS part two starts at scene 121 with the last checkpoint; stale alternate branch rejected.');

console.log('Cost model for writer and composer together, using assumed tokens and Gemini 3.5 Flash-Lite Standard rates.');
console.table(episodes.map(({ revision }) => {
    const prefetchCandidates = 1 + 2 * (revision - 1);
    return {
        scenes: revision,
        chosenPathCalls: revision * 2,
        chosenPathUSD: (revision * pricePerCandidate).toFixed(4),
        prefetchBothCalls: prefetchCandidates * 2,
        prefetchBothUSD: (prefetchCandidates * pricePerCandidate).toFixed(4),
    };
}));
console.log('Cost excludes repairs, checkpoint summaries, media and hosting. Timelines and story quality require a live model test.');
