// Anonymous per-browser identity. Every call you analyze is stored under this id and only
// requests carrying it can read them back. It is a bearer secret, not a login: anyone who
// has the key can open your data, and clearing site data loses it unless you saved the key.
const KEY = 'callautopsy.workspace';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cached: string | null = null;

function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function isValidWorkspaceId(v: string): boolean {
  return UUID.test(v.trim());
}

export function getWorkspaceId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && UUID.test(stored)) return (cached = stored.toLowerCase());
  } catch {
    // storage blocked (private mode): fall through to an in-memory id for this tab
  }
  const id = uuidv4();
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // ignore
  }
  return (cached = id);
}

// Switching workspaces reloads the page so every request, socket and cache restarts under the new id.
export function switchWorkspace(id: string | null): boolean {
  const next = id === null ? uuidv4() : id.trim().toLowerCase();
  if (!UUID.test(next)) return false;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    return false;
  }
  cached = next;
  window.location.reload();
  return true;
}
