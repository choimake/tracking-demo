export interface NumericStats {
  n: number;
  mean: number;
  median: number | undefined;
  p95: number | undefined;
  min: number | undefined;
  max: number | undefined;
  stddev: number;
}

function sorted(values: number[]): number[] {
  const copy = [...values];
  // oxlint-disable-next-line unicorn/no-array-sort -- tsconfig lib は ES2022(toSorted なし)
  copy.sort((a, b) => a - b);
  return copy;
}

function percentile(sortedValues: number[], p: number): number | undefined {
  if (sortedValues.length === 0) {
    return Number.NaN;
  }
  const firstValue = sortedValues[0];
  if (sortedValues.length === 1) {
    return firstValue;
  }
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const lower = sortedValues[lo];
  const upper = sortedValues[hi];
  if (lo === hi) {
    return lower;
  }
  if (lower === undefined || upper === undefined) {
    return Number.NaN;
  }
  const w = idx - lo;
  return lower * (1 - w) + upper * w;
}

/** 数値配列から mean / median / p95 / min / max / stddev を算出する */
export function computeStats(values: number[]): NumericStats {
  if (values.length === 0) {
    return {
      n: 0,
      mean: Number.NaN,
      median: Number.NaN,
      p95: Number.NaN,
      min: Number.NaN,
      max: Number.NaN,
      stddev: Number.NaN,
    };
  }
  const s = sorted(values);
  const min = s[0];
  const max = s.at(-1);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return {
    n: values.length,
    mean,
    median: percentile(s, 0.5),
    p95: percentile(s, 0.95),
    min,
    max,
    stddev: Math.sqrt(variance),
  };
}
