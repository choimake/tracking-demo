import type { E2eScenario } from "../scenarios.js";

export type ScenarioOrder = "normal" | "random" | "reverse";

export interface ScenarioSelection {
  order: ScenarioOrder;
  scenarios: E2eScenario[];
  seed?: number;
}

function parseList(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function parseSeed(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error(`E2E_SEED は0以上の整数で指定してください: ${value}`);
  }
  return seed;
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  let state = seed || 0x6d2b_79f5;
  const random = () => {
    state |= 0;
    state = (state + 0x6d2b_79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function selectE2eScenarios(
  allScenarios: readonly E2eScenario[],
  env: NodeJS.ProcessEnv = process.env
): ScenarioSelection {
  const selectors = parseList(env.E2E_SCENARIOS);
  const tags = parseList(env.E2E_TAGS).map((tag) => tag.toLowerCase());
  let scenarios = allScenarios.filter((scenario) => {
    const selectedByScenario =
      selectors.length === 0 ||
      selectors.some(
        (selector) => selector === scenario.id || selector === scenario.name
      );
    const selectedByTag =
      tags.length === 0 || tags.some((tag) => scenario.tags?.includes(tag));
    return selectedByScenario && selectedByTag;
  });
  if (scenarios.length === 0) {
    throw new Error("E2E scenario選択結果が0件です");
  }

  const rawOrder = env.E2E_ORDER?.trim().toLowerCase() || "normal";
  if (
    rawOrder !== "normal" &&
    rawOrder !== "reverse" &&
    rawOrder !== "random"
  ) {
    throw new Error(`未知の E2E_ORDER 値: ${rawOrder} (normal|reverse|random)`);
  }
  const seed = parseSeed(env.E2E_SEED);
  if (rawOrder === "random" && seed === undefined) {
    throw new Error("E2E_ORDER=random では再現用の E2E_SEED が必要です");
  }
  if (rawOrder === "reverse") scenarios = scenarios.toReversed();
  if (rawOrder === "random") scenarios = shuffle(scenarios, seed as number);
  return { order: rawOrder, scenarios, seed };
}
