import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";
import CLanguage from "tree-sitter-c";
import path from "path";

const MAX_CHUNK_CHARS = 3000;

const CODE_EXTS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "c", "h", "hpp", "cpp",
]);

const LANG_MAP = {
  js: { ts: false, jsx: false, lang: () => JavaScript },
  jsx: { ts: false, jsx: true, lang: () => JavaScript },
  ts: { ts: true, jsx: false, lang: () => TypeScript.ts },
  tsx: { ts: true, jsx: true, lang: () => TypeScript.tsx },
  mjs: { ts: false, jsx: false, lang: () => JavaScript },
  cjs: { ts: false, jsx: false, lang: () => JavaScript },
  py: { ts: false, jsx: false, lang: () => Python },
  c: { ts: false, jsx: false, lang: () => CLanguage },
  h: { ts: false, jsx: false, lang: () => CLanguage },
  hpp: { ts: false, jsx: false, lang: () => CLanguage },
  cpp: { ts: false, jsx: false, lang: () => CLanguage },
};

const TOP_LEVEL_TYPES = new Set([
  "function_declaration", "class_declaration", "method_definition",
  "variable_declaration", "lexical_declaration",
  "export_statement", "import_statement",
  "interface_declaration", "type_alias_declaration",
  "enum_declaration",
]);

const parserCache = new Map();

function getParser(filePath) {
  const key = path.extname(filePath).slice(1);
  const entry = LANG_MAP[key];
  if (!entry) return null;
  if (!parserCache.has(key)) {
    try {
      const language = entry.lang();
      const p = new Parser();
      p.setLanguage(language);
      parserCache.set(key, p);
    } catch {
      return null;
    }
  }
  return parserCache.get(key);
}

function extractCodeChunks(filePath, content, parser) {
  let tree;
  try { tree = parser.parse(content); } catch { return null; }
  const root = tree.rootNode;

  const chunks = [];

  function nodeSource(node) {
    return content.slice(node.startByte, node.endByte);
  }

  function nodeHeading(node) {
    const text = nodeSource(node).split("\n")[0].trim();
    return text.length > 80 ? text.slice(0, 77) + "..." : text;
  }

  function traverse(node) {
    if (TOP_LEVEL_TYPES.has(node.type)) {
      const text = nodeSource(node);
      chunks.push({ text, heading: nodeHeading(node), type: "code" });
      return;
    }

    if (node.namedChildren.length === 0) return;

    for (const child of node.namedChildren) {
      traverse(child);
    }
  }

  traverse(root);

  if (chunks.length <= 1) {
    return chunks;
  }

  const filtered = chunks.filter(c => c.text.trim().length > 30);
  return filtered.length > 0 ? filtered : chunks;
}

const TEXT_SPLIT_RE = /\n\n+|\r\n\r\n+/;

export function analyzeFile(fileObj) {
  const { path: filePath, content } = fileObj;
  const trimmed = content.trim();

  const parser = getParser(filePath);
  if (parser) {
    const codeChunks = extractCodeChunks(filePath, trimmed, parser);
    if (codeChunks && codeChunks.length > 0) {
      return { filePath, chunks: codeChunks, charCount: trimmed.length };
    }
  }

  const chunks = [];
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".md" || ext === ".txt" || ext === ".json" ||
      ext === ".yaml" || ext === ".yml" || ext === ".toml") {
    const blocks = trimmed.split(TEXT_SPLIT_RE).filter(b => b.trim());
    let currentHeading = path.basename(filePath);
    let current = "";

    for (const block of blocks) {
      const headingMatch = block.match(/^#{1,3}\s+(.+)$/m);
      if (headingMatch) {
        currentHeading = headingMatch[1].trim().slice(0, 80);
      }

      const candidate = current ? current + "\n\n" + block : block;
      if (candidate.length > MAX_CHUNK_CHARS && current.trim()) {
        chunks.push({ text: current.trim(), heading: currentHeading, type: "text" });
        current = block;
      } else {
        current = candidate;
      }
    }
    if (current.trim()) {
      chunks.push({ text: current.trim(), heading: currentHeading, type: "text" });
    }
  } else {
    const sentences = trimmed.match(/[^.!?\n]+[.!?]+[\s]*/g) || [trimmed];
    let current = "";
    for (const sentence of sentences) {
      const candidate = current + " " + sentence;
      if (candidate.trim().length > MAX_CHUNK_CHARS && current.trim()) {
        chunks.push({ text: current.trim(), heading: path.basename(filePath), type: "text" });
        current = sentence;
      } else {
        current = candidate;
      }
    }
    if (current.trim()) {
      chunks.push({ text: current.trim(), heading: path.basename(filePath), type: "text" });
    }
  }

  return { filePath, chunks, charCount: trimmed.length };
}

export function* chunkFiles(filesIterable) {
  for (const file of filesIterable) {
    const result = analyzeFile(file);
    for (const chunk of result.chunks) {
      yield { path: result.filePath, text: chunk.text, heading: chunk.heading, type: chunk.type };
    }
  }
}
