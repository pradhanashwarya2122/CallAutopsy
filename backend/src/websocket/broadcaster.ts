import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

let wss: WebSocketServer | null = null;

// WebSocket is mounted at /ws. Cross-origin is accepted implicitly (the `ws`
// library does not enforce Origin checks by default), which matches our
// permissive CORS policy for the REST API. If you tighten this later, add an
// Origin allow-list in verifyClient.
export function attachWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', ts: Date.now() }));

    // Keep intermediaries from killing idle connections (Cloudflare / Railway
    // both drop WebSockets after ~100s of silence otherwise).
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch {}
      }
    }, 25_000);

    ws.on('close', () => clearInterval(ping));
    ws.on('error', () => {}); // swallow — client will reconnect
  });
}

export function broadcast(event: any) {
  if (!wss) return;
  const payload = JSON.stringify(event);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      try { c.send(payload); } catch {}
    }
  });
}
