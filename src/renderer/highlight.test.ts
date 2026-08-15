import { describe, expect, it } from "vitest";
import { tokenizeCode } from "./highlight";

const kinds = (line: { text: string; kind?: string }[]) =>
  line.map((token) => `${token.kind ?? "-"}:${token.text}`);

describe("tokenizeCode", () => {
  it("keeps one entry per source line", () => {
    expect(tokenizeCode("const a = 1\n\nconst b = 2\n").length).toBe(4);
  });

  it("marks keywords, numbers and strings", () => {
    expect(kinds(tokenizeCode(`const port = 8080`)[0]!)).toEqual([
      "kw:const",
      "-: port = ",
      "num:8080",
    ]);
  });

  it("does not treat // inside a string as a comment", () => {
    const [line] = tokenizeCode(`const url = "https://a.dev" // note`);
    expect(kinds(line!)).toEqual([
      "kw:const",
      "-: url = ",
      'str:"https://a.dev"',
      "-: ",
      "com:// note",
    ]);
  });

  it("carries block comments across lines", () => {
    const lines = tokenizeCode("/* one\n  two */\nconst a = 1");
    expect(lines[0]![0]).toEqual({ text: "/* one", kind: "com" });
    expect(lines[1]![0]).toEqual({ text: "  two */", kind: "com" });
    expect(lines[2]![0]).toEqual({ text: "const", kind: "kw" });
  });

  it("uses # comments only for shell-like files", () => {
    expect(tokenizeCode("# hi", "deploy.sh")[0]![0]!.kind).toBe("com");
    expect(tokenizeCode("#main { color: red }", "app.css")[0]![0]!.kind).toBeUndefined();
  });
});
