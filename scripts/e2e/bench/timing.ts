/** performance.now ベースの経過時間計測 */
export function nowMs(): number {
  return performance.now();
}

export function elapsedMs(startedAt: number): number {
  return performance.now() - startedAt;
}
