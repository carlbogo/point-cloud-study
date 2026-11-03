export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a JSON object.');
  return value as Record<string, any>;
}
export function text(value: unknown, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length > max || (pattern && !pattern.test(value)))
    throw new Error('Invalid text field.');
  return value;
}
export function finite(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max)
    throw new Error('Invalid numeric field.');
  return value;
}
export function telemetry(value: unknown, duration: number) {
  const data = object(value);
  if (!Array.isArray(data.events) || data.events.length > 12000)
    throw new Error('Invalid event count.');
  const allowed = new Set([
    'stimulus_ready',
    'stroke_start',
    'stroke_point',
    'stroke_end',
    'undo',
    'clear',
    'answer_changed',
    'visibility_changed',
    'answer_submitted',
    'trial_skipped',
  ]);
  let previous = -1;
  for (const raw of data.events) {
    const e = object(raw);
    if (!allowed.has(e.type)) throw new Error('Invalid event type.');
    const t = finite(e.t, duration);
    if (t < previous) throw new Error('Events must be chronological.');
    previous = t;
    if ('x' in e) finite(e.x, 1);
    if ('y' in e) finite(e.y, 1);
    if ('id' in e) text(e.id, 100, /^[a-zA-Z0-9-]+$/);
    if ('hidden' in e && typeof e.hidden !== 'boolean')
      throw new Error('Invalid visibility value.');
  }
  finite(data.viewport_width, 50000);
  finite(data.viewport_height, 50000);
  return data;
}
