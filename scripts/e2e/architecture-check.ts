import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/**
 * E2Eコーディング規則の自動検査における担当の正本。
 * このファイルはページ操作、raw route、匿名ID正規表現、待機定数を検査する。
 * deep importはdependency-cruiserのe2e-tests-*-barrel-import規則が検査する。
 * `npm run e2e:architecture-check`は両方の検査を実行する。
 */
const E2E_DIR = "scripts/e2e";
const CANONICAL_ANON_ID_FILE = `${E2E_DIR}/tracking/assertions.ts`;
export const ARCHITECTURE_RULES = [
  "tests-no-locator",
  "tests-no-get-by-role",
  "tests-no-page-evaluate",
  "tests-no-raw-route",
  "anon-id-regex-single-source",
  "timeout-constant-in-config",
] as const;

export type ArchitectureRule = (typeof ARCHITECTURE_RULES)[number];

export interface ArchitectureAllowlistEntry {
  file: string;
  reason: string;
  rule: ArchitectureRule;
}

interface ArchitectureViolation {
  column: number;
  file: string;
  line: number;
  message: string;
  rule: ArchitectureRule;
}

interface ArchitectureResult {
  allowlistCount: number;
  checkedFileCount: number;
  errors: string[];
  violations: ArchitectureViolation[];
}

interface CheckArchitectureOptions {
  allowlistPath?: string;
  rootDir: string;
}

const RULE_SET = new Set<string>(ARCHITECTURE_RULES);
const TIME_CONSTANT_NAME_RE =
  /(?:TIMEOUT|DELAY|INTERVAL|WAIT|DURATION|SETTLE|GAP)(?:_[A-Z0-9]+)*_MS$/;
const TIME_VALUE_NAME_RE =
  /(?:timeout|delay|interval|wait|duration|settle|gap)[A-Za-z0-9_$]*$/i;

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function collectTypeScriptFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    })
    .toSorted();
}

function parseAllowlist(value: unknown): ArchitectureAllowlistEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("allowlistのルートは配列にする");
  }

  const entries = value.map((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new Error(`allowlist[${index}]はオブジェクトにする`);
    }
    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record).toSorted();
    if (keys.join(",") !== "file,reason,rule") {
      throw new Error(
        `allowlist[${index}]はfile、rule、reasonだけを持つ必要がある`
      );
    }
    if (typeof record.file !== "string" || record.file.trim() === "") {
      throw new Error(`allowlist[${index}].fileは空でない文字列にする`);
    }
    if (
      path.isAbsolute(record.file) ||
      normalizePath(record.file).split("/").includes("..")
    ) {
      throw new Error(`allowlist[${index}].fileはリポジトリ相対パスにする`);
    }
    if (typeof record.rule !== "string" || !RULE_SET.has(record.rule)) {
      throw new Error(`allowlist[${index}].ruleは既知の規則にする`);
    }
    if (typeof record.reason !== "string" || record.reason.trim() === "") {
      throw new Error(`allowlist[${index}].reasonは空でない文字列にする`);
    }
    return {
      file: normalizePath(record.file),
      reason: record.reason.trim(),
      rule: record.rule as ArchitectureRule,
    };
  });

  const keys = entries.map((entry) => `${entry.file}\0${entry.rule}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error("allowlistに同じfileとruleの組み合わせを重複登録できない");
  }
  return entries;
}

function loadAllowlist(allowlistPath: string): ArchitectureAllowlistEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
  } catch (error) {
    throw new Error(`allowlistを読み込めない: ${allowlistPath}`, {
      cause: error,
    });
  }
  return parseAllowlist(parsed);
}

function regexPattern(node: ts.RegularExpressionLiteral): string {
  const literal = node.getText();
  const closingSlash = literal.lastIndexOf("/");
  return closingSlash > 0 ? literal.slice(1, closingSlash) : literal;
}

function isAnonymousIdPattern(pattern: string): boolean {
  const hasPrefix = ["^v_", "^s_", "v_", "s_"].some((prefix) =>
    pattern.startsWith(prefix)
  );
  return hasPrefix && pattern.includes("{36}");
}

function staticString(expression: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticString(expression.left);
    const right = staticString(expression.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isParenthesizedExpression(expression)) {
    return staticString(expression.expression);
  }
  return undefined;
}

function isNumericConstantExpression(expression: ts.Expression): boolean {
  if (ts.isNumericLiteral(expression)) return true;
  if (ts.isParenthesizedExpression(expression)) {
    return isNumericConstantExpression(expression.expression);
  }
  if (
    ts.isPrefixUnaryExpression(expression) &&
    (expression.operator === ts.SyntaxKind.PlusToken ||
      expression.operator === ts.SyntaxKind.MinusToken)
  ) {
    return isNumericConstantExpression(expression.operand);
  }
  if (ts.isBinaryExpression(expression)) {
    return (
      isNumericConstantExpression(expression.left) &&
      isNumericConstantExpression(expression.right)
    );
  }
  return false;
}

function isConstDeclaration(node: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(node.parent) &&
    (node.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

function accessedMember(expression: ts.Expression):
  | {
      name: string;
      nameNode: ts.Node;
      receiver: ts.Expression;
    }
  | undefined {
  if (ts.isPropertyAccessExpression(expression)) {
    return {
      name: expression.name.text,
      nameNode: expression.name,
      receiver: expression.expression,
    };
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return {
      name: expression.argumentExpression.text,
      nameNode: expression.argumentExpression,
      receiver: expression.expression,
    };
  }
  return undefined;
}

function hasIdentifierSymbol(
  identifier: ts.Identifier,
  symbols: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  return symbol !== undefined && symbols.has(symbol);
}

function addIdentifierSymbol(
  identifier: ts.Identifier,
  symbols: Set<ts.Symbol>,
  checker: ts.TypeChecker
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (!symbol || symbols.has(symbol)) return false;
  symbols.add(symbol);
  return true;
}

function isPageReference(
  expression: ts.Expression,
  aliases: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker
): boolean {
  if (ts.isIdentifier(expression)) {
    return (
      expression.text === "page" ||
      hasIdentifierSymbol(expression, aliases, checker)
    );
  }
  return accessedMember(expression)?.name === "page";
}

function collectPageAliases(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): ReadonlySet<ts.Symbol> {
  const aliases = new Set<ts.Symbol>();
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        isPageReference(node.initializer, aliases, checker)
      ) {
        changed = addIdentifierSymbol(node.name, aliases, checker) || changed;
      }
      if (
        ts.isBindingElement(node) &&
        ts.isIdentifier(node.name) &&
        ((node.propertyName &&
          (ts.isIdentifier(node.propertyName) ||
            ts.isStringLiteralLike(node.propertyName)) &&
          node.propertyName.text === "page") ||
          (!node.propertyName && node.name.text === "page"))
      ) {
        changed = addIdentifierSymbol(node.name, aliases, checker) || changed;
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        isPageReference(node.right, aliases, checker)
      ) {
        changed = addIdentifierSymbol(node.left, aliases, checker) || changed;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return aliases;
}

function isPageEvaluateReference(
  expression: ts.Expression,
  pageAliases: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker
): boolean {
  const member = accessedMember(expression);
  return (
    member?.name === "evaluate" &&
    isPageReference(member.receiver, pageAliases, checker)
  );
}

function isRawRouteReceiver(
  expression: ts.Expression,
  pageAliases: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker
): boolean {
  if (isPageReference(expression, pageAliases, checker)) return true;
  const receiverType = checker.getTypeAtLocation(expression);
  const hasMember = (name: string): boolean =>
    receiverType.getProperty(name) !== undefined;
  if (
    hasMember("route") &&
    ((hasMember("context") && hasMember("mainFrame")) ||
      (hasMember("browser") && hasMember("newPage") && hasMember("cookies")))
  ) {
    return true;
  }
  if (ts.isIdentifier(expression)) {
    return (
      expression.text === "context" || expression.text === "browserContext"
    );
  }
  if (ts.isCallExpression(expression)) {
    const member = accessedMember(expression.expression);
    if (member?.name === "page") return true;
    return (
      (member?.name === "context" || member?.name === "mainFrame") &&
      isPageReference(member.receiver, pageAliases, checker)
    );
  }
  return false;
}

function collectRawRouteAliases(
  sourceFile: ts.SourceFile,
  pageAliases: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker
): ReadonlySet<ts.Symbol> {
  const aliases = new Set<ts.Symbol>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const member = accessedMember(node.initializer);
      if (
        member?.name === "route" &&
        isRawRouteReceiver(member.receiver, pageAliases, checker)
      ) {
        addIdentifierSymbol(node.name, aliases, checker);
      }
    }
    if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      ts.isObjectBindingPattern(node.parent) &&
      ts.isVariableDeclaration(node.parent.parent) &&
      node.parent.parent.initializer &&
      isRawRouteReceiver(node.parent.parent.initializer, pageAliases, checker)
    ) {
      const propertyName = node.propertyName;
      const extractedName =
        propertyName &&
        (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName))
          ? propertyName.text
          : node.name.text;
      if (extractedName === "route") {
        addIdentifierSymbol(node.name, aliases, checker);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

function collectPageEvaluateAliases(
  sourceFile: ts.SourceFile,
  pageAliases: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker
): ReadonlySet<ts.Symbol> {
  const aliases = new Set<ts.Symbol>();
  let changed = true;
  while (changed) {
    changed = false;
    const isEvaluateAlias = (expression: ts.Expression): boolean =>
      isPageEvaluateReference(expression, pageAliases, checker) ||
      (ts.isIdentifier(expression) &&
        hasIdentifierSymbol(expression, aliases, checker));
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name) && isEvaluateAlias(node.initializer)) {
          changed = addIdentifierSymbol(node.name, aliases, checker) || changed;
        }
        if (
          ts.isObjectBindingPattern(node.name) &&
          isPageReference(node.initializer, pageAliases, checker)
        ) {
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            const propertyName = element.propertyName;
            const extractedName =
              propertyName &&
              (ts.isIdentifier(propertyName) ||
                ts.isStringLiteralLike(propertyName))
                ? propertyName.text
                : element.name.text;
            if (extractedName === "evaluate") {
              changed =
                addIdentifierSymbol(element.name, aliases, checker) || changed;
            }
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        isEvaluateAlias(node.right)
      ) {
        changed = addIdentifierSymbol(node.left, aliases, checker) || changed;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return aliases;
}

function visitSourceFile(
  sourceFile: ts.SourceFile,
  file: string,
  checker: ts.TypeChecker
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const pageAliases = collectPageAliases(sourceFile, checker);
  const rawRouteAliases = collectRawRouteAliases(
    sourceFile,
    pageAliases,
    checker
  );
  const pageEvaluateAliases = collectPageEvaluateAliases(
    sourceFile,
    pageAliases,
    checker
  );
  const isTestSource = file.startsWith(`${E2E_DIR}/tests/`);
  // regression-checkは検査インフラであり、E2Eの検証意図を置く層ではない。
  const isTimeoutForbiddenLayer =
    !file.endsWith(".regression-check.ts") &&
    ["tests", "browser", "tracking"].some((layer) =>
      file.startsWith(`${E2E_DIR}/${layer}/`)
    );

  const addViolation = (
    node: ts.Node,
    rule: ArchitectureRule,
    message: string
  ): void => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    );
    violations.push({
      column: position.character + 1,
      file,
      line: position.line + 1,
      message,
      rule,
    });
  };

  const visit = (node: ts.Node): void => {
    if (isTestSource && ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        hasIdentifierSymbol(node.expression, rawRouteAliases, checker)
      ) {
        addViolation(
          node.expression,
          "tests-no-raw-route",
          "testsではraw page.routeまたはcontext.routeから抽出したメソッドを呼び出せない"
        );
      }
      if (
        ts.isIdentifier(node.expression) &&
        hasIdentifierSymbol(node.expression, pageEvaluateAliases, checker)
      ) {
        addViolation(
          node.expression,
          "tests-no-page-evaluate",
          "testsではpage.evaluateから抽出したメソッドを呼び出せない"
        );
      }
      const member = accessedMember(node.expression);
      if (member) {
        if (member.name === "locator") {
          addViolation(
            member.nameNode,
            "tests-no-locator",
            "testsではraw locatorを呼び出せない"
          );
        }
        if (member.name === "getByRole") {
          addViolation(
            member.nameNode,
            "tests-no-get-by-role",
            "testsではraw getByRoleを呼び出せない"
          );
        }
        if (
          member.name === "evaluate" &&
          isPageReference(member.receiver, pageAliases, checker)
        ) {
          addViolation(
            member.nameNode,
            "tests-no-page-evaluate",
            "testsではpage.evaluateを呼び出せない"
          );
        }
        if (
          member.name === "route" &&
          isRawRouteReceiver(member.receiver, pageAliases, checker)
        ) {
          addViolation(
            member.nameNode,
            "tests-no-raw-route",
            "testsではraw page.routeまたはcontext.routeを呼び出せない"
          );
        }
      }
    }

    if (file !== CANONICAL_ANON_ID_FILE) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        (node.name.text === "ANON_VID_RE" || node.name.text === "ANON_SID_RE")
      ) {
        addViolation(
          node.name,
          "anon-id-regex-single-source",
          "匿名ID正規表現はtracking/assertions.tsだけで定義する"
        );
      } else if (
        ts.isRegularExpressionLiteral(node) &&
        isAnonymousIdPattern(regexPattern(node))
      ) {
        addViolation(
          node,
          "anon-id-regex-single-source",
          "匿名ID相当の正規表現はtracking/assertions.tsだけで定義する"
        );
      } else if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "RegExp" &&
        node.arguments &&
        node.arguments.length >= 1 &&
        isAnonymousIdPattern(staticString(node.arguments[0]) ?? "")
      ) {
        addViolation(
          node,
          "anon-id-regex-single-source",
          "匿名ID相当の正規表現はtracking/assertions.tsだけで定義する"
        );
      }
    }

    if (
      isTimeoutForbiddenLayer &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isConstDeclaration(node) &&
      (TIME_CONSTANT_NAME_RE.test(node.name.text) ||
        (TIME_VALUE_NAME_RE.test(node.name.text) &&
          node.initializer !== undefined &&
          isNumericConstantExpression(node.initializer)))
    ) {
      addViolation(
        node.name,
        "timeout-constant-in-config",
        "待機・タイムアウト定数はharness/config.tsに置く"
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

export function checkArchitecture({
  allowlistPath,
  rootDir,
}: CheckArchitectureOptions): ArchitectureResult {
  const absoluteRoot = path.resolve(rootDir);
  const resolvedAllowlistPath =
    allowlistPath ??
    path.join(absoluteRoot, E2E_DIR, "architecture-allowlist.json");
  let allowlist: ArchitectureAllowlistEntry[];
  try {
    allowlist = loadAllowlist(resolvedAllowlistPath);
  } catch (error) {
    return {
      allowlistCount: 0,
      checkedFileCount: 0,
      errors: [String(error)],
      violations: [],
    };
  }

  const files = collectTypeScriptFiles(path.join(absoluteRoot, E2E_DIR));
  const program = ts.createProgram(files, {
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
  });
  const checker = program.getTypeChecker();
  const violations = files.flatMap((absoluteFile) => {
    const file = normalizePath(path.relative(absoluteRoot, absoluteFile));
    const sourceFile = program.getSourceFile(absoluteFile);
    if (!sourceFile) {
      throw new Error(`TypeScriptファイルを解析できない: ${file}`);
    }
    return visitSourceFile(sourceFile, file, checker);
  });

  const usedAllowlistEntries = new Set<number>();
  const activeViolations = violations.filter((violation) => {
    const index = allowlist.findIndex(
      (entry, entryIndex) =>
        !usedAllowlistEntries.has(entryIndex) &&
        entry.file === violation.file &&
        entry.rule === violation.rule
    );
    if (index === -1) return true;
    usedAllowlistEntries.add(index);
    return false;
  });
  const staleEntries = allowlist.filter(
    (_entry, index) => !usedAllowlistEntries.has(index)
  );
  const errors = staleEntries.map(
    (entry) =>
      `未使用のallowlist登録: file=${entry.file} rule=${entry.rule} reason=${entry.reason}`
  );

  return {
    allowlistCount: allowlist.length,
    checkedFileCount: files.length,
    errors,
    violations: activeViolations,
  };
}

function parseArguments(args: string[]): CheckArchitectureOptions {
  let rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  );
  let allowlistPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--root" && args[index + 1]) {
      rootDir = path.resolve(args[index + 1]);
      index += 1;
    } else if (argument === "--allowlist" && args[index + 1]) {
      allowlistPath = path.resolve(args[index + 1]);
      index += 1;
    } else {
      throw new Error(`未対応の引数: ${argument}`);
    }
  }
  return { allowlistPath, rootDir };
}

export function runArchitectureCheck(args: string[]): number {
  let options: CheckArchitectureOptions;
  try {
    options = parseArguments(args);
  } catch (error) {
    console.error(String(error));
    return 1;
  }
  const result = checkArchitecture(options);
  for (const violation of result.violations) {
    console.error(
      `[${violation.rule}] ${violation.file}:${violation.line}:${violation.column} ${violation.message}`
    );
  }
  for (const error of result.errors) console.error(error);
  if (result.violations.length > 0 || result.errors.length > 0) return 1;
  console.log(
    `E2E architecture check: OK (${result.checkedFileCount} files, ${result.allowlistCount} allowlist entries)`
  );
  return 0;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = runArchitectureCheck(process.argv.slice(2));
}
