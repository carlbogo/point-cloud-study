export const digest = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
export const newToken = () => crypto.randomUUID() + crypto.randomUUID();
export async function isTeam(db: D1Database, key: unknown) {
  if (typeof key !== 'string' || key.length < 32 || key.length > 100) return false;
  return Boolean(
    await db
      .prepare('SELECT id FROM team_links WHERE token_hash=? AND active=1')
      .bind(await digest(key))
      .first(),
  );
}
export async function settings(db: D1Database) {
  return (await db
    .prepare('SELECT answer_mode,updated_at FROM study_settings WHERE id=1')
    .first<{ answer_mode: 'hybrid' | 'choices'; updated_at: string }>())!;
}
