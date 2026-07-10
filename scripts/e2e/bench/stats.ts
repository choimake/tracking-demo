export interface NumericStats {
  n: number;
  mean: number;
  median: number;
  p95: number;
  min: number;
  max: number;
  stddev: number;
}

function sorted(values: number[]): number[] {
  const copy = [...values];
  // oxlint-disable-next-line unicorn/no-array-sort -- tsconfig lib は ES2022(toSorted なし)
  copy.sort((a, b) => a - b);
  return copy;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) {
    return Number.NaN;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) {
    return sortedValues[lo];
  }
  const w = idx - lo;
  return sortedValues[lo] * (1 - w) + sortedValues[hi] * w;
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
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return {
    n: values.length,
    mean,
    median: percentile(s, 0.5),
    p95: percentile(s, 0.95),
    min: s[0],
    max: s[s.length - 1],
    stddev: Math.sqrt(variance),
  };
}
