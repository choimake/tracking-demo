/** テストケースを実行して結果を集計し、最終的なサマリー表示と終了コードを提供する */
export class E2eRunner {
  private readonly results: string[] = [];

  /** 成功なら true、失敗なら false を返す */
  async runE2eCase(name: string, fn: () => Promise<void>): Promise<boolean> {
    console.log(`\n[TEST] ${name}`);
    try {
      await fn();
      this.results.push(`PASS ${name}`);
      return true;
    } catch (error) {
      this.results.push(`FAIL ${name} — ${(error as Error).message}`);
      console.error("  ", (error as Error).message);
      return false;
    }
  }

  printSummary(): void {
    console.log("\n===== 結果 =====");
    this.results.forEach((r) => console.log(r));
    const failed = this.results.filter((r) => r.startsWith("FAIL")).length;
    console.log(
      `\n${this.results.length - failed}/${this.results.length} passed`
    );
  }

  get exitCode(): number {
    return this.results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
  }
}
