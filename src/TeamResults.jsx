import React, { useEffect, useState } from 'react';
import { api, csv, exportFile } from './api';

function fetchPage(token, cursor) {
  return api('/api/team/results?after=' + encodeURIComponent(cursor || ''), { token });
}

export default function TeamResults({ token, onBack }) {
  const [cursor, setCursor] = useState('');
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let current = true;
    setPage(null);
    fetchPage(token, cursor)
      .then((data) => {
        if (current) setPage(data);
      })
      .catch((err) => {
        if (current) setError(err.message);
      });
    return () => {
      current = false;
    };
  }, [token, cursor]);

  async function download(format) {
    setDownloading(true);
    setError('');
    try {
      const rows = [];
      let next = '';
      do {
        const page = await fetchPage(token, next);
        rows.push(...page.rows);
        next = page.next_cursor;
      } while (next);
      if (format === 'csv') {
        const summary = rows.map(({ telemetry, ...row }) => ({ ...row, ...telemetry?.summary }));
        exportFile('study-results.csv', csv(summary), 'text/csv');
      } else {
        exportFile('study-results.json', JSON.stringify(rows, null, 2));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="card top20">
      <h1>Study results</h1>
      <p>
        Browse saved responses, including team test runs. JSON includes raw telemetry events. CSV
        includes telemetry summaries.
      </p>
      <div className="action-row wrap">
        <button className="button secondary" onClick={onBack}>
          Back to team settings
        </button>
        <button className="button primary" disabled={downloading} onClick={() => download('json')}>
          Download all as JSON
        </button>
        <button className="button secondary" disabled={downloading} onClick={() => download('csv')}>
          Download all as CSV
        </button>
      </div>
      {downloading && <p role="status">Preparing download…</p>}
      {error && (
        <p role="alert" className="warning-text">
          {error}
        </p>
      )}
      {!page && !error && <p role="status">Loading responses…</p>}
      {page?.rows.length === 0 && <p>No responses on this page.</p>}
      <div className="team-response-list">
        {page?.rows.map((row) => (
          <details key={row.trial_id}>
            <summary>
              {row.alias || 'Anonymous'} · {row.audience} · {row.dataset} · Trial {row.ordinal} ·{' '}
              {row.skipped
                ? 'Skipped'
                : row.correct === 1
                  ? 'Correct'
                  : row.correct === 0
                    ? 'Incorrect'
                    : 'Needs review'}
            </summary>
            <p>
              Answer: {row.answer || '—'} · Expected: {row.ground_truth} · {row.response_time_ms} ms
            </p>
            <pre>{JSON.stringify(row, null, 2)}</pre>
          </details>
        ))}
      </div>
      <div className="action-row wrap top16">
        {cursor && (
          <button
            className="button secondary"
            onClick={() => {
              setError('');
              setCursor('');
            }}
          >
            First page
          </button>
        )}
        {page?.next_cursor && (
          <button
            className="button secondary"
            onClick={() => {
              setError('');
              setCursor(page.next_cursor);
            }}
          >
            Next page
          </button>
        )}
      </div>
    </section>
  );
}
