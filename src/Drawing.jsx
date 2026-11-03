import React, { useRef, useState, useEffect } from 'react';
export default function Drawing({ image, enabled, onLoad, onError, record }) {
  const canvas = useRef(null),
    paths = useRef([]),
    active = useRef(null),
    last = useRef(0);
  const [count, setCount] = useState(0);
  const repaint = () => {
    const ctx = canvas.current.getContext('2d');
    ctx.clearRect(0, 0, 1000, 1000);
    ctx.strokeStyle = '#85bcff';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const path of paths.current) {
      ctx.beginPath();
      path.points.forEach((p, i) =>
        i ? ctx.lineTo(p.x * 1000, p.y * 1000) : ctx.moveTo(p.x * 1000, p.y * 1000),
      );
      ctx.stroke();
    }
  };
  const point = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };
  const end = (e) => {
    if (!active.current || active.current.pointer !== e.pointerId) return;
    const p = point(e);
    active.current.path.points.push(p);
    record('stroke_end', {
      id: active.current.path.id,
      ...p,
      cancelled: e.type === 'pointercancel',
    });
    active.current = null;
    repaint();
  };
  useEffect(() => {
    if (!enabled && active.current) {
      record('stroke_end', { id: active.current.path.id, cancelled: true });
      active.current = null;
    }
  }, [enabled]);
  return (
    <>
      <div className="stimulus-surface">
        <img
          src={image}
          alt="Constellation stimulus"
          draggable="false"
          onLoad={onLoad}
          onError={onError}
        />
        <canvas
          ref={canvas}
          width="1000"
          height="1000"
          aria-label="Optional drawing layer. Drag to draw lines."
          onPointerDown={(e) => {
            if (!enabled || active.current || e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = point(e),
              path = { id: crypto.randomUUID(), points: [p] };
            paths.current.push(path);
            active.current = { pointer: e.pointerId, path };
            last.current = performance.now();
            setCount(paths.current.length);
            record('stroke_start', { id: path.id, ...p });
          }}
          onPointerMove={(e) => {
            if (
              !enabled ||
              !active.current ||
              active.current.pointer !== e.pointerId ||
              performance.now() - last.current < 30
            )
              return;
            last.current = performance.now();
            const p = point(e);
            active.current.path.points.push(p);
            record('stroke_point', { id: active.current.path.id, ...p });
            repaint();
          }}
          onPointerUp={end}
          onPointerCancel={end}
        />
      </div>
      <div className="action-row wrap top16">
        <button
          className="button secondary"
          disabled={!enabled || !count}
          onClick={() => {
            active.current = null;
            const removed = paths.current.pop();
            record('undo', { id: removed.id });
            setCount(paths.current.length);
            repaint();
          }}
        >
          Undo line
        </button>
        <button
          className="button secondary"
          disabled={!enabled || !count}
          onClick={() => {
            active.current = null;
            record('clear', { count: paths.current.length });
            paths.current = [];
            setCount(0);
            repaint();
          }}
        >
          Clear drawing
        </button>
      </div>
    </>
  );
}
