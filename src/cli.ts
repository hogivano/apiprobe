#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { DEFAULTS } from './config.ts';
import { exitCodeFor } from './exit-codes.ts';
import { runProbes } from './index.ts';
import { ALL_PROBES } from './probes/index.ts';
import { formatReport } from './report/human.ts';
import { formatJson } from './report/json.ts';
import type { ProbeConfig } from './types.ts';

const tty = process.stdout.isTTY === true;
const bold = (text: string) => (tty ? `[1m${text}[0m` : text);
const dim = (text: string) => (tty ? `[2m${text}[0m` : text);

function version(): string {
  try {
    const path = new URL('../package.json', import.meta.url);
    return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

/** Probe lines are generated from the registry, so help can never drift. */
function probeLines(): string {
  const width = Math.max(...ALL_PROBES.map((probe) => probe.name.length));
  return ALL_PROBES.map((probe) => {
    const tag = probe.writes ? dim('  [needs --allow-writes]') : '';
    return `  ${probe.name.padEnd(width)}  ${probe.description}${tag}`;
  }).join('\n');
}

function help(): string {
  return `${bold('apiprobe')} — reports which scalability and robustness properties an API actually has

${bold('USAGE')}
  apiprobe <url> [options]

  <url> is a list endpoint, e.g. https://api.example.com/items — the one whose
  pagination and limits you want checked.

${bold('PROBES')}
${probeLines()}

  Read-only unless marked. Each reports PASS, FAIL or INCONCLUSIVE; a FAIL may
  also carry a CRASH severity (ABORT, SILENT, HINDERING).

${bold('OPTIONS')}
  --token <token>       Bearer token. Redacted from all output.
  --header <key:value>  Extra request header. Repeatable.
  --only <name,...>     Run only these probes (see PROBES above).
  --max-requests <n>    Hard cap on total requests   ${dim(`(default ${DEFAULTS.maxRequests})`)}
  --timeout <ms>        Per-request timeout in ms    ${dim(`(default ${DEFAULTS.timeoutMs})`)}
  --allow-writes        Enable write probes. They create real data.
  --confirm-production  Also required for write probes when the host does not
                        look like staging.
  --json                Machine-readable output instead of the report.
  --list                List probes, one per line, and exit.
  -h, --help            Show this help.
  -v, --version         Print the version.

${bold('EXIT CODES')}
  0  every probe passed
  1  at least one probe failed
  2  nothing failed, but at least one probe was inconclusive

  Inconclusive is a real result, not an error: it means apiprobe could not
  establish the fact confidently, and it always prints why.

${bold('EXAMPLES')}
  ${dim('# the common case')}
  apiprobe https://api.example.com/items

  ${dim('# authenticated, machine-readable, for CI')}
  apiprobe https://api.example.com/items --token "$API_TOKEN" --json

  ${dim('# just the flagship probe, with a tighter budget')}
  apiprobe https://api.example.com/items --only deep-pagination --max-requests 80

  ${dim('# write probes against a local server')}
  apiprobe http://localhost:3000/items --allow-writes

${bold('SAFETY')}
  apiprobe sends real requests to a real system. It is read-only by default,
  caps a run at ${DEFAULTS.maxRequests} requests so it cannot become a load test, backs off and
  reports inconclusive on a 429 rather than hammering, and never logs your
  token.

${dim('https://github.com/hogivano/apiprobe')}`;
}

const USAGE_HINT = 'usage: apiprobe <url> [options]   (apiprobe --help for details)';

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof UsageError ? error.message : String(error));
    console.error(USAGE_HINT);
    return 1;
  }

  if (parsed.help) {
    console.log(help());
    return 0;
  }
  if (parsed.version) {
    console.log(version());
    return 0;
  }
  if (parsed.list) {
    for (const probe of ALL_PROBES) {
      console.log(`${probe.name}\t${probe.description}${probe.writes ? '\t[write]' : ''}`);
    }
    return 0;
  }
  if (!parsed.config.target) {
    console.error('apiprobe: no target URL given');
    console.error(USAGE_HINT);
    return 1;
  }

  const report = await runProbes(parsed.config as ProbeConfig);
  console.log(parsed.json ? formatJson(report) : formatReport(report));
  return exitCodeFor(report);
}

function parseArgs(argv: string[]) {
  const config: Partial<ProbeConfig> = { headers: {} };
  let json = false;
  let list = false;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined || next.startsWith('-')) {
        throw new UsageError(`apiprobe: ${arg} needs a value`);
      }
      return next;
    };
    const positive = (raw: string): number => {
      const asNumber = Number(raw);
      if (!Number.isFinite(asNumber) || asNumber <= 0) {
        throw new UsageError(`apiprobe: ${arg} needs a positive number, got "${raw}"`);
      }
      return asNumber;
    };

    switch (arg) {
      case '-h': case '--help': help = true; break;
      case '-v': case '--version': version = true; break;
      case '--list': list = true; break;
      case '--json': json = true; break;
      case '--allow-writes': config.allowWrites = true; break;
      case '--confirm-production': config.confirmProduction = true; break;
      case '--token': config.token = value(); break;
      case '--only': config.only = value().split(',').filter(Boolean); break;
      case '--max-requests': config.maxRequests = positive(value()); break;
      case '--timeout': config.timeoutMs = positive(value()); break;
      case '--header': {
        const [key, ...rest] = value().split(':');
        if (!key || rest.length === 0) {
          throw new UsageError('apiprobe: --header expects "Key: value"');
        }
        config.headers![key.trim()] = rest.join(':').trim();
        break;
      }
      default: {
        // An unknown flag is a mistake, not something to ignore silently — the
        // user asked for behaviour they would not otherwise get.
        if (arg.startsWith('-')) throw new UsageError(`apiprobe: unknown option ${arg}`);
        if (config.target) throw new UsageError(`apiprobe: unexpected argument "${arg}"`);
        config.target = arg;
      }
    }
  }

  if (config.only) {
    const known = ALL_PROBES.map((probe) => probe.name);
    const unknown = config.only.filter((name) => !known.includes(name));
    if (unknown.length > 0) {
      throw new UsageError(
        `apiprobe: unknown probe ${unknown.join(', ')}\n  known probes: ${known.join(', ')}`,
      );
    }
  }

  return { config, json, list, help, version };
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
