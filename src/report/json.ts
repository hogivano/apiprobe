import { redactText } from '../util/redact.ts';
import type { RunReport } from '../types.ts';

/** Machine output for --json. Same data the human report is rendered from. */
export function formatJson(report: RunReport): string {
  return redactText(JSON.stringify(report, null, 2));
}
