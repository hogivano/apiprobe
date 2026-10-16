import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * Tiny node:http helper shared by the fixtures. Not Express: node's
 * built-in server does the same job here and keeps `npm install` dependency
 * free, which matters for a tool whose pitch is that it is easy to trust.
 */
export type Handler = (req: IncomingMessage, url: URL, res: Reply) => void;

export interface Reply {
  json(status: number, body: unknown, headers?: Record<string, string>): void;
  html(status: number, body: string): void;
}

export function startFixture(handler: Handler, port = 0) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const reply: Reply = {
      json(status, body, headers = {}) {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
      },
      html(status, body) {
        res.writeHead(status, { 'content-type': 'text/html' });
        res.end(body);
      },
    };
    handler(req, url, reply);
  });

  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${boundPort}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** Seeded rows shared by both fixtures. */
export function seedRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `row-${i + 1}` }));
}

/**
 * Simulates .skip() cost: work proportional to offset depth. Tuned so that a
 * depth which still holds data crosses the probe's 500ms absolute threshold —
 * a real offset scan over a large table behaves this way, and a fixture that
 * degrades too gently would let a broken probe pass.
 */
export function simulateOffsetScan(offset: number): void {
  const until = performance.now() + Math.min(offset / 40, 1200);
  while (performance.now() < until) { /* busy-wait, as a real .skip() would */ }
}
