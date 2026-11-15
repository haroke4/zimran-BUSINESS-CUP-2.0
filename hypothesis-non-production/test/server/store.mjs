import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class BaseStore {
  constructor(episodes = {}) {
    this.episodes = episodes;
    this.locks = new Map();
  }

  async read(id) {
    return clone(this.episodes[id] ?? null);
  }

  async write(episode) {
    if (!episode?.id) throw new Error("Episode needs an id");
    this.episodes[episode.id] = clone(episode);
    return clone(this.episodes[episode.id]);
  }

  async withLock(id, task) {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.then(task, task);
    const guard = run.catch(() => {}).finally(() => {
      if (this.locks.get(id) === guard) this.locks.delete(id);
    });
    this.locks.set(id, guard);
    return run;
  }

  async list() {
    return Object.values(this.episodes).map((episode) => clone(episode));
  }
}

export class MemoryStore extends BaseStore {}

export class FileStore extends BaseStore {
  constructor(file, { logger = console } = {}) {
    super({});
    this.file = file;
    this.logger = logger;
    this.persistQueue = Promise.resolve();
  }

  static async open(file, { logger = console } = {}) {
    const store = new FileStore(file, { logger });
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      store.episodes = parsed.episodes ?? {};
      if (parsed.schemaVersion !== 1) logger.warn?.(`[store] unexpected schema ${parsed.schemaVersion}; loading episodes anyway`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        const backup = `${file}.corrupt-${Date.now()}`;
        try {
          await rename(file, backup);
          logger.warn?.(`[store] unreadable episode file moved to ${backup}: ${error.message}`);
        } catch (backupError) {
          logger.warn?.(`[store] unreadable episode file: ${error.message}`);
        }
      }
    }
    return store;
  }

  async write(episode) {
    await super.write(episode);
    this.persistQueue = this.persistQueue.then(() => this.persist()).catch((error) => {
      this.logger.error?.(`[store] persist failed: ${error.message}`);
      throw error;
    });
    return this.persistQueue;
  }

  async persist() {
    await mkdir(dirname(this.file), { recursive: true });
    const payload = JSON.stringify({ schemaVersion: 1, episodes: this.episodes }, null, 2);
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, payload, "utf8");
    await rename(temporary, this.file);
  }
}
