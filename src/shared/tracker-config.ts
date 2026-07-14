export interface TrackerEventConfig {
  id: string;
  name: string;
  trigger: string;
}

function isEventConfig(value: unknown): value is TrackerEventConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    event.id.length > 0 &&
    typeof event.name === "string" &&
    event.name.length > 0 &&
    typeof event.trigger === "string"
  );
}

export function parseTrackerConfig(
  value: unknown
): TrackerEventConfig[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const events = (value as Record<string, unknown>).events;
  return Array.isArray(events) && events.every(isEventConfig) ? events : null;
}
