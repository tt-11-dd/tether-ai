export type CodeToken = { text: string; kind?: "com" | "str" | "kw" | "num" };

const KEYWORDS = new Set([
  "abstract", "and", "as", "async", "await", "break", "case", "catch", "class", "const",
  "continue", "def", "default", "delete", "do", "elif", "else", "enum", "export", "extends",
  "false", "finally", "for", "from", "function", "if", "implements", "import", "in",
  "instanceof", "interface", "lambda", "let", "new", "not", "null", "of", "or", "pass",
  "private", "protected", "public", "raise", "readonly", "return", "static", "super",
  "switch", "this", "throw", "true", "try", "type", "typeof", "undefined", "var", "void",
  "while", "with", "yield",
]);

const HASH_COMMENT = /\.(py|rb|sh|bash|zsh|ya?ml|toml|ini|conf|env|gitignore)$/i;
const NUMBER = /\d[\w.]*/y;
const WORD = /[A-Za-z_$][\w$]*/y;

/**
 * ponytail: regex scanner, not a real parser — good enough for strings, comments,
 * keywords and numbers in C-family / CSS / JSON. Swap in highlight.js if per-language
 * accuracy (JSX attributes, embedded templates) ever matters.
 */
export function tokenizeCode(source: string, path = ""): CodeToken[][] {
  const hashComments = HASH_COMMENT.test(path);
  const tokens: CodeToken[] = [];
  let plain = "";
  let index = 0;

  const flush = () => {
    if (!plain) return;
    tokens.push({ text: plain });
    plain = "";
  };
  const push = (text: string, kind: CodeToken["kind"]) => {
    flush();
    tokens.push({ text, kind });
  };

  while (index < source.length) {
    const char = source[index]!;

    if ((char === "/" && source[index + 1] === "/") || (hashComments && char === "#")) {
      const end = source.indexOf("\n", index);
      const stop = end < 0 ? source.length : end;
      push(source.slice(index, stop), "com");
      index = stop;
      continue;
    }

    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end < 0 ? source.length : end + 2;
      push(source.slice(index, stop), "com");
      index = stop;
      continue;
    }

    if (char === "<" && source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      const stop = end < 0 ? source.length : end + 3;
      push(source.slice(index, stop), "com");
      index = stop;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      let cursor = index + 1;
      while (cursor < source.length) {
        const inner = source[cursor]!;
        if (inner === "\\") {
          cursor += 2;
          continue;
        }
        // Only template literals may span lines; an unterminated quote stops at EOL.
        if (inner === "\n" && char !== "`") break;
        cursor += 1;
        if (inner === char) break;
      }
      push(source.slice(index, cursor), "str");
      index = cursor;
      continue;
    }

    if (char >= "0" && char <= "9" && !/[\w$.]/.test(source[index - 1] ?? "")) {
      NUMBER.lastIndex = index;
      const match = NUMBER.exec(source);
      if (match) {
        push(match[0], "num");
        index += match[0].length;
        continue;
      }
    }

    WORD.lastIndex = index;
    const word = WORD.exec(source);
    if (word) {
      if (KEYWORDS.has(word[0])) push(word[0], "kw");
      else plain += word[0];
      index += word[0].length;
      continue;
    }

    plain += char;
    index += 1;
  }
  flush();

  return splitLines(tokens);
}

function splitLines(tokens: CodeToken[]): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split("\n");
    for (const [offset, part] of parts.entries()) {
      if (offset > 0) lines.push([]);
      if (!part) continue;
      lines.at(-1)!.push(token.kind ? { text: part, kind: token.kind } : { text: part });
    }
  }
  return lines;
}
