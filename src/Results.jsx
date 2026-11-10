import React from 'react';

const formatTime = (value) =>
  value ? new Date(value).toLocaleString('en-GB', { timeZoneName: 'short' }) : '—';
export default function Results({
  rows,
  runId,
  team,
  canRestart,
  onRestart,
  onSettings,
  onExport,
  receipt,
  receiptBusy,
  receiptError,
  onVerify,
}) {
  const skipped = rows.filter((row) => row.skipped).length;
  const mean = rows.length
    ? (rows.reduce((sum, row) => sum + row.response_time_ms, 0) / rows.length / 1000).toFixed(1)
    : '—';
  return (
    <section className="card results-card">
      <div className="eyebrow">Run complete</div>
      <h1>Thank you!</h1>
      <p className="muted results-intro">All {rows.length} responses have been saved.</p>
      <dl className="results-counts">
        <div>
          <dt>Answered</dt>
          <dd>{rows.length - skipped}</dd>
        </div>
        <div>
          <dt>Skipped</dt>
          <dd>{skipped}</dd>
        </div>
      </dl>
      <div className="results-grid">
        <div className="result-metric">
          <strong>{mean} s</strong>
          <span>Mean response time</span>
          <small>Includes answered and skipped images</small>
        </div>
      </div>
      {team && (
        <section className="storage-receipt" aria-label="Storage verification">
          <div className="storage-heading">
            <h2>Storage verification</h2>
            <span className="storage-badge">
              {receipt?.environment === 'production'
                ? 'Cloudflare D1'
                : receipt?.environment === 'local'
                  ? 'Local D1'
                  : 'Server storage'}
            </span>
          </div>
          <p className="muted">Checked directly against the database for this run.</p>
          <dl className="storage-details">
            <div>
              <dt>Run ID</dt>
              <dd>
                <code>{runId}</code>
              </dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{receipt?.database || '—'}</dd>
            </div>
            <div>
              <dt>Responses stored</dt>
              <dd>
                {receipt ? `${receipt.saved_count} / ${receipt.expected_count}` : 'Checking…'}
              </dd>
            </div>
            <div>
              <dt>Last saved</dt>
              <dd>{formatTime(receipt?.last_saved_at)}</dd>
            </div>
            <div>
              <dt>Last checked</dt>
              <dd>{formatTime(receipt?.verified_at)}</dd>
            </div>
            <div>
              <dt>Data group</dt>
              <dd>{receipt?.audience === 'team' ? 'Team test run' : receipt?.audience || '—'}</dd>
            </div>
          </dl>
          {receipt && !receipt.complete && (
            <p role="alert" className="warning-text">
              The database count does not match the expected number of responses. Keep the run ID
              for investigation.
            </p>
          )}
          {receiptError && (
            <p role="alert" className="warning-text">
              Could not verify storage: {receiptError}
            </p>
          )}
          <button className="button secondary" disabled={receiptBusy} onClick={onVerify}>
            {receiptBusy ? 'Checking database…' : 'Verify storage again'}
          </button>
        </section>
      )}
      <div className="results-actions">
        {canRestart && (
          <button className="button primary" onClick={onRestart}>
            Start a new test run
          </button>
        )}
        {team && (
          <button className="button secondary" onClick={onSettings}>
            Team settings
          </button>
        )}
        <button className="button secondary" onClick={onExport}>
          Export this run
        </button>
      </div>
      {!canRestart && (
        <p className="muted results-explanation">
          Contact the organiser if you need another invitation.
        </p>
      )}
    </section>
  );
}
