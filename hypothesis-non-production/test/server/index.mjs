import { createModelClient } from "./model-client.mjs";
import { MemoryStore } from "./store.mjs";
import { createStoryEngine } from "./engine.mjs";
import { createApiServer } from "./app.mjs";
import { createStoryforkGenerator, createStoryforkModel } from "./storyfork-scene.mjs";

const port = Number(process.env.FRAMEBREAK_PORT ?? 8787);
const host = process.env.FRAMEBREAK_HOST ?? "127.0.0.1";
const model = createModelClient();
// Test mode is intentionally ephemeral: restart the API to clear all stories.
const store = new MemoryStore();
const engine = createStoryEngine({ model, store });
const server = createApiServer({ engine, model, generateStoryforkScene: createStoryforkGenerator(createStoryforkModel()) });

server.listen(port, host, () => {
  console.log(`FRAMEBREAK local API on http://${host}:${port}`);
  console.log(`LLM ${model.config.provider}/${model.config.model}`);
  console.log("In-memory mode: stories are cleared when the API restarts");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
