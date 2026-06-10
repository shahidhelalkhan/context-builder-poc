import { readAllFiles } from "./utils/loadFiles.js";
import { chunkFiles } from "./utils/chunkFiles.js";
import { buildIndex } from "./utils/retrieve.js";

async function main() {
  console.log("Chunking files...");
  const chunks = [...chunkFiles(readAllFiles("data/job-heist"))];
  console.log(`  Total chunks: ${chunks.length}`);

  console.log("\nBuilding vector index (first run caches model)...");
  const index = await buildIndex(chunks);
  console.log(`  Index size: ${index.size}`);

  const query = process.argv[2] || "how is authentication implemented";
  const results = await index.search(query, 5);

  console.log(`\nQuery: "${query}"\n`);
  for (const { score, meta } of results) {
    console.log(`score: ${score.toFixed(4)}`);
    console.log(meta.slice(0, 300));
    console.log();
  }
}

main().catch(console.error);
