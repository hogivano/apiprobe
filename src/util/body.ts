/**
 * Body inspection. This module is the whole competitive position: OWASP's
 * checker decides verdicts from status and byte count, so a 200 carrying
 * {"error": "too many results"} scores as a pass. Nothing here may use
 * byte size as a proxy for content.
 */

const ERROR_KEYS = ['error', 'errors', 'message', 'detail', 'details', 'title', 'fault'];
const RECORD_KEYS = ['data', 'items', 'results', 'records', 'rows', 'entries', 'nodes', 'list'];

/** True when the payload is an error envelope regardless of the status code. */
export function isErrorEnvelope(json: unknown): boolean {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return false;
  const obj = json as Record<string, unknown>;
  if (typeof obj['success'] === 'boolean' && obj['success'] === false) return true;
  if (typeof obj['ok'] === 'boolean' && obj['ok'] === false) return true;
  return ERROR_KEYS.some((key) => {
    const value = obj[key];
    return typeof value === 'string' ? value.length > 0 : Array.isArray(value) && value.length > 0;
  });
}

/** HTML where JSON was expected — usually a 500 escaping the error middleware. */
export function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype html|<html\b)/i.test(text);
}

/**
 * Count records in a parsed body. Returns undefined when we cannot find a
 * collection — the caller must then report INCONCLUSIVE rather than assume 0.
 */
export function countRecords(json: unknown): number | undefined {
  if (Array.isArray(json)) return json.length;
  if (json === null || typeof json !== 'object') return undefined;
  const obj = json as Record<string, unknown>;
  for (const key of RECORD_KEYS) {
    const value = obj[key];
    if (Array.isArray(value)) return value.length;
  }
  // One level deeper: { data: { items: [...] } }
  for (const key of RECORD_KEYS) {
    const nested = obj[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const inner = countRecords(nested);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

/** The JSON keys of an error body, sorted — used to compare shapes per status. */
export function shapeOf(json: unknown, prefix = ''): string[] {
  if (json === null || typeof json !== 'object') return [];
  if (Array.isArray(json)) return json.length > 0 ? shapeOf(json[0], `${prefix}[].`) : [];
  return Object.entries(json as Record<string, unknown>)
    .flatMap(([key, value]) => {
      const path = `${prefix}${key}`;
      const nested = value && typeof value === 'object' ? shapeOf(value, `${path}.`) : [];
      return nested.length > 0 ? nested : [path];
    })
    .sort();
}
