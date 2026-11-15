import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

function rasterize(source, target) {
  if (process.platform === "darwin") {
    execFileSync("sips", ["-s", "format", "png", source, "--out", target]);
    return;
  }

  execFileSync("rsvg-convert", ["--output", target, source]);
}

function dimensions(path) {
  const result = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path],
    { encoding: "utf8" },
  );
  return JSON.parse(result).streams[0];
}

function decodeRgba(path, bytes) {
  return execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-frames:v", "1", "-threads", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: bytes + 1024 },
  );
}

function encodePng(path, width, height, rgba) {
  execFileSync(
    "ffmpeg",
    ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size",
      `${width}x${height}`, "-i", "-", "-frames:v", "1", "-threads", "1", path],
    { input: rgba },
  );
}

function compareEncodings(png, webp) {
  execFileSync("cwebp", ["-quiet", "-lossless", "-exact", png, "-o", webp]);

  const size = dimensions(png);
  const decodedBytes = size.width * size.height * 4;
  assert.deepEqual(dimensions(webp), size);
  const rgba = decodeRgba(png, decodedBytes);
  assert.equal(rgba.length, decodedBytes);
  assert.ok(rgba.equals(decodeRgba(webp, decodedBytes)), `WebP pixel mismatch: ${png}`);

  let transparent = 0;
  let translucent = 0;
  for (let pixel = 3; pixel < rgba.length; pixel += 4) {
    if (rgba[pixel] === 0) transparent++;
    else if (rgba[pixel] < 255) translucent++;
  }

  return {
    ...size,
    rgba,
    pngBytes: statSync(png).size,
    webpBytes: statSync(webp).size,
    decodedBytes,
    transparent,
    translucent,
  };
}

function publicStats(asset, { width, height, rgba, ...stats }) {
  return { asset, dimensions: `${width}×${height}`, ...stats };
}

function compareAtlas(images, workDirectory) {
  const padding = 2;
  const sorted = [...images].sort((a, b) => b.height - a.height);
  const totalArea = images.reduce((area, { width, height }) => area + width * height, 0);
  const rowWidth = Math.max(Math.ceil(Math.sqrt(totalArea)), ...images.map(({ width }) => width));
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let atlasWidth = 0;
  const positions = sorted.map((image) => {
    if (x > 0 && x + image.width > rowWidth) {
      x = 0;
      y += rowHeight + padding;
      rowHeight = 0;
    }
    const position = { image, x, y };
    atlasWidth = Math.max(atlasWidth, x + image.width);
    rowHeight = Math.max(rowHeight, image.height);
    x += image.width + padding;
    return position;
  });
  const atlasHeight = y + rowHeight;
  const atlas = Buffer.alloc(atlasWidth * atlasHeight * 4);
  for (const { image, x, y } of positions) {
    for (let line = 0; line < image.height; line++) {
      const sourceStart = line * image.width * 4;
      const targetStart = ((y + line) * atlasWidth + x) * 4;
      image.rgba.copy(atlas, targetStart, sourceStart, sourceStart + image.width * 4);
    }
  }

  const png = join(workDirectory, "atlas.png");
  const webp = join(workDirectory, "atlas.webp");
  encodePng(png, atlasWidth, atlasHeight, atlas);
  const encodings = compareEncodings(png, webp);
  assert.equal(encodings.width, atlasWidth);
  assert.equal(encodings.height, atlasHeight);
  assert.ok(encodings.rgba.equals(atlas), "Atlas raster mismatch.");
  return encodings;
}

const assetDirectory = fileURLToPath(new URL("./assets/", import.meta.url));
const inputPaths = process.argv.slice(2);
const sources = inputPaths.length
  ? inputPaths.map((path) => resolve(path))
  : readdirSync(assetDirectory)
      .filter((path) => path.toLowerCase().endsWith(".svg"))
      .sort()
      .map((path) => join(assetDirectory, path));

assert.ok(sources.length, "Pass at least one SVG to compare.");
const workDirectory = mkdtempSync(join(tmpdir(), "framebreak-textures-"));
try {
  const images = sources.map((source, index) => {
    const rasterized = join(workDirectory, `${index}.source.png`);
    const png = join(workDirectory, `${index}.png`);
    const webp = join(workDirectory, `${index}.webp`);
    const svg = readFileSync(source);
    rasterize(source, rasterized);
    const { width, height } = dimensions(rasterized);
    const rgba = decodeRgba(rasterized, width * height * 4);
    encodePng(png, width, height, rgba);
    const encodings = compareEncodings(png, webp);
    assert.ok(encodings.rgba.equals(rgba), `PNG raster mismatch: ${source}`);
    return {
      ...encodings,
      asset: basename(source),
      svgBytes: svg.length,
      svgGzipBytes: gzipSync(svg).length,
    };
  });
  const rows = images.map(({ asset, ...image }) => publicStats(asset, image));
  if (images.length > 1) {
    const totals = {};
    for (const key of ["svgBytes", "svgGzipBytes", "pngBytes", "webpBytes", "decodedBytes", "transparent", "translucent"]) {
      totals[key] = images.reduce((sum, image) => sum + image[key], 0);
    }
    rows.push({ asset: "individual totals", ...totals });
    rows.push(publicStats("packed atlas", compareAtlas(images, workDirectory)));
  }
  console.table(rows);
  console.log("All decoded PNG and lossless WebP RGBA pixels matched.");
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
