import { useEffect, useRef, useState } from 'react';
import { WS_URL, connectivity } from '../lib/api';

/*
  Subscribes to the backend's /ws WebSocket and exposes:
    - events: rolling buffer of the last 200 events, newest first
    - connected: boolean, whether the socket is currently open
    - lastEvent: most recent event object (also included in events[0])

  Backend broadcasts:
    { type: 'hello',         ts }
    { type: 'call.started',  callId, faultType, inputSource }
    { type: 'call.stage',    callId, stage, status, provider? }
    { type: 'call.completed',callId, status, category, faultType, totalCost, ttsAvailable }
    { type: 'sla.breach',    observed, threshold }

  Auto-reconnects with exponential backoff, capped at 15s.
*/
export function useLiveCallFeed({ max = 200 } = {}) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const open = () => {
      if (cancelled) return;
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          retryRef.current = 0;
          setConnected(true);
        };

        ws.onmessage = (msg) => {
          if (cancelled) return;
          try {
            const ev = JSON.parse(msg.data);
            setLastEvent(ev);
            setEvents((prev) => [ev, ...prev].slice(0, max));
          } catch {}
        };

        ws.onerror = () => {
          // ignore — onclose will handle reconnect
        };

        ws.onclose = () => {
          if (cancelled) return;
          setConnected(false);
          // Exponential backoff, capped
          const delay = Math.min(15_000, 1000 * 2 ** retryRef.current);
          retryRef.current += 1;
          timerRef.current = setTimeout(open, delay);
        };
      } catch (e) {
        connectivity.lastError = `ws ${WS_URL} → ${e?.message || e}`;
      }
    };

    open();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      try { wsRef.current?.close(); } catch {}
    };
  }, [max]);

  return { events, connected, lastEvent };
}
