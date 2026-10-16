const SENSITIVE = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;

/** Never log auth tokens. Applied to every header map before it reaches output. */
export function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  return Object.fromEntries(
    entries.map(([key, value]) => [key, SENSITIVE.test(key) ? '<redacted>' : value]),
  );
}

/** Strip anything token-shaped out of free text before printing it. */
export function redactText(text: string): string {
  return text
    .replace(/\b(bearer\s+)[\w.\-~+/]+=*/gi, '$1<redacted>')
    .replace(/\b(api[_-]?key\W{1,3})[\w.\-]{8,}/gi, '$1<redacted>');
}
