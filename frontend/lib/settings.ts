// lib/settings.ts — настройките на фирмата (company.settings) се подават от
// API-то като JSON обект, но по стари данни може да са низ. Тримката ги
// нормализира, за да не се изтрият останалите ключове при запис.

export function settingsObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) {
        return o as Record<string, unknown>;
      }
    } catch {
      // невалиден JSON — празни настройки
    }
  }
  return {};
}

export function settingsRaw(raw: unknown): string {
  return JSON.stringify(settingsObject(raw));
}
