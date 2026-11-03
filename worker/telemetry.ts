type Event = { type: string; t: number; id?: string; x?: number; y?: number; hidden?: boolean };
export function summarise(events: Event[], duration: number) {
  let hidden = false,
    hiddenStart = 0,
    hiddenMs = 0,
    drawingStart: number | null = null,
    drawingMs = 0,
    firstAction: number | null = null;
  let lines = 0,
    undos = 0,
    clears = 0,
    changes = 0,
    length = 0,
    previous: Event | null = null;
  for (const e of events) {
    if (firstAction === null && ['stroke_start', 'answer_changed'].includes(e.type))
      firstAction = e.t;
    if (e.type === 'visibility_changed') {
      if (e.hidden && !hidden) {
        hidden = true;
        hiddenStart = e.t;
      } else if (!e.hidden && hidden) {
        hiddenMs += e.t - hiddenStart;
        hidden = false;
      }
    }
    if (e.type === 'stroke_start') {
      lines++;
      if (drawingStart === null) drawingStart = e.t;
      previous = e;
    }
    if (
      ['stroke_point', 'stroke_end'].includes(e.type) &&
      previous !== null &&
      previous.id === e.id &&
      e.x !== undefined &&
      e.y !== undefined &&
      previous.x !== undefined &&
      previous.y !== undefined
    ) {
      length += Math.hypot(e.x - previous.x, e.y - previous.y);
      previous = e;
    }
    if (e.type === 'stroke_end' && drawingStart !== null) {
      drawingMs += e.t - drawingStart;
      drawingStart = null;
      previous = null;
    }
    if (e.type === 'undo') undos++;
    if (e.type === 'clear') clears++;
    if (e.type === 'answer_changed') changes++;
  }
  if (hidden) hiddenMs += duration - hiddenStart;
  if (drawingStart !== null) drawingMs += duration - drawingStart;
  return {
    drawing_used: lines > 0,
    stroke_count: lines,
    drawing_time_ms: Math.round(drawingMs),
    first_action_ms: firstAction === null ? null : Math.round(firstAction),
    hidden_time_ms: Math.round(hiddenMs),
    visible_time_ms: Math.round(Math.max(0, duration - hiddenMs)),
    undo_count: undos,
    clear_count: clears,
    answer_change_count: changes,
    drawing_length_normalised: length,
  };
}
