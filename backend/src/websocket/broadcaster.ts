import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { isWorkspaceId } from '../auth/workspace.js';

let wss: WebSocketServer | null = null;
const socketOwner = new WeakMap<WebSocket, string>();

// WebSocket is mounted at /ws. Browsers cannot set headers on a WebSocket, so the
// client identifies its workspace with ?ws=<uuid>. Events for a call are delivered
// only to sockets of that call's owner; ownerless (system) events go to everyone.
export function attachWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false });

  wss.on('connection', (ws, req) => {
    const ws_id = new URL(req.url ?? '', 'http://localhost').searchParams.get('ws');
    if (isWorkspaceId(ws_id)) socketOwner.set(ws, ws_id.toLowerCase());

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

export function broadcast(event: any, ownerId?: string | null) {
  if (!wss) return;
  const payload = JSON.stringify(ownerId ? { ...event, owned: true } : event);
  wss.clients.forEach((c) => {
    if (c.readyState !== WebSocket.OPEN) return;
    if (ownerId && socketOwner.get(c) !== ownerId.toLowerCase()) return;
    try { c.send(payload); } catch {}
  });
}
