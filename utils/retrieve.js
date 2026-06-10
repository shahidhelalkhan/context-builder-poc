const LM_BASE = "http://localhost:1234/v1";
const LM_EMBED_MODEL = "text-embedding-nomic-embed-text-v1.5";
const MAX_EMBED_CHARS = 6000;

async function fetchEmbedding(text) {
  const truncated = text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
  const res = await fetch(`${LM_BASE}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: LM_EMBED_MODEL, input: truncated }),
  });
  if (!res.ok) throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

export class VectorStore {
  constructor() {
    this.vectors = [];
    this.meta = [];
  }

  async add(text) {
    const vec = await fetchEmbedding(text);
    this.vectors.push(vec);
    this.meta.push(text);
    return this.size - 1;
  }

  async addBatch(texts) {
    const BATCH = 64;
    const results = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const embeddings = await Promise.all(batch.map(fetchEmbedding));
      results.push(...embeddings);
      const done = Math.min(i + BATCH, texts.length);
      process.stdout.write(`\r  ${progressBar(done, texts.length)}`);
    }
    console.log();
    this.vectors.push(...results);
    this.meta.push(...texts);
    return { start: this.vectors.length - results.length, end: this.vectors.length };
  }

  cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] ** 2;
      nb += b[i] ** 2;
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
  }

  async search(query, topK = 5, threshold = 0.2) {
    const qVec = await fetchEmbedding(query);
    const scored = new Array(this.vectors.length);
    for (let i = 0; i < this.vectors.length; i++) {
      scored[i] = { score: this.cosineSimilarity(qVec, this.vectors[i]), meta: this.meta[i] };
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.filter(r => r.score >= threshold).slice(0, topK);
  }

  get size() { return this.vectors.length; }
}

function progressBar(current, total, width = 30) {
  const pct = total === 0 ? 0 : current / total;
  const filled = Math.floor(width * pct);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${Math.floor(pct * 100)}% (${current}/${total})`;
}

export async function buildIndex(chunksIterable) {
  const store = new VectorStore();
  const texts = [];
  for (const chunk of chunksIterable) {
    texts.push(`${chunk.path}\n\n${chunk.heading || ""}\n\n${chunk.text}`);
  }
  await store.addBatch(texts);
  return store;
}
