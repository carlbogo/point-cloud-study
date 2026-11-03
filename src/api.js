export const SESSION_KEY = 'cq_server_session_v1';
export async function api(path, { token, body, method } = {}) {
  const response = await fetch(path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
export function loadSession(key = SESSION_KEY) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
export function storeSession(value, key = SESSION_KEY) {
  localStorage.setItem(key, JSON.stringify(value));
}
export function exportFile(name, content, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function csv(rows) {
  const cols = Object.keys(rows[0] || {});
  const esc = (value) => {
    const s = String(value ?? '');
    return '"' + (/^[=+@\-\t\r\n]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
  };
  return [
    cols.map(esc).join(','),
    ...rows.map((row) => cols.map((c) => esc(row[c])).join(',')),
  ].join('\r\n');
}
