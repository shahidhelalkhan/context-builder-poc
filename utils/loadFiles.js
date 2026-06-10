import fs from "fs";
import path from "path";

export function* readAllFiles(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  const SKIP = new Set(["node_modules", ".git", ".vercel", "dist", "build", ".next", "coverage"]);
  for (const file of files) {
  if (file.name.startsWith(".") || SKIP.has(file.name)) continue
  if (file.isDirectory()) {
    yield* readAllFiles(path.join(dir, file.name));
  } else {
    const filePath = path.join(dir, file.name);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      yield { path: filePath, content };
    } catch { /* skip binary or unreadable files */ }
  }
}
}
