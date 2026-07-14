# E2E待機戦略

固定時間の経過ではなく、観測可能な状態の成立を待つ。実時間そのものが製品contractの場合だけ固定待機を許可する。

## 登録規則

固定待機の直接利用（`sleep`、`setTimeout`、`AbortSignal.timeout`、`page.waitForTimeout`）は禁止する。許可する固定待機は `registeredWait` または `registeredAbortSignal` を使う。定義は `harness/config.ts` の `REGISTERED_WAIT_DEFINITIONS` に置く。分類、理由、contract ID、基準時間、許容幅を定義に含める。

登録できる分類は次の2種類とする。

- `product-contract-time-boundary`: 製品仕様の時間境界を実時間で検証する。
- `polling`: 状態を再観測する間隔、またはevent待機の上限を設定する。

`state-wait-substitute` と `debug` は登録できない。状態待機へ移行するか削除する。

## 棚卸し結果

| 変更前の待機                             | 分類                           | 移行先または登録理由                                                               |
| ---------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| `tracking/polling.ts` の条件待機         | polling                        | `tracking-condition-poll`。Hit、件数、ログの成立条件を再観測する。                 |
| `tracking/polling.ts` の観測期間         | polling                        | `tracking-observation-poll`。負のcontractと正確件数を期限まで監視する。            |
| `tracking/polling.ts` の静穏待ち         | polling                        | `tracking-quiesce-poll`。Hit ID列の安定を再観測する。                              |
| `tracking/transport.ts` のfetch上限      | polling                        | `tracking-fetch-deadline`。API応答待ちへ期限を設定する。                           |
| `harness/stack.ts` のhealth待機          | polling                        | `stack-health-poll`。HTTP応答が成功すれば直ちに終了する。                          |
| `harness/stack.ts` のhealth応答上限      | polling                        | `stack-health-request-deadline`。停止したHTTP応答を全体期限内に中断する。          |
| `harness/stack.ts` のSIGTERM/SIGKILL上限 | polling                        | `exit` event待機の5000ms上限として2件を登録する。                                  |
| `browser/navigation.ts` のroute到達上限  | polling                        | `tracker-route-interception-deadline`。要求数を最終観測値として報告する。          |
| `browser/navigation.ts` のroute停止      | state-wait-substitute          | routeが要求を停止した状態をPromiseで観測し、明示的に再開する。固定待機を削除した。 |
| `disabled-event.ts` の受信後500ms待機    | state-wait-substitute          | HTTP 202応答後にメモリ上のHitを即時確認する。固定待機を削除した。                  |
| `gtm-dedup.ts` の1200ms待機              | product-contract-time-boundary | 直前の1500ms重複監視で1000ms境界を超えるため、冗長な待機を削除した。               |
| `datalayer-manual.ts` の1100ms待機       | product-contract-time-boundary | `TRACKER-PAGEVIEW-DEDUP-001`。1000ms境界へ100msの後側許容幅を設ける。              |
| `time-on-page-cancel.ts` の400ms反復     | product-contract-time-boundary | Playwright Clockで各区間を400ms進める。実行環境のscheduler遅延を除外する。         |
| `page-leave-timer.ts` の離脱前400ms      | product-contract-time-boundary | Playwright Clockで閾値未満と離脱後の閾値超過を再現する。                           |
| `disabled-event.ts` の3000ms観測         | product-contract-time-boundary | Playwright Clockで2秒閾値を超えた後、Hitとログを確認する。                         |
| デバッグ待機                             | debug                          | 該当なし。                                                                         |
| `page.waitForTimeout`                    | state-wait-substitute          | 該当なし。新規利用は禁止する。                                                     |

`harness/config.ts` の `setTimeout` は登録済み待機の実装である。個別の待機ではないため、登録対象から除外する。

## 時計の適用範囲

Playwright Clockは、time-on-pageの発火時刻を直接検証しないnegativeシナリオへ限定して使う。対象はtimerの取消、timerの再設定、無効イベントの配信除外である。`ManagedSession` は `installClock` と `advanceClockBy` だけを公開する。raw `BrowserContext` は公開しない。

`installClock`は初回遷移前の`about:blank`でClockを導入する。導入時刻は停止時刻よりシナリオtimeout設定以上前に置く。その後、`pauseAt`で停止時刻まで進める。この余白により、導入と停止の間にscheduler遅延が発生しても過去の時刻を指定しない。製品timerは遷移後に登録されるため、導入時の時間進行では発火しない。

`installClock`の完了後は実時間を進めない。ページ内時刻は`advanceClockBy`だけで進める。`runFor`はClockの停止状態を維持する。`gotoDemoPage`が待つtracker初期化はtimerの発火に依存しないため、停止中でも完了する。

`installClock`と`advanceClockBy`の呼び出し順は`session.ts`が保証する。mockではブラウザ内の`Date.now()`が停止することを実証できない。実時間経過中の停止とページ読み込み完了は、Clockを使う3シナリオのWebKit通常順、逆順、固定seed実行で確認する。

`time-on-page.ts` はClockを使わない。2秒の発火をChromium、Firefox、WebKitの実時間で検証する。dedupの1000ms境界もClockを使わない。製品が `Date.now()` の実時間差をcontractとしているためである。

## timeout診断

`waitForCondition` の観測関数は `{ actual, ready }` を返す。timeoutは `condition`、`timeoutMs`、`finalObserved` を出力する。件数待ちとログ待ちは、この診断を原因として保持する。

## 失敗注入

時間境界の検出力は browser E2E の該当シナリオで確認する。dedup境界は `scenario-8` を使う。timer取消は `scenario-14` と `scenario-31` を使う。
