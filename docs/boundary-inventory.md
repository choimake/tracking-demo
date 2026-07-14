# 境界 inventory

`boundary-inventory.json` を機械可読な正本とする。`npm run boundary:architecture-check` は所有者、検証方法、HTTP routeとの対応を検査する。新しいframeworkと外部依存は追加していない。

## 公開 entry point

| ID                | 所有者                                            | 検証方法                               |
| ----------------- | ------------------------------------------------- | -------------------------------------- |
| EP-RUNTIME        | `src/main.ts`                                     | architecture check、E2E                |
| EP-SRC-FACADE     | `src/index.ts`                                    | architecture check、contract test      |
| EP-TRACKER        | `src/tracker/tracker.ts`                          | architecture check、E2E                |
| EP-SHARED-TRIGGER | `src/shared/trigger.ts#parseTrigger`              | architecture check、E2E                |
| EP-TRACKER-CONFIG | `src/shared/tracker-config.ts#parseTrackerConfig` | architecture check、contract test、E2E |

<!-- inventory-id: EP-RUNTIME -->
<!-- inventory-id: EP-SRC-FACADE -->
<!-- inventory-id: EP-TRACKER -->
<!-- inventory-id: EP-SHARED-TRIGGER -->
<!-- inventory-id: EP-TRACKER-CONFIG -->

外部のTypeScript moduleは `src/index.ts` だけをimportできる。ブラウザbundleは `src/shared/trigger.ts` と `src/shared/tracker-config.ts` だけを共有moduleとしてimportできる。実行者は `src/main.ts` を起動する。esbuildは `src/tracker/tracker.ts` をbundleする。

## 外部入力

| 分類     | ID                      | 所有者                          | 検証方法                               |
| -------- | ----------------------- | ------------------------------- | -------------------------------------- |
| HTTP     | HTTP-CONFIG-WORKSPACE   | `validateWorkspaceQuery`        | architecture check、contract test      |
| HTTP     | HTTP-COLLECT-BODY       | `validateCollectInput`          | architecture check、contract test、E2E |
| HTTP     | HTTP-WORKSPACE-BODY     | `validateWorkspaceInput`        | architecture check、contract test      |
| HTTP     | HTTP-REQUEST-ORIGIN     | `validateRequestOrigin`         | architecture check、contract test      |
| HTTP     | HTTP-EVENT-BODY         | `validateEventInput`            | architecture check、contract test      |
| HTTP     | HTTP-EVENT-ID           | `validateResourceId`            | architecture check、contract test      |
| HTTP     | HTTP-TOGGLE-BODY        | `validateToggleInput`           | architecture check、contract test      |
| HTTP     | HTTP-TAG-CHECK-QUERY    | `validateTagCheckQuery`         | architecture check、contract test      |
| HTTP     | HTTP-LABEL-BODY         | `validateLabelInput`            | architecture check、contract test      |
| HTTP     | HTTP-LABEL-ID           | `validateResourceId`            | architecture check、contract test      |
| HTTP     | HTTP-DEMO-PATH          | `resolveHtmlFile`               | architecture check、E2E                |
| 永続化   | PERSISTENCE-DATABASE    | `validatePersistedDatabase`     | architecture check、contract test      |
| 環境変数 | ENV-TRACKING-SERVER     | `loadTrackingServerEnvironment` | architecture check、contract test      |
| 環境変数 | ENV-DEMO-SERVER         | `loadDemoServerEnvironment`     | architecture check、contract test      |
| 環境変数 | ENV-DATABASE            | `loadDatabaseEnvironment`       | architecture check、contract test      |
| ブラウザ | BROWSER-SCRIPT-CONFIG   | tracker module                  | architecture check、E2E                |
| ブラウザ | BROWSER-COOKIE          | `readCookie`                    | architecture check、E2E                |
| ブラウザ | BROWSER-CONFIG-RESPONSE | `parseTrackerConfig`            | architecture check、contract test、E2E |
| ブラウザ | BROWSER-DATA-LAYER      | `processDataLayerItem`          | architecture check、E2E                |
| ブラウザ | BROWSER-CLICK-SELECTOR  | `setupListeners`                | architecture check、E2E                |

<!-- inventory-id: HTTP-CONFIG-WORKSPACE -->
<!-- inventory-id: HTTP-COLLECT-BODY -->
<!-- inventory-id: HTTP-WORKSPACE-BODY -->
<!-- inventory-id: HTTP-REQUEST-ORIGIN -->
<!-- inventory-id: HTTP-EVENT-BODY -->
<!-- inventory-id: HTTP-EVENT-ID -->
<!-- inventory-id: HTTP-TOGGLE-BODY -->
<!-- inventory-id: HTTP-TAG-CHECK-QUERY -->
<!-- inventory-id: HTTP-LABEL-BODY -->
<!-- inventory-id: HTTP-LABEL-ID -->
<!-- inventory-id: HTTP-DEMO-PATH -->
<!-- inventory-id: PERSISTENCE-DATABASE -->
<!-- inventory-id: ENV-TRACKING-SERVER -->
<!-- inventory-id: ENV-DEMO-SERVER -->
<!-- inventory-id: ENV-DATABASE -->
<!-- inventory-id: BROWSER-SCRIPT-CONFIG -->
<!-- inventory-id: BROWSER-COOKIE -->
<!-- inventory-id: BROWSER-CONFIG-RESPONSE -->
<!-- inventory-id: BROWSER-DATA-LAYER -->
<!-- inventory-id: BROWSER-CLICK-SELECTOR -->

## error contract

| ID                | 型                 | HTTP変換                                          | 検証方法                          |
| ----------------- | ------------------ | ------------------------------------------------- | --------------------------------- |
| ERROR-APPLICATION | `ApplicationError` | `sendApplicationError`、`boundaryErrorMiddleware` | architecture check、contract test |
| ERROR-TRANSPORT   | `TransportError`   | `boundaryErrorMiddleware`                         | architecture check、contract test |
| ERROR-UNEXPECTED  | `UnexpectedError`  | `boundaryErrorMiddleware`                         | architecture check、contract test |

<!-- inventory-id: ERROR-APPLICATION -->
<!-- inventory-id: ERROR-TRANSPORT -->
<!-- inventory-id: ERROR-UNEXPECTED -->

`sendApplicationError` はvalidatorが返すapplication errorをHTTP応答へ変換する。`boundaryErrorMiddleware` はExpress body parserの `invalid_json` と `payload_too_large` をapplication errorへ変換する。application errorは400、404、413へ変換する。transport errorは502へ変換する。unexpected errorは原因をログへ記録し、固定した500応答へ変換する。

## 意図した境界挙動の変更

次の変更は外部入力を境界で拒否する。エラー応答は内部情報を公開しない。

| 対象入力・処理                                            | 変更前                          | 変更後                                         |
| --------------------------------------------------------- | ------------------------------- | ---------------------------------------------- |
| `POST /api/collect` へ `{test:"true"}` を送る             | 201を返してHitを記録した        | 400を返してHitを記録しない                     |
| collectへ `{type:"event"}` または `{eventId:null}` を送る | 202を返した                     | 400を返す                                      |
| collectへ `{type:"pageview", eventId:"x"}` を送る         | 201を返した                     | 400を返す                                      |
| `/api/events/:id` 系へ接頭辞が不正なIDを送る              | 404を返した                     | 400を返す                                      |
| toggleへ `{enabled:"true"}` を送る                        | 200を返した                     | 400を返す                                      |
| `/api/tag-check?since=nope` を送る                        | 200と `{count:0}` を返した      | 400を返す                                      |
| `PUT /api/workspace` へ `{name:123}` を送る               | 値を文字列へ変換して200を返した | 400を返す                                      |
| テスト発火が失敗する                                      | 原因文言を含む500を返した       | 固定文言と502を返す                            |
| エラー応答を返す                                          | `code` を含めなかった           | 全エラー応答に `code` を含める                 |
| `PORT` を含む環境変数が不正である                         | 起動後まで不正値を許容した      | 起動時にエラーを送出する                       |
| `db.json` の要素に必須値がない                            | DBを保持して欠損値を補完した    | DB全体を `.bak` へ退避して初期データを作成する |
| snippetへ文字列を埋め込む                                 | 単一引用符で囲んだ              | `JSON.stringify` が生成する二重引用符で囲む    |

## error握り潰しの例外

字句checkは `src` の `catch` とPromiseの `.catch()`を検査する。例外はJSONの `catchExceptions` に理由と検証方法を登録する。登録対象はURI decode fallback、Cookie再発行、不正CSS selector、page unload時のbest-effort送信である。
