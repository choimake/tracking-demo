import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

type Owner = { file: string; symbol: string };
type VerificationItem = { id: string; owner: Owner; verification: string[] };
type HttpBinding = { method: string; path: string };
type InputItem = VerificationItem & {
  binding?: HttpBinding | HttpBinding[];
  contracts?: string[];
  consumer?: Owner;
  kind: string;
};
type ErrorItem = VerificationItem & {
  conversion: Owner | Owner[];
  kind: string;
};
type CatchException = {
  file: string;
  reason: string;
  symbol: string;
  verification: string[];
};
interface BoundaryInventory {
  catchExceptions: CatchException[];
  entryPoints: Array<VerificationItem & { kind: string }>;
  errorContracts: ErrorItem[];
  inputs: InputItem[];
  version: number;
}

interface BoundaryCheckResult {
  checkedItemCount: number;
  errors: string[];
}

function normalize(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  });
}

function readInventory(root: string): BoundaryInventory {
  const inventoryPath = path.join(root, "docs/boundary-inventory.json");
  const parsed = JSON.parse(fs.readFileSync(inventoryPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("boundary inventoryのルートはobjectにする");
  }
  return parsed as BoundaryInventory;
}

function declarationNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name
    ) {
      names.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function hasExport(source: ts.SourceFile, symbol: string): boolean {
  return source.statements.some((statement) => {
    if (ts.isExportDeclaration(statement)) {
      if (symbol === "<module>") return true;
      return (
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some(
          (element) => element.name.text === symbol
        )
      );
    }
    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    if (!modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) {
      return false;
    }
    if (symbol === "<module>") return true;
    const declaration = statement as unknown as ts.NamedDeclaration;
    return declaration.name && ts.isIdentifier(declaration.name)
      ? declaration.name.text === symbol
      : false;
  });
}

function ownerError(
  root: string,
  owner: Owner,
  sourceByFile: ReadonlyMap<string, ts.SourceFile>
): string | null {
  const absolute = path.join(root, owner.file);
  if (!fs.existsSync(absolute)) return `owner fileがない: ${owner.file}`;
  if (owner.symbol === "<module>") return null;
  const source = sourceByFile.get(owner.file);
  return source && declarationNames(source).has(owner.symbol)
    ? null
    : `owner symbolがない: ${owner.file}#${owner.symbol}`;
}

function functionName(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) &&
      current.name
    ) {
      return current.name.text;
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return "<module>";
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function accessedPropertyName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
    ? node.argumentExpression.text
    : undefined;
}

function handlesError(node: ts.Node): boolean {
  let handled = false;
  const visit = (current: ts.Node): void => {
    if (ts.isThrowStatement(current)) handled = true;
    if (ts.isReturnStatement(current) && current.expression) handled = true;
    if (ts.isCallExpression(current)) {
      const text = current.expression.getText();
      if (
        text.startsWith("console.") ||
        text === "next" ||
        text === "sendApplicationError" ||
        text === "classifyBoundaryError"
      ) {
        handled = true;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return handled;
}

function checkErrorHandling(
  sources: readonly ts.SourceFile[],
  root: string,
  exceptions: readonly CatchException[]
): string[] {
  const errors: string[] = [];
  const used = new Set<number>();
  const acceptException = (file: string, symbol: string): boolean => {
    const index = exceptions.findIndex(
      (entry, entryIndex) =>
        !used.has(entryIndex) &&
        entry.file === file &&
        entry.symbol === symbol &&
        entry.reason.trim() !== ""
    );
    if (index === -1) return false;
    used.add(index);
    return true;
  };
  for (const source of sources) {
    const file = normalize(path.relative(root, source.fileName));
    const visit = (node: ts.Node): void => {
      if (ts.isCatchClause(node) && !handlesError(node.block)) {
        const symbol = functionName(node);
        if (!acceptException(file, symbol)) {
          const position = source.getLineAndCharacterOfPosition(
            node.getStart()
          );
          errors.push(
            `[src-no-swallowed-error] ${file}:${position.line + 1} catchはthrow、ログ、error変換のいずれかを実行する`
          );
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "catch" &&
        node.arguments[0] &&
        (ts.isArrowFunction(node.arguments[0]) ||
          ts.isFunctionExpression(node.arguments[0])) &&
        !handlesError(node.arguments[0].body)
      ) {
        const symbol = functionName(node);
        if (!acceptException(file, symbol)) {
          const position = source.getLineAndCharacterOfPosition(
            node.getStart()
          );
          errors.push(
            `[src-no-swallowed-error] ${file}:${position.line + 1} Promise.catchはthrow、ログ、error変換のいずれかを実行する`
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  exceptions.forEach((entry, index) => {
    if (!used.has(index)) {
      errors.push(
        `未使用のcatch例外登録: ${entry.file}#${entry.symbol} reason=${entry.reason}`
      );
    }
  });
  return errors;
}

function routeHandlers(source: ts.SourceFile): Map<string, ts.Expression[]> {
  const handlers = new Map<string, ts.Expression[]>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText() === "app" &&
      ["get", "post", "put", "delete", "options"].includes(
        node.expression.name.text
      ) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const key = `${node.expression.name.text.toLowerCase()} ${node.arguments[0].text}`;
      handlers.set(key, node.arguments.slice(1));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return handlers;
}

function rawRequestErrors(
  source: ts.SourceFile,
  route: string,
  handlers: readonly ts.Expression[],
  allowedValidators: ReadonlySet<string>
): string[] {
  const errors: string[] = [];
  for (const handler of handlers) {
    const requestName =
      (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) &&
      handler.parameters[0] &&
      ts.isIdentifier(handler.parameters[0].name)
        ? handler.parameters[0].name.text
        : undefined;
    if (!requestName) continue;
    const isInsideValidator = (node: ts.Node): boolean => {
      let current: ts.Node | undefined = node.parent;
      while (current && current !== handler) {
        if (
          ts.isCallExpression(current) &&
          ts.isIdentifier(current.expression) &&
          allowedValidators.has(current.expression.text)
        ) {
          return true;
        }
        current = current.parent;
      }
      return false;
    };
    const containsUnvalidatedRequest = (node: ts.Node): boolean => {
      let found = false;
      const findRequest = (current: ts.Node): void => {
        if (
          current !== node &&
          ts.isFunctionLike(current) &&
          current.parameters.some(
            (parameter) =>
              ts.isIdentifier(parameter.name) &&
              parameter.name.text === requestName
          )
        ) {
          return;
        }
        if (
          ts.isIdentifier(current) &&
          current.text === requestName &&
          !isInsideValidator(current)
        ) {
          found = true;
          return;
        }
        ts.forEachChild(current, findRequest);
      };
      findRequest(node);
      return found;
    };
    const visit = (node: ts.Node): void => {
      const propertyName = accessedPropertyName(node);
      const receiver =
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)
          ? node.expression
          : undefined;
      const rawReceiver = receiver ? unwrapExpression(receiver) : undefined;
      const isRawAccess =
        propertyName !== undefined &&
        rawReceiver !== undefined &&
        ts.isIdentifier(rawReceiver) &&
        rawReceiver.text === requestName &&
        ["body", "get", "headers", "params", "protocol", "query"].includes(
          propertyName
        );
      const passesRawRequest =
        ts.isIdentifier(node) &&
        node.text === requestName &&
        ts.isCallExpression(node.parent) &&
        node.parent.arguments.includes(node);
      const aliasesRawRequest =
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        containsUnvalidatedRequest(node.initializer);
      if (
        (isRawAccess || passesRawRequest || aliasesRawRequest) &&
        !isInsideValidator(node)
      ) {
        const position = source.getLineAndCharacterOfPosition(node.getStart());
        errors.push(
          `[src-validation-bypass] ${route} ${source.fileName}:${position.line + 1} raw ${requestName}${propertyName ? `.${propertyName}` : ""}はvalidatorへだけ渡す`
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(handler);
  }
  return errors;
}

function readsProcessEnvironment(source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    const propertyName = accessedPropertyName(node);
    const receiver =
      ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
        ? node.expression
        : undefined;
    const environmentReceiver = receiver
      ? unwrapExpression(receiver)
      : undefined;
    if (
      environmentReceiver &&
      ts.isIdentifier(environmentReceiver) &&
      environmentReceiver.text === "process" &&
      propertyName === "env"
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function validatesParsedPersistence(
  source: ts.SourceFile,
  validator: string
): boolean {
  let resultName: string | undefined;
  let bypassCast = false;
  const containsJsonParse = (node: ts.Node): boolean => {
    let found = false;
    const visit = (current: ts.Node): void => {
      if (
        ts.isCallExpression(current) &&
        ts.isPropertyAccessExpression(current.expression) &&
        current.expression.expression.getText() === "JSON" &&
        current.expression.name.text === "parse"
      ) {
        found = true;
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
    return found;
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === validator &&
      node.arguments[0] &&
      containsJsonParse(node.arguments[0]) &&
      ts.isVariableDeclaration(node.parent) &&
      ts.isIdentifier(node.parent.name)
    ) {
      resultName = node.parent.name.text;
    }
    if (ts.isAsExpression(node) && node.type.getText() === "DbShape") {
      bypassCast = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!resultName || bypassCast) return false;
  const text = source.getText();
  return (
    text.includes(`${resultName}.ok`) && text.includes(`${resultName}.value`)
  );
}

export function checkBoundaryArchitecture(root: string): BoundaryCheckResult {
  const errors: string[] = [];
  let inventory: BoundaryInventory;
  try {
    inventory = readInventory(root);
  } catch (error) {
    return { checkedItemCount: 0, errors: [String(error)] };
  }
  const files = sourceFiles(path.join(root, "src"));
  const sources = files.map((file) =>
    ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true
    )
  );
  const sourceByFile = new Map(
    sources.map((source) => [
      normalize(path.relative(root, source.fileName)),
      source,
    ])
  );
  const items = [
    ...inventory.entryPoints,
    ...inventory.inputs,
    ...inventory.errorContracts,
  ];
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    errors.push("inventory IDが重複している");

  const scripts = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  ) as { scripts?: Record<string, string> };
  for (const item of items) {
    const ownerProblem = ownerError(root, item.owner, sourceByFile);
    if (ownerProblem) errors.push(`${item.id}: ${ownerProblem}`);
    if (!Array.isArray(item.verification) || item.verification.length === 0) {
      errors.push(`${item.id}: verificationを1件以上指定する`);
    }
    for (const verification of item.verification ?? []) {
      if (!scripts.scripts?.[verification]) {
        errors.push(`${item.id}: package scriptがない: ${verification}`);
      }
    }
    if ("conversion" in item) {
      const declaredConversions = (item as ErrorItem).conversion;
      const conversions = Array.isArray(declaredConversions)
        ? declaredConversions
        : [declaredConversions];
      for (const conversion of conversions) {
        const conversionProblem = ownerError(root, conversion, sourceByFile);
        if (conversionProblem) errors.push(`${item.id}: ${conversionProblem}`);
        const conversionSource =
          sourceByFile.get(conversion.file)?.getText() ?? "";
        // error変換関数の単語単位の参照にマッチする。例: `sendApplicationError(res, error)`。
        const references = conversionSource.match(
          new RegExp(`\\b${conversion.symbol}\\b`, "g")
        );
        if ((references?.length ?? 0) < 2) {
          errors.push(
            `${item.id}: error変換symbolがHTTP境界から未使用: ${conversion.symbol}`
          );
        }
      }
    }
  }
  const allSourceText = sources.map((source) => source.getText()).join("\n");
  for (const entry of inventory.entryPoints) {
    const source = sourceByFile.get(entry.owner.file);
    if (
      (entry.kind === "module" || entry.kind === "cross-runtime-module") &&
      source &&
      !hasExport(source, entry.owner.symbol)
    ) {
      errors.push(`${entry.id}: 公開symbolをexportしていない`);
    }
    if (
      entry.kind === "execution" &&
      !Object.values(scripts.scripts ?? {}).some((command) =>
        command.includes(entry.owner.file)
      )
    ) {
      errors.push(`${entry.id}: package scriptがentry pointを起動しない`);
    }
    if (entry.kind === "bundle" && !allSourceText.includes(entry.owner.file)) {
      errors.push(`${entry.id}: bundle設定がentry pointを参照しない`);
    }
  }
  for (const exception of inventory.catchExceptions) {
    for (const verification of exception.verification) {
      if (!scripts.scripts?.[verification]) {
        errors.push(`catch例外: package scriptがない: ${verification}`);
      }
    }
  }
  const scenarios = fs.readFileSync(
    path.join(root, "scripts/e2e/scenarios.ts"),
    "utf8"
  );
  const boundaryContracts = fs.readFileSync(
    path.join(root, "scripts/boundary-contract.regression-check.ts"),
    "utf8"
  );
  for (const input of inventory.inputs.filter(
    (item) => item.kind === "browser"
  )) {
    if (!input.contracts || input.contracts.length === 0) {
      errors.push(`${input.id}: browser contractを指定する`);
      continue;
    }
    if (
      input.contracts.some((contract) => contract.startsWith("contract:")) &&
      !input.verification.includes("boundary:contract-check")
    ) {
      errors.push(`${input.id}: boundary contractをverificationへ指定する`);
    }
    if (
      input.contracts.some((contract) => contract.startsWith("scenario:")) &&
      !input.verification.includes("e2e")
    ) {
      errors.push(`${input.id}: E2Eをverificationへ指定する`);
    }
    for (const contract of input.contracts) {
      const [kind, id] = contract.split(":", 2);
      if (kind !== "scenario" && kind !== "contract") {
        errors.push(`${input.id}: contract種別が不正: ${contract}`);
        continue;
      }
      const source = kind === "scenario" ? scenarios : boundaryContracts;
      if (!id || !source.includes(id)) {
        errors.push(`${input.id}: contractが存在しない: ${contract}`);
      }
    }
  }

  const markdown = fs.readFileSync(
    path.join(root, "docs/boundary-inventory.md"),
    "utf8"
  );
  // Markdownのinventory IDコメントにマッチする。例: `inventory-id: HTTP-COLLECT-BODY`。
  const documentedIds = [
    ...markdown.matchAll(/inventory-id:\s*([A-Z0-9-]+)/g),
  ].map((match) => match[1]);
  if (documentedIds.toSorted().join("\n") !== ids.toSorted().join("\n")) {
    errors.push("Markdownのinventory IDがJSONと一致しない");
  }

  const server = sourceByFile.get("src/server.ts");
  if (!server) {
    errors.push("src/server.tsを解析できない");
  } else {
    const routes = routeHandlers(server);
    const validatorsByRoute = new Map<string, Set<string>>();
    for (const input of inventory.inputs.filter(
      (item) => item.kind === "http"
    )) {
      if (!input.binding) continue;
      const bindings = Array.isArray(input.binding)
        ? input.binding
        : [input.binding];
      for (const binding of bindings) {
        const key = `${binding.method.toLowerCase()} ${binding.path}`;
        const validators = validatorsByRoute.get(key) ?? new Set<string>();
        validators.add(input.owner.symbol);
        validatorsByRoute.set(key, validators);
        const handlers = routes.get(key);
        if (!handlers) {
          errors.push(
            `[src-validation-owner] ${input.id}: routeがない: ${key}`
          );
        } else if (
          !handlers.some((handler) =>
            handler.getText(server).includes(input.owner.symbol)
          )
        ) {
          errors.push(
            `[src-validation-owner] ${input.id}: ${key}が${input.owner.symbol}を呼ばない`
          );
        }
      }
    }
    for (const [route, handlers] of routes) {
      errors.push(
        ...rawRequestErrors(
          server,
          route,
          handlers,
          validatorsByRoute.get(route) ?? new Set()
        )
      );
    }
  }

  for (const source of sources) {
    const file = normalize(path.relative(root, source.fileName));
    if (
      file !== "src/boundary/environment.ts" &&
      readsProcessEnvironment(source)
    ) {
      errors.push(`[src-environment-owner] ${file}がprocess.envを直接読む`);
    }
  }
  for (const input of inventory.inputs.filter(
    (item) =>
      item.consumer ||
      item.kind === "persistence" ||
      item.kind === "environment"
  )) {
    if (!input.consumer) {
      errors.push(`[src-validation-owner] ${input.id}: consumerを指定する`);
      continue;
    }
    const consumerProblem = ownerError(root, input.consumer, sourceByFile);
    if (consumerProblem) {
      errors.push(`${input.id}: ${consumerProblem}`);
      continue;
    }
    const consumerSource = sourceByFile.get(input.consumer.file);
    const invokesOwner =
      input.kind === "persistence" && consumerSource
        ? validatesParsedPersistence(consumerSource, input.owner.symbol)
        : consumerSource?.getText().includes(input.owner.symbol);
    if (!invokesOwner) {
      errors.push(
        `[src-validation-owner] ${input.id}: ${input.consumer.file}が${input.owner.symbol}を呼ばない`
      );
    }
  }
  errors.push(...checkErrorHandling(sources, root, inventory.catchExceptions));
  return { checkedItemCount: items.length, errors };
}

function run(args: string[]): number {
  const rootIndex = args.indexOf("--root");
  const requestedRoot = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
  const root = path.resolve(
    requestedRoot
      ? requestedRoot
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
  );
  const result = checkBoundaryArchitecture(root);
  for (const error of result.errors) console.error(error);
  if (result.errors.length > 0) return 1;
  console.log(
    `Boundary architecture check: OK (${result.checkedItemCount} items)`
  );
  return 0;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
