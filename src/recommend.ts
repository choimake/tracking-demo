import { parseTrigger } from "./shared/trigger.js";
import type { Hit, TrackEvent } from "./types.js";

/**
 * 無効イベントに対する有効化レコメンド(ルールベース)。
 * 優先度順に最初にマッチしたルールの文言を返す。有効イベントや該当なしは null。
 */
export function recommend(event: TrackEvent, allHits: Hit[]): string | null {
  if (event.enabled) {
    return null;
  }
  const parsed = parseTrigger(event.trigger);
  if (!parsed) {
    return null;
  }

  if (
    parsed.type === "time_on_page" ||
    parsed.type === "scroll" ||
    parsed.type === "exit_intent"
  ) {
    return "高関与ユーザーの特定に有効なイベントです。有効化を推奨します。";
  }

  if (
    parsed.type === "url" &&
    /complete|thanks|done|finish/.test(parsed.value)
  ) {
    return "CV地点の計測イベントです。無効のままではCVがレポートに反映されません。有効化を推奨します。";
  }

  const pastFires = allHits.filter(
    (h) => h.eventId === event.id && !h.test
  ).length;
  if (pastFires > 0) {
    return `過去に${pastFires}件の発火実績があるイベントです。再有効化を推奨します。`;
  }

  return null;
}
