import React, { useEffect, useState } from 'react';
import { api, csv, exportFile } from './api';
import ResponseTrends from './ResponseTrends';

function fetchPage(token, cursor) {
  return api('/api/team/results?after=' + encodeURIComponent(cursor || ''), { token });
}

function groupByRun(rows) {
  const runs = new Map();
  for (const row of rows) {
    const {
      run_id,
      alias,
      participant_kind,
      audience,
      plan_id,
      answer_mode,
      run_created_at,
      trial_count,
      ...answer
    } = row;
    if (!runs.has(run_id)) {
      runs.set(run_id, {
        run_id,
        alias,
        participant_kind,
        audience,
        plan_id,
        answer_mode,
        created_at: run_created_at,
        trial_count,
        answers: [],
      });
    }
    runs.get(run_id).answers.push(answer);
  }
  return [...runs.values()].map((run) => {
    run.answers.sort((a, b) => a.ordinal - b.ordinal);
    const scores = new Map();
    for (const answer of run.answers) {
      if (!scores.has(answer.dataset)) {
        scores.set(answer.dataset, {
          dataset: answer.dataset,
          saved: 0,
          correct: 0,
          skipped: 0,
          needs_review: 0,
        });
      }
      const score = scores.get(answer.dataset);
      score.saved += 1;
      if (answer.skipped) score.skipped += 1;
      else if (answer.correct === 1) score.correct += 1;
      else if (answer.correct == null) score.needs_review += 1;
    }
    return {
      ...run,
      complete: run.answers.length === run.trial_count,
      block_scores: [...scores.values()],
    };
  });
}

export default function TeamResults({ token, onBack }) {
  const [cursor, setCursor] = useState('');
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let current = true;
    setPage(null);
    api('/api/team/response-report?after=' + encodeURIComponent(cursor), { token })
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
      } else if (format === 'grouped') {
        exportFile('study-results-by-run.json', JSON.stringify(groupByRun(rows), null, 2));
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
        <button
          className="button secondary"
          disabled={downloading}
          onClick={() => download('grouped')}
        >
          Download JSON by run
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
      <ResponseTrends token={token} />
      {!page && !error && <p role="status">Loading responses…</p>}
      {page?.runs.length === 0 && <p>No responses on this page.</p>}
      <div className="team-response-list">
        {page?.runs.map((run, index) => (
          <details key={run.id} open={index === 0}>
            <summary>
              <strong>{run.alias || 'Anonymous'}</strong>
              <span className="report-badge">
                {run.participant_kind === 'model' ? 'AI' : 'Human'}
              </span>
              <span>
                {run.rows.length} / {run.trial_count} saved
              </span>
              {run.audience === 'team' && <span className="report-badge">Team test</span>}
            </summary>
            <p className="results-explanation">
              {new Date(run.created_at).toLocaleString()} · Run ID <code>{run.id}</code>
            </p>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Question</th>
                    <th scope="col">Block</th>
                    <th scope="col">Given answer</th>
                    <th scope="col">Expected answer</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {run.rows.map((row) => {
                    const result = row.skipped
                      ? 'Skipped'
                      : row.correct === 1
                        ? 'Correct'
                        : row.correct === 0
                          ? 'Incorrect'
                          : 'Needs review';
                    return (
                      <tr key={row.ordinal}>
                        <td>{row.ordinal}</td>
                        <td>
                          {{
                            mnist: 'MNIST',
                            fashion: 'FashionMNIST',
                            quickdraw: 'Quickdraw',
                            cifar10: 'CIFAR-10',
                          }[row.dataset] ?? row.dataset}
                        </td>
                        <td>{row.answer || '—'}</td>
                        <td>{row.ground_truth}</td>
                        <td>
                          <span className="report-badge" data-result={result}>
                            {result}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
