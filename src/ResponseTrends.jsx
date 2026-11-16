import React, { useEffect, useState } from 'react';
import { api } from './api';

const patterns = {
  ai: 'Only AI mostly correct',
  human: 'Only humans mostly correct',
  both: 'Both mostly correct',
  neither: 'Both half correct or less',
};

function pattern(row) {
  const ai = row.ai_correct * 2 > row.ai_total;
  const human = row.human_correct * 2 > row.human_total;
  if (ai && human) return 'both';
  if (ai) return 'ai';
  if (human) return 'human';
  return 'neither';
}

function Rate({ correct, total }) {
  return (
    <>
      <span>
        {correct} / {total} ({Math.round((100 * correct) / total)}%)
      </span>
      <progress
        className="progress trend-rate"
        aria-label="Correct answer share"
        value={correct}
        max={total}
      />
    </>
  );
}

export default function ResponseTrends({ token }) {
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    api('/api/team/response-trends', { token })
      .then((result) => {
        if (current) setRows(result.rows);
      })
      .catch((err) => {
        if (current) setError(err.message);
      });
    return () => {
      current = false;
    };
  }, [token]);

  const matched = rows?.filter((row) => row.ai_total && row.human_total) ?? [];
  const visible = selected ? matched.filter((row) => pattern(row) === selected) : matched;

  return (
    <section className="storage-receipt" aria-labelledby="response-trends-title">
      <h2 id="response-trends-title">AI vs. human responses</h2>
      <p className="muted">
        Compare scored answers on the same image. Mostly correct means over 50%. Skips and answers
        needing review are excluded. Team test runs are included.
      </p>
      {error && <p role="alert">{error}</p>}
      {!rows && !error && <p role="status">Loading comparison…</p>}
      {rows && (
        <>
          <p>
            {matched.length} comparable images · {rows.length - matched.length} scored by only one
            group
          </p>
          {matched.length === 0 ? (
            <p>A comparison appears once both groups have scored answers on the same image.</p>
          ) : (
            <>
              <div className="action-row wrap" aria-label="Filter by response pattern">
                <button
                  className="button secondary"
                  aria-pressed={!selected}
                  onClick={() => setSelected('')}
                >
                  All patterns
                </button>
                {Object.entries(patterns).map(([key, label]) => (
                  <button
                    key={key}
                    className="button secondary"
                    aria-pressed={selected === key}
                    onClick={() => setSelected(key)}
                  >
                    {label} · {matched.filter((row) => pattern(row) === key).length}
                  </button>
                ))}
              </div>
              {visible.length === 0 ? (
                <p>No images match this pattern.</p>
              ) : (
                <div className="report-table-wrap">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th scope="col">Image</th>
                        <th scope="col">AI correct</th>
                        <th scope="col">Human correct</th>
                        <th scope="col">Pattern</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((row) => (
                        <tr key={row.id}>
                          <td>
                            {row.ground_truth} · {row.dataset} · d = {row.difficulty}
                            <br />
                            <code>{row.id.slice(0, 8)}</code>
                          </td>
                          <td>
                            <Rate correct={row.ai_correct} total={row.ai_total} />
                          </td>
                          <td>
                            <Rate correct={row.human_correct} total={row.human_total} />
                          </td>
                          <td>{patterns[pattern(row)]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
