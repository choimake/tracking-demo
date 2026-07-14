import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface LinkIssue {
  destination: string;
  file: string;
  line: number;
  reason: string;
}

interface MarkdownLink {
  destination: string;
  index: number;
}

const EXTERNAL_DESTINATION = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu;

function repositoryFiles(root: string): Set<string> {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(
      `git ls-filesに失敗しました: ${result.stderr.trim() || "unknown error"}`
    );
  }
  return new Set(
    result.stdout
      .split("\0")
      .filter(Boolean)
      .map((file) => file.split(path.sep).join("/"))
  );
}

function maskFencedCode(markdown: string): string {
  let fence: { character: string; length: number } | undefined;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
      if (marker) {
        if (!fence) {
          fence = { character: marker[0] ?? "", length: marker.length };
        } else if (
          marker[0] === fence.character &&
          marker.length >= fence.length
        ) {
          fence = undefined;
        }
        return " ".repeat(line.length);
      }
      return fence ? " ".repeat(line.length) : line;
    })
    .join("\n");
}

function maskInlineCode(markdown: string): string {
  return markdown.replace(/(`+)([\s\S]*?)\1/gu, (value) =>
    value.replace(/[^\n]/gu, " ")
  );
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/gu, "$1");
}

function isEscaped(markdown: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; markdown[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function hasLinkOpening(markdown: string, closingIndex: number): boolean {
  let nestedBrackets = 0;
  for (let cursor = closingIndex - 1; cursor >= 0; cursor -= 1) {
    if (markdown[cursor] === "\n") return false;
    if (isEscaped(markdown, cursor)) continue;
    if (markdown[cursor] === "]") nestedBrackets += 1;
    if (markdown[cursor] !== "[") continue;
    if (nestedBrackets === 0) return true;
    nestedBrackets -= 1;
  }
  return false;
}

function inlineLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (let index = 0; index < markdown.length - 1; index += 1) {
    if (
      markdown[index] !== "]" ||
      markdown[index + 1] !== "(" ||
      isEscaped(markdown, index) ||
      !hasLinkOpening(markdown, index)
    ) {
      continue;
    }
    let cursor = index + 2;
    while (/\s/u.test(markdown[cursor] ?? "")) cursor += 1;
    const destinationStart = cursor;
    let destination = "";
    if (markdown[cursor] === "<") {
      cursor += 1;
      const start = cursor;
      while (cursor < markdown.length && markdown[cursor] !== ">") {
        cursor += markdown[cursor] === "\\" ? 2 : 1;
      }
      if (markdown[cursor] !== ">") continue;
      destination = markdown.slice(start, cursor);
      cursor += 1;
    } else {
      const start = cursor;
      let nestedParentheses = 0;
      while (cursor < markdown.length) {
        const character = markdown[cursor];
        if (character === "\\") {
          cursor += 2;
          continue;
        }
        if (character === ")" && nestedParentheses === 0) break;
        if (character === "(") {
          nestedParentheses += 1;
        } else if (character === ")") {
          nestedParentheses -= 1;
        }
        if (/\s/u.test(character ?? "") && nestedParentheses === 0) break;
        cursor += 1;
      }
      destination = markdown.slice(start, cursor);
    }
    while (/\s/u.test(markdown[cursor] ?? "")) cursor += 1;
    const titleDelimiter = markdown[cursor];
    if (
      titleDelimiter === '"' ||
      titleDelimiter === "'" ||
      titleDelimiter === "("
    ) {
      const titleEnd = titleDelimiter === "(" ? ")" : titleDelimiter;
      cursor += 1;
      while (cursor < markdown.length && markdown[cursor] !== titleEnd) {
        cursor += markdown[cursor] === "\\" ? 2 : 1;
      }
      if (markdown[cursor] !== titleEnd) continue;
      cursor += 1;
      while (/\s/u.test(markdown[cursor] ?? "")) cursor += 1;
    }
    if (markdown[cursor] !== ")") continue;
    links.push({
      destination: unescapeMarkdown(destination),
      index: destinationStart,
    });
    index = cursor;
  }
  return links;
}

function referenceLinks(markdown: string): MarkdownLink[] {
  const definitions = new Map<string, MarkdownLink>();
  const definitionPattern =
    /^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|([^\s]+))(?:\s+.*)?$/gmu;
  for (const match of markdown.matchAll(definitionPattern)) {
    const label = match[1]?.trim().toLowerCase();
    const destination = match[2] ?? match[3];
    if (label && destination) {
      definitions.set(label, {
        destination: unescapeMarkdown(destination),
        index: match.index,
      });
    }
  }

  const links: MarkdownLink[] = [];
  const usagePattern = /!?\[([^\]]+)\]\[([^\]]*)\]/gu;
  for (const match of markdown.matchAll(usagePattern)) {
    const label = (match[2] || match[1])?.trim().toLowerCase();
    const definition = label ? definitions.get(label) : undefined;
    if (definition) {
      links.push({ destination: definition.destination, index: match.index });
    }
  }
  const shortcutPattern = /!?\[([^\]\n]+)\](?![[(])/gu;
  for (const match of markdown.matchAll(shortcutPattern)) {
    const after = markdown[match.index + match[0].length];
    const before = markdown[match.index - 1];
    const label = match[1]?.trim().toLowerCase();
    const definition = label ? definitions.get(label) : undefined;
    if (after !== ":" && before !== "]" && definition) {
      links.push({ destination: definition.destination, index: match.index });
    }
  }
  return links;
}

function htmlLinks(markdown: string): MarkdownLink[] {
  return [
    ...markdown.matchAll(
      /<[^>]*\b(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/giu
    ),
  ]
    .filter((match) => match[1])
    .map((match) => ({ destination: match[1] ?? "", index: match.index }));
}

function lineNumber(markdown: string, index: number): number {
  return markdown.slice(0, index).split("\n").length;
}

function headingLabel(value: string): string {
  return value
    .replace(/<[^>]*>/gu, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/(^|\s)_+(?=\S)/gu, "$1")
    .replace(/(?<=\S)_+(?=\s|$)/gu, "")
    .replace(/[`*~]/gu, "")
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/giu, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}\s_-]/gu, "")
    .replace(/\s+/gu, "-");
}

function markdownAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const occupied = new Set<string>();
  const headings: string[] = [];
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const atx = line?.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u)?.[1];
    if (atx) {
      headings.push(atx);
      continue;
    }
    const next = lines[index + 1];
    if (line?.trim() && next && /^ {0,3}(?:=+|-+)\s*$/u.test(next)) {
      headings.push(line.trim());
      index += 1;
    }
  }
  for (const heading of headings) {
    const base = headingLabel(heading);
    let anchor = base;
    let suffix = 0;
    while (occupied.has(anchor)) {
      suffix += 1;
      anchor = `${base}-${suffix}`;
    }
    occupied.add(anchor);
    anchors.add(anchor);
  }
  for (const match of markdown.matchAll(
    /<a\s+[^>]*(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>/giu
  )) {
    const anchor = match[1];
    if (anchor) anchors.add(anchor);
  }
  return anchors;
}

function decodeComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function resolveTarget(
  source: string,
  destinationPath: string
): string | undefined {
  if (!destinationPath) return source;
  const target = path.posix
    .normalize(path.posix.join(path.posix.dirname(source), destinationPath))
    .replace(/\/+$/u, "");
  if (
    target === ".." ||
    target.startsWith("../") ||
    path.posix.isAbsolute(target)
  ) {
    return undefined;
  }
  return target === "." ? source : target;
}

function targetExists(target: string, files: ReadonlySet<string>): boolean {
  return (
    files.has(target) ||
    [...files].some((file) => file.startsWith(`${target}/`))
  );
}

function anchorDocument(
  target: string,
  files: ReadonlySet<string>
): string | undefined {
  if (target.toLowerCase().endsWith(".md")) return target;
  const readme = `${target}/README.md`;
  return files.has(readme) ? readme : undefined;
}

function checkMarkdownLinks(root: string): LinkIssue[] {
  const files = repositoryFiles(root);
  const markdownFiles = [...files]
    .filter((file) => file.toLowerCase().endsWith(".md"))
    .toSorted();
  const issues: LinkIssue[] = [];
  const markdownByFile = new Map(
    markdownFiles.map((file) => [
      file,
      maskFencedCode(fs.readFileSync(path.join(root, file), "utf8")),
    ])
  );
  const anchorsByFile = new Map(
    [...markdownByFile].map(([file, markdown]) => [
      file,
      markdownAnchors(markdown),
    ])
  );

  for (const [file, withoutFences] of markdownByFile) {
    const markdown = maskInlineCode(withoutFences);
    const links = [
      ...inlineLinks(markdown),
      ...referenceLinks(markdown),
      ...htmlLinks(markdown),
    ];
    for (const link of links) {
      const destination = link.destination.trim();
      if (
        !destination ||
        EXTERNAL_DESTINATION.test(destination) ||
        destination.startsWith("/")
      ) {
        continue;
      }
      const hashIndex = destination.indexOf("#");
      const queryIndex = destination.indexOf("?");
      const pathEnd = [hashIndex, queryIndex]
        .filter((index) => index >= 0)
        .reduce(
          (minimum, index) => Math.min(minimum, index),
          destination.length
        );
      const encodedPath = destination.slice(0, pathEnd);
      const encodedFragment =
        hashIndex >= 0 ? destination.slice(hashIndex + 1) : undefined;
      const decodedPath = decodeComponent(encodedPath);
      const fragment =
        encodedFragment === undefined
          ? undefined
          : decodeComponent(encodedFragment.split("?", 1)[0] ?? "");
      const line = lineNumber(markdown, link.index);
      if (
        decodedPath === undefined ||
        (encodedFragment !== undefined && fragment === undefined)
      ) {
        issues.push({
          destination,
          file,
          line,
          reason: "percent encodingが不正です",
        });
        continue;
      }
      const target = resolveTarget(file, decodedPath);
      if (!target) {
        issues.push({
          destination,
          file,
          line,
          reason: "リポジトリ外を参照しています",
        });
        continue;
      }
      if (!targetExists(target, files)) {
        issues.push({ destination, file, line, reason: "対象が存在しません" });
        continue;
      }
      if (!fragment) continue;
      const document = anchorDocument(target, files);
      if (document && !anchorsByFile.get(document)?.has(fragment)) {
        issues.push({
          destination,
          file,
          line,
          reason: "Markdownアンカーが存在しません",
        });
      }
    }
  }
  return issues;
}

function runRegressionFixtures(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-links-"));
  try {
    const init = spawnSync("git", ["init", "--quiet"], { cwd: root });
    assert.equal(init.status, 0, "一時Gitリポジトリを初期化できません");
    fs.writeFileSync(
      path.join(root, "target.md"),
      '# 日本語の見出し\n\n## 重複\n\n## 重複\n\n## foo_bar\n\n<a id="explicit"></a>\n'
    );
    fs.writeFileSync(
      path.join(root, "source.md"),
      [
        "# リンク元",
        "",
        "[同じ文書](#リンク元)",
        "[見出し](target.md#日本語の見出し)",
        "[重複](target.md#重複-1)",
        "[underscore](target.md#foo_bar)",
        "[明示](target.md#explicit)",
        "[title](target.md (対象文書))",
        "![画像扱い](target.md)",
        '<a href="target.md?view=1#日本語の見出し">HTMLリンク</a>',
        "[参照][target]",
        "[target]",
        "[target]: target.md",
        "[外部](https://example.com/missing)",
        "\\[エスケープ](missing.md)",
        "`[コード](missing.md)`",
        "```md",
        "[コードブロック](missing.md)",
        "```",
      ].join("\n")
    );
    assert.deepEqual(checkMarkdownLinks(root), []);

    fs.writeFileSync(
      path.join(root, "source.md"),
      "[ファイルなし](missing.md)\n[title形式](missing-title.md (説明))\n[アンカーなし](target.md#missing)\n[外部](../outside.md)\n[不正percent](target%ZZ.md)\n"
    );
    assert.deepEqual(
      checkMarkdownLinks(root)
        .map(({ reason }) => reason)
        .toSorted(),
      [
        "Markdownアンカーが存在しません",
        "percent encodingが不正です",
        "リポジトリ外を参照しています",
        "対象が存在しません",
        "対象が存在しません",
      ].toSorted()
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

function run(root: string): number {
  runRegressionFixtures();
  const issues = checkMarkdownLinks(root);
  for (const issue of issues) {
    console.error(
      `${issue.file}:${issue.line} ${issue.destination}: ${issue.reason}`
    );
  }
  if (issues.length > 0) return 1;
  const markdownFileCount = [...repositoryFiles(root)].filter((file) =>
    file.toLowerCase().endsWith(".md")
  ).length;
  console.log(
    `Markdown link regression check: OK (${markdownFileCount} Markdown files)`
  );
  return 0;
}

const rootArgument = process.argv.indexOf("--root");
const requestedRoot =
  rootArgument >= 0 ? process.argv[rootArgument + 1] : undefined;
const root = path.resolve(
  requestedRoot ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
);
process.exitCode = run(root);
