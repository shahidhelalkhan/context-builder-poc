import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { readAllFiles } from "./utils/loadFiles.js";
import { chunkFiles } from "./utils/chunkFiles.js";
import { VectorStore } from "./utils/retrieve.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, "..", "vector-index.json");
const LOCK_PATH = path.join(__dirname, "..", ".index.lock");

function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const pid = fs.readFileSync(LOCK_PATH, "utf8").trim();
    try { process.kill(Number(pid), 0); }
    catch { fs.rmSync(LOCK_PATH); return true; }
    console.error(`Another process is running (pid ${pid}). Remove ${LOCK_PATH} if stale.`);
    process.exit(1);
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
  process.on("exit", () => { if (fs.existsSync(LOCK_PATH)) fs.rmSync(LOCK_PATH); });
  process.on("SIGINT", () => { if (fs.existsSync(LOCK_PATH)) fs.rmSync(LOCK_PATH); process.exit(0); });
}

function saveIndex(store) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify({ vectors: store.vectors, meta: store.meta }));
  console.log(`Saved index (${store.size} chunks) to ${INDEX_PATH}`);
}

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) return null;
  const raw = fs.readFileSync(INDEX_PATH, "utf8");
  const data = JSON.parse(raw);
  const store = new VectorStore();
  store.vectors = data.vectors;
  store.meta = data.meta;
  return store;
}

function progressBar(current, total, width = 30) {
  const pct = total === 0 ? 0 : current / total;
  const filled = Math.floor(width * pct);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return `[${bar}] ${Math.floor(pct * 100)}% (${current}/${total})`;
}

function spinner(msg, last) {
  const chars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const i = ( Date.now() / 80 | 0 ) % chars.length;
  process.stdout.write(`\r  ${chars[i]} ${msg}${last ? "\n" : ""}`);
}

async function build(dataDir) {
  acquireLock();
  const t0 = Date.now();

  console.log(`Scanning ${dataDir}...`);
  const files = [];
  for (const f of readAllFiles(dataDir)) {
    files.push(f);
    if (files.length % 500 === 0) console.log(`  Read ${files.length} files...`);
  }
  console.log(`  Found ${files.length} files${files.length > 500 ? ` (${files.length.toLocaleString()})` : ""}`);

  console.log("Chunking...");
  const chunks = [];
  let lastLog = 0;
  for (const c of chunkFiles(files)) {
    chunks.push(c);
    if (chunks.length - lastLog >= 200) {
      process.stdout.write(`\r  Collecting chunks: ${chunks.length}`);
      lastLog = chunks.length;
    }
  }
  console.log(`\r  Total chunks: ${chunks.length}`);

  console.log("Generating embeddings...\n");
  const store = new VectorStore();
  const texts = chunks.map(c => `${c.path}\n\n${c.heading || ""}\n\n${c.text}`);

  const BATCH = 25;
  const batches = Math.ceil(texts.length / BATCH);
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    await store.addBatch(batch);
    const done = Math.min(i + BATCH, texts.length);
    process.stdout.write(`\r  ${progressBar(done, texts.length)} chunks embedded`);
  }
  console.log("\n");

  saveIndex(store);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Done in ${secs}s. Index size: ${store.size}`);
}

async function search(query, topK) {
  const store = loadIndex();
  if (!store) { console.error("No index found. Run `npm run index` first."); process.exit(1); }
  console.log(`Searching "${query}" (top ${topK || 5})...\n`);
  const results = await store.search(query, Number(topK) || 5);
  if (results.length === 0) { console.log("No results above threshold."); return; }
  for (const { score, meta } of results) {
    console.log(`score: ${score.toFixed(4)}`);
    console.log(meta.slice(0, 400));
    console.log("─".repeat(80));
  }
}

const cmd = process.argv[2];
const arg1 = process.argv[3];

if (cmd === "build") {
  build(arg1 || "data").catch(e => { console.error(e); if (fs.existsSync(LOCK_PATH)) fs.rmSync(LOCK_PATH); process.exit(1); });
} else if (cmd === "search") {
  search(arg1, process.argv[4]).catch(console.error);
} else {
  console.log("Usage:\n  npm run index [dataDir]     — build/rebuild index\n  npm run search -- <query> [topK]  — search index");
}
