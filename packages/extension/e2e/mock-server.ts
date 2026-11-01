import { createServer, type Server } from 'node:http';

// Stub for the REST/Scan responses later stories record; serves /health only for now.
export function startMockServer(port = 0): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve({ server, url: `http://127.0.0.1:${String(actual)}` });
    });
  });
}
