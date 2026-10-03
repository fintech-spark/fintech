// Merchant Brain: frontend security invariants.
//
// These are not one-off greps. Each assertion below is a rule that has been
// violated by accident in JavaScript projects and would be easy to reintroduce
// by a well-meaning change, so it is enforced by the test suite instead.
//
// The scope is deliberately the frontend only: `app/`, `components/` and
// `lib/`. It must NOT be widened to `modules/` — those are server modules
// owned by other agents.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCOPED_ROOTS = ["app", "components", "lib"] as const;
const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

interface SourceFile {
  readonly path: string;
  readonly contents: string;
  readonly lines: readonly string[];
}

function collectSources(directory: string, into: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      collectSources(full, into);
      continue;
    }
    if (!SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) continue;
    const contents = readFileSync(full, "utf8");
    into.push({
      path: relative(ROOT, full).replace(/\\/g, "/"),
      contents,
      lines: contents.split("\n"),
    });
  }
  return into;
}

const SOURCES: readonly SourceFile[] = SCOPED_ROOTS.flatMap((directory) =>
  collectSources(join(ROOT, directory)),
);

/** Strips `//` and block comments so prose about a pattern is not a match. */
function code(file: SourceFile): string {
  return file.contents
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

function findAll(pattern: RegExp): { readonly file: string; readonly line: number; readonly text: string }[] {
  const hits: { file: string; line: number; text: string }[] = [];
  for (const file of SOURCES) {
    const source = code(file);
    const lines = source.split("\n");
    lines.forEach((text, index) => {
      if (pattern.test(text)) {
        hits.push({ file: file.path, line: index + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

describe("frontend security invariants", () => {
  it("finds the source tree at all", () => {
    expect(SOURCES.length).toBeGreaterThan(20);
  });

  it("never renders untrusted HTML", () => {
    // AI output, document names and transaction notes are DATA. Rendering any
    // of them as markup is how a prompt injection becomes script execution.
    const hits = findAll(/dangerouslySetInnerHTML|\.innerHTML|insertAdjacentHTML/);
    expect(hits).toEqual([]);
  });

  it("never evaluates a string as code", () => {
    const hits = findAll(/\beval\s*\(|new\s+Function\s*\(/);
    expect(hits).toEqual([]);
  });

  it("never reads or writes browser storage", () => {
    // Tenant identity and anything else sensitive belongs in an httpOnly cookie,
    // not in storage readable by any script on the page.
    const hits = findAll(/\blocalStorage\b|\bsessionStorage\b|\bdocument\.cookie\b/);
    expect(hits).toEqual([]);
  });

  it("never exposes an environment variable to the browser", () => {
    // `NEXT_PUBLIC_` is the only prefix Next.js ships to the client. The
    // frontend needs none: every secret stays on the server.
    const hits = findAll(/\bNEXT_PUBLIC_/);
    expect(hits).toEqual([]);
  });

  it("reads no environment variable from a Client Component", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      if (!file.contents.includes('"use client"')) continue;
      if (/process\.env/.test(code(file))) offenders.push(file.path);
    }
    expect(offenders).toEqual([]);
  });

  it("never embeds a foreign frame", () => {
    const hits = findAll(/<iframe|<object\b|<embed\b|srcdoc=/);
    expect(hits).toEqual([]);
  });

  it("opens no new tab without rel=noopener", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      file.lines.forEach((line, index) => {
        if (!line.includes('target="_blank"')) return;
        const context = file.lines.slice(index, index + 4).join(" ");
        if (!/rel="[^"]*noopener/.test(context)) {
          offenders.push(`${file.path}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("imports server-only modules from Client Components as types only", () => {
    // `lib/api/client.ts` reads the session cookie and must never run in a
    // browser. A value import would be caught by `server-only` at build time,
    // but a type-only import is erased and is the intended pattern here — so it
    // is asserted rather than assumed.
    const offenders: string[] = [];
    for (const file of SOURCES) {
      if (!file.contents.includes('"use client"')) continue;
      const source = code(file);
      const pattern = /import\s+(?!type\b)[^;]*from\s+"@\/lib\/api\/(client|endpoints|context)"/g;
      if (pattern.test(source)) offenders.push(file.path);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the server-only guard on the API client", () => {
    const client = SOURCES.find((file) => file.path.endsWith("lib/api/client.ts"));
    expect(client).toBeDefined();
    expect(client?.contents).toContain('import "server-only"');
  });

  it("refuses to forward the session off-origin", () => {
    const client = SOURCES.find((file) => file.path.endsWith("lib/api/client.ts"));
    expect(client?.contents).toContain("assertInternalUrl");
  });

  it("contains no type escapes", () => {
    // `any`, `@ts-ignore` and blanket eslint-disable are how a real type error
    // gets hidden. The repo's own coding-style rule forbids them.
    const hits = findAll(/:\s*any\b|\bas\s+any\b|@ts-ignore|@ts-expect-error/);
    expect(hits).toEqual([]);
  });

  it("contains no blanket eslint-disable", () => {
    const hits = findAll(/eslint-disable\s*$/);
    expect(hits).toEqual([]);
  });

  it("contains no fabricated business figures", () => {
    // Hardcoded rupee amounts in production code are how fake dashboards get
    // shipped. Fixtures live under tests/ and are excluded by SCOPED_ROOTS.
    const hits = findAll(/₹\s?\d/);
    expect(hits).toEqual([]);
  });

  it("does not ship a demo or fixture mode in the app", () => {
    const hits = findAll(/SYNTHETIC|FIXTURE_MODE|DEMO_MODE|USE_MOCK|placeholderData/i);
    expect(hits).toEqual([]);
  });
});