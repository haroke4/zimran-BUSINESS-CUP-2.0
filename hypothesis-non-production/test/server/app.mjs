import http from "node:http";
import { EpisodeError } from "./errors.mjs";
import { readStoryforkAsset } from "./storyfork-scene.mjs";

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...(response.headersSent ? {} : {}),
  });
  response.end(body);
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (!origin) return;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65_536) throw new EpisodeError("body_too_large", "Request body is too large", { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new EpisodeError("invalid_json", "Request body must be JSON", { status: 400 });
  }
}

function route(pathname) {
  if (pathname === "/api/health") return { name: "health" };
  if (pathname === "/api/episodes") return { name: "episodes" };
  if (pathname === "/api/storyfork/scenes") return { name: "storyfork-scenes" };
  const asset = pathname.match(/^\/api\/storyfork\/art\/([a-z0-9_/]+\.svg)$/);
  if (asset) return { name: "storyfork-art", path: asset[1] };
  const match = pathname.match(/^\/api\/episodes\/([A-Za-z0-9-]+)(?:\/(choices|export))?$/);
  if (!match) return null;
  if (match[2] === "choices") return { name: "choices", id: match[1] };
  if (match[2] === "export") return { name: "export", id: match[1] };
  return { name: "episode", id: match[1] };
}

export function createApiHandler({ engine, model, generateStoryforkScene, logger = console, startedAt = Date.now() }) {
  return async function handle(request, response) {
    setCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    const url = new URL(request.url, "http://127.0.0.1");
    const match = route(url.pathname);
    if (!match) {
      sendJson(response, 404, { error: { code: "not_found", message: "Unknown route" } });
      return;
    }

    const begin = performance.now();
    try {
      if (match.name === "storyfork-scenes" && request.method === "POST" && generateStoryforkScene) {
        const body = await readJson(request);
        if (request.headers.accept !== "application/x-ndjson") {
          sendJson(response, 200, { scene: await generateStoryforkScene(body) });
          return;
        }
        const emit = (value) => {
          if (!response.headersSent) response.writeHead(200, {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-store",
          });
          response.write(`${JSON.stringify(value)}\n`);
        };
        try {
          const scene = await generateStoryforkScene(body, (progress) => emit({ progress }));
          emit({ scene });
        } catch (error) {
          if (!response.headersSent) throw error;
          emit({ error: { message: error.message } });
          logger.error?.(`[storyfork] ${error.message}: ${error.cause?.message ?? error.details?.cause ?? ""}`);
        }
        response.end();
        return;
      }
      if (match.name === "storyfork-art" && request.method === "GET") {
        const content = await readStoryforkAsset(match.path);
        if (!content) throw new EpisodeError("not_found", "Unknown asset", { status: 404 });
        response.writeHead(200, {
          "Content-Type": "image/svg+xml",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          "Cache-Control": "public, max-age=3600",
        });
        response.end(content);
        return;
      }
      if (match.name === "health" && request.method === "GET") {
        const modelHealth = await model.health();
        sendJson(response, modelHealth.ok ? 200 : 503, {
          ok: modelHealth.ok,
          uptimeMs: Date.now() - startedAt,
          api: "framebreak-local",
          model: modelHealth,
        });
        return;
      }
      if (match.name === "episodes" && request.method === "POST") {
        const body = await readJson(request);
        const episode = await engine.createEpisode(body);
        sendJson(response, 201, { episode, resumed: false });
        return;
      }
      if (match.name === "episode" && request.method === "GET") {
        const episode = await engine.getEpisode(match.id);
        sendJson(response, 200, { episode, resumed: true });
        return;
      }
      if (match.name === "export" && request.method === "GET") {
        const episode = await engine.exportEpisode(match.id);
        sendJson(response, 200, { episode });
        return;
      }
      if (match.name === "choices" && request.method === "POST") {
        const body = await readJson(request);
        const result = await engine.submitChoice(match.id, body);
        sendJson(response, 200, result);
        return;
      }
      sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } });
    } catch (error) {
      const status = error instanceof EpisodeError ? error.status : 500;
      if (status >= 500) logger.error?.(`[api] ${request.method} ${url.pathname} failed: ${error.stack ?? error.message}`);
      sendJson(response, status, {
        error: error instanceof EpisodeError
          ? error.toJSON()
          : { code: "internal", message: error.message, retryable: false },
      });
    } finally {
      logger.info?.(`[api] ${request.method} ${url.pathname} ${Math.round(performance.now() - begin)}ms`);
    }
  };
}

export function createApiServer(options) {
  return http.createServer(createApiHandler(options));
}
