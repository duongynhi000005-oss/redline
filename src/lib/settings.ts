import type { StatusCategory } from "./model";

/**
 * Choices that belong to one Redmine server: how its statuses map to Linear's
 * categories and which custom fields show as labels. Kept in the app's own
 * storage, per server and user, so they survive a cache rebuild.
 */
export interface ServerSettings {
  statusCategories: Record<number, StatusCategory>;
  /** Custom field ids shown as labels; null means every multi-value field. */
  labelFields: number[] | null;
}

export const DEFAULT_SETTINGS: ServerSettings = { statusCategories: {}, labelFields: null };

function key(serverUrl: string, userId: number) {
  return `redline.settings:${serverUrl}#${userId}`;
}

export function loadSettings(serverUrl: string, userId: number): ServerSettings {
  try {
    const raw = localStorage.getItem(key(serverUrl, userId));
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ServerSettings>;
    return {
      statusCategories: parsed.statusCategories ?? {},
      labelFields: Array.isArray(parsed.labelFields) ? parsed.labelFields : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(serverUrl: string, userId: number, settings: ServerSettings) {
  try {
    localStorage.setItem(key(serverUrl, userId), JSON.stringify(settings));
  } catch {
    // Storage can be unavailable; the settings still apply until restart.
  }
}
