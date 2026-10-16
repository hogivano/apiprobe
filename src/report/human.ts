import { FAILURE_MODE_DESCRIPTION } from '../failure-modes.ts';
import { redactText } from '../util/redact.ts';
import type { ProbeResult, RunReport, Verdict } from '../types.ts';

const MARK: Record<Verdict, string> = { PASS: '✓', FAIL: '✗', INCONCLUSIVE: '?' };

const dim = (text: string) => (process.stdout.isTTY === true ? `\u001b[2m${text}\u001b[0m` : text);

/**
 * Verdict first, then the numbers that produced it, then what it means.
 * Never print a raw dump and leave the reader to interpret it.
 */
export function formatReport(report: RunReport): string {
  const lines: string[] = ['', `apiprobe → ${report.target}`, ''];
  for (const result of report.results) lines.push(formatResult(result), '');
  lines.push(summaryLine(report));
  return redactText(lines.join('\n'));
}

export function formatResult(result: ProbeResult): string {
  const mode = result.failureMode ? `  [${result.failureMode}]` : '';
  const lines = [`${MARK[result.verdict]} ${result.summary}${mode}`];
  const width = Math.max(0, ...result.evidence.map((item) => item.label.length));
  for (const item of result.evidence) {
    const note = item.note ? `  ${dim(`(${item.note})`)}` : '';
    lines.push(`    ${item.label.padEnd(width)}  ${item.value}${note}`);
  }
  if (result.failureMode) {
    lines.push('', `    ${result.failureMode}: ${FAILURE_MODE_DESCRIPTION[result.failureMode]}`);
  }
  if (result.reason) lines.push('', `    Inconclusive: ${result.reason}`);
  if (result.explanation) lines.push('', indent(result.explanation, 4));
  return lines.join('\n');
}

function summaryLine(report: RunReport): string {
  const count = (verdict: Verdict) => report.results.filter((r) => r.verdict === verdict).length;
  return [
    `${count('PASS')} passed, ${count('FAIL')} failed, ${count('INCONCLUSIVE')} inconclusive`,
    `${report.totalRequests} requests in ${Math.round(report.durationMs)}ms`,
  ].join(' · ');
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}
