import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Drawing from './Drawing';
import Results from './Results';
import { parseAccessLink } from './access-links';
import { api, loadSession, storeSession, exportFile, csv, SESSION_KEY } from './api';
import './style.css';

const modeName = (mode) =>
  mode === 'choices'
    ? 'Answer choices for every image'
    : mode === 'hybrid'
      ? 'MNIST + Fashion choices; CIFAR-10 open answers'
      : 'Original response format';
function App() {
  const [config, setConfig] = useState(null),
    [condition, setCondition] = useState('study-3211-v2');
  const [role, setRole] = useState('respondent'),
    [mode, setMode] = useState('hybrid'),
    [draftMode, setDraftMode] = useState('hybrid');
  const [alias, setAlias] = useState(''),
    [kind, setKind] = useState('human'),
    [screen, setScreen] = useState('home');
  const [state, setState] = useState(null),
    [image, setImage] = useState(''),
    [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(''),
    [feedback, setFeedback] = useState(null),
    [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false),
    [booting, setBooting] = useState(true),
    [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(''),
    [truncated, setTruncated] = useState(false),
    [hasSession, setHasSession] = useState(false);
  const [respondentLink, setRespondentLink] = useState(''),
    [notice, setNotice] = useState('');
  const context = useRef({ invite: '', team_key: '' }),
    session = useRef(null),
    sessionKey = useRef(SESSION_KEY);
  const events = useRef([]),
    start = useRef(0),
    locked = useRef(true),
    blob = useRef(''),
    activeTrial = useRef(null),
    generation = useRef(0);
  const [accessValid, setAccessValid] = useState(false);
  const [inviteUsed, setInviteUsed] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const report = (e) => setError(e.message || String(e));
  function persist() {
    try {
      storeSession(session.current, sessionKey.current);
      setHasSession(Boolean(session.current));
      return true;
    } catch {
      setStorageWarning(
        'Browser storage is unavailable. Keep this page open and export a pending-answer backup before leaving.',
      );
      return false;
    }
  }
  function record(type, data = {}) {
    if (!start.current || locked.current) return;
    if (events.current.length >= 2500) {
      setTruncated(true);
      return;
    }
    events.current.push({ type, t: Math.max(0, performance.now() - start.current), ...data });
  }
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const bootVersion = ++generation.current;
      try {
        let saved = { invite: '', team_key: '' };
        try {
          saved = JSON.parse(sessionStorage.getItem('cq_access_context') || 'null') || {
            invite: sessionStorage.getItem('cq_invite') || '',
            team_key: '',
          };
        } catch {}
        const incoming = parseAccessLink(location.href);
        if (incoming) saved = incoming;
        context.current = saved;
        try {
          sessionStorage.setItem('cq_access_context', JSON.stringify(saved));
        } catch {}
        // Keep the complete capability URL so it can be refreshed, bookmarked and shared.
        if (!incoming && (saved.invite || saved.team_key)) {
          history.replaceState(
            null,
            '',
            saved.team_key ? `/team/${saved.team_key}` : `/join/${saved.invite}`,
          );
        }
        sessionKey.current = `${SESSION_KEY}:${saved.team_key ? 'team:' + saved.team_key : saved.invite ? 'invite:' + saved.invite : 'local'}`;
        const legacy = loadSession();
        session.current =
          loadSession(sessionKey.current) ||
          ((legacy?.invite || '') === (saved.invite || '') && !saved.team_key ? legacy : null);
        setHasSession(Boolean(session.current));
        const cfg = await api('/api/config');
        if (cancelled || bootVersion !== generation.current) return;
        setConfig(cfg);
        setCondition(cfg.conditions.find((c) => c.ready)?.id || 'study-3211-v2');
        if (saved.invite || saved.team_key) {
          const access = await api('/api/access', { body: saved });
          if (cancelled || bootVersion !== generation.current) return;
          setAccessValid(true);
          setInviteUsed(Boolean(access.used));
          setRole(access.role);
          setMode(access.answer_mode);
          setDraftMode(access.answer_mode);
          if (access.plan_id) setCondition(access.plan_id);
        }
      } catch (e) {
        if (!cancelled && bootVersion === generation.current) report(e);
      } finally {
        if (!cancelled && bootVersion === generation.current) setBooting(false);
      }
    }
    boot();
    const changedLink = () => {
      if (!location.hash) return;
      setAccessValid(false);
      setInviteUsed(false);
      activeTrial.current = null;
      locked.current = true;
      start.current = 0;
      setScreen('home');
      setState(null);
      setImage('');
      setReady(false);
      setFeedback(null);
      setRole('respondent');
      setRespondentLink('');
      setNotice('');
      setError('');
      setBooting(true);
      boot();
    };
    window.addEventListener('hashchange', changedLink);
    const visibility = () => record('visibility_changed', { hidden: document.hidden });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', changedLink);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    const before = (e) => {
      if (screen === 'play' && !feedback) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [screen, feedback]);

  const [receipt, setReceipt] = useState(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState('');
  async function verifyStorage() {
    const currentSession = session.current;
    if (!currentSession?.run_id) return;
    setReceiptBusy(true);
    setReceiptError('');
    try {
      const data = await api(`/api/runs/${currentSession.run_id}/storage`, {
        token: currentSession.token,
      });
      if (session.current === currentSession) setReceipt(data);
    } catch (e) {
      if (session.current === currentSession) setReceiptError(e.message);
    } finally {
      if (session.current === currentSession) setReceiptBusy(false);
    }
  }
  async function showState(next) {
    const version = ++generation.current;
    activeTrial.current = null;
    locked.current = true;
    start.current = 0;
    events.current = [];
    setScreen('loading');
    setReady(false);
    setImage('');
    setFeedback(null);
    setSelected('');
    setTruncated(false);
    setState(next);
    if (blob.current) {
      URL.revokeObjectURL(blob.current);
      blob.current = '';
    }
    if (next.complete) {
      const data = await api(`/api/runs/${session.current.run_id}/results`, {
        token: session.current.token,
      });
      if (version !== generation.current) return;
      setResults(data.rows);
      setScreen('results');
      setReceipt(null);
      void verifyStorage();
      return;
    }
    if (!next.trial?.id || !next.trial.image)
      throw new Error('The current image could not be loaded. Please resume your session.');
    const response = await fetch(next.trial.image, {
      headers: { Authorization: `Bearer ${session.current.token}` },
    });
    if (!response.ok) throw new Error('The image could not be loaded. Please resume your session.');
    const data = await response.blob();
    if (version !== generation.current) return;
    blob.current = URL.createObjectURL(data);
    activeTrial.current = next.trial.id;
    setImage(blob.current);
    setScreen('play');
  }
  async function startRun() {
    if (busy || booting) return;
    setBusy(true);
    setError('');
    try {
      if (!session.current) {
        session.current = {
          token: crypto.randomUUID() + crypto.randomUUID(),
          condition,
          alias,
          participant_kind: kind,
          ...context.current,
        };
        if (!persist()) {
          session.current = null;
          throw new Error(
            'Allow browser storage before starting so your session can be recovered.',
          );
        }
      }
      const s = session.current;
      const next = await api('/api/runs', {
        token: s.token,
        body: {
          condition: s.condition,
          alias: s.alias,
          participant_kind: s.participant_kind,
          invite: s.invite || undefined,
          team_key: s.team_key || undefined,
        },
      });
      s.run_id = next.run_id;
      s.answer_mode = next.answer_mode;
      persist();
      if (s.pending) await sendPending();
      else await showState(next);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function resume() {
    if (busy || !session.current) return;
    if (!session.current.run_id) return startRun();
    setBusy(true);
    setError('');
    try {
      if (session.current.pending) await sendPending();
      else
        await showState(
          await api(`/api/runs/${session.current.run_id}`, { token: session.current.token }),
        );
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function imageLoaded(trialId) {
    if (!trialId || activeTrial.current !== trialId || start.current) return;
    const version = generation.current;
    start.current = performance.now();
    events.current = [
      { type: 'stimulus_ready', t: 0 },
      { type: 'visibility_changed', t: 0, hidden: document.hidden },
    ];
    try {
      await api(`/api/runs/${session.current.run_id}/trials/${trialId}/ready`, {
        token: session.current.token,
        method: 'POST',
      });
      if (version === generation.current && activeTrial.current === trialId) {
        locked.current = false;
        setReady(true);
      }
    } catch (e) {
      if (version === generation.current) report(e);
    }
  }
  async function sendPending() {
    const s = session.current,
      p = s.pending;
    if (!p) throw new Error('No pending answer. Resume your session.');
    const result = await api(`/api/runs/${s.run_id}/trials/${p.trial_id}/answer`, {
      token: s.token,
      body: p.body,
    });
    if (session.current !== s) return;
    if (p.snapshot) setState(p.snapshot);
    setSelected(p.body.answer);
    setFeedback(result);
    setScreen('play');
    setReady(false);
    locked.current = true;
    s.last_feedback = { ...result, ordinal: p.ordinal };
    delete s.pending;
    persist();
  }
  async function submit(skipped = false) {
    const trial = state?.trial;
    if (
      !trial ||
      activeTrial.current !== trial.id ||
      (!skipped && !selected.trim()) ||
      !ready ||
      busy ||
      locked.current
    )
      return;
    setBusy(true);
    setError('');
    record(skipped ? 'trial_skipped' : 'answer_submitted');
    const duration = performance.now() - start.current;
    locked.current = true;
    session.current.pending = {
      trial_id: trial.id,
      ordinal: trial.ordinal,
      snapshot: state,
      body: {
        submission_id: crypto.randomUUID(),
        answer: skipped ? '' : selected,
        skipped,
        response_time_ms: duration,
        telemetry: {
          events: [...events.current],
          viewport_width: innerWidth,
          viewport_height: innerHeight,
          truncated,
        },
      },
    };
    persist();
    try {
      await sendPending();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function next() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await showState(
        await api(`/api/runs/${session.current.run_id}`, { token: session.current.token }),
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await sendPending();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  function choose(value) {
    if (!ready || locked.current || busy) return;
    setSelected(value);
    record('answer_changed', { answer: value });
  }
  function startOver() {
    if (
      (role !== 'team' && (!config?.public_runs || context.current.invite)) ||
      busy ||
      session.current?.pending
    )
      return;
    if (
      screen === 'play' &&
      !feedback &&
      !window.confirm(
        'Start a new test run? Unsubmitted work will be lost. Saved answers will remain.',
      )
    )
      return;
    try {
      localStorage.removeItem(sessionKey.current);
    } catch {
      setError('Could not clear the saved session.');
      return;
    }
    generation.current++;
    activeTrial.current = null;
    session.current = null;
    events.current = [];
    start.current = 0;
    locked.current = true;
    if (blob.current) {
      URL.revokeObjectURL(blob.current);
      blob.current = '';
    }
    setHasSession(false);
    setState(null);
    setImage('');
    setReady(false);
    setSelected('');
    setFeedback(null);
    setResults([]);
    setError('');
    setTruncated(false);
    setScreen('home');
  }
  async function saveMode() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await api('/api/team/settings', {
        token: context.current.team_key,
        body: { answer_mode: draftMode },
      });
      setMode(saved.answer_mode);
      setNotice(
        'Saved. New invitation links and test runs use this format. Existing runs keep their original format.',
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function copyRespondentLink() {
    try {
      await navigator.clipboard.writeText(respondentLink);
      setCopyNotice('Complete invitation link copied.');
    } catch {
      setCopyNotice('Select the link field and copy the complete address.');
    }
  }
  async function createInvite() {
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/team/invitations', {
        token: context.current.team_key,
        body: { condition: 'study-3211-v2' },
      });
      setRespondentLink(data.url);
      setCopyNotice('');
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const key = (e) => {
      if (
        screen !== 'play' ||
        !ready ||
        busy ||
        locked.current ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (state?.trial?.answer_type === 'digit' && /^[1-9]$/.test(e.key)) choose(e.key);
      else if (e.key === 'Enter' && selected) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [screen, ready, busy, selected, state]);
  const pending = Boolean(session.current?.pending),
    dirty = mode !== draftMode;
  const canRestart = role === 'team' || (config?.public_runs && !context.current.invite);
  const currentCondition = config?.conditions.find((c) => c.id === condition);
  const choice = state?.trial?.answer_type === 'digit' || state?.trial?.answer_type === 'choice';
  return (
    <div className="app-shell">
      <header className="topbar">
        <strong className="brand">Constellation Study</strong>
        <span className="muted">{role === 'team' ? 'Team workspace' : 'Recognition study'}</span>
      </header>
      <main className="container">
        {error && (
          <div role="alert" className="feedback-box error">
            {error}
          </div>
        )}
        {storageWarning && (
          <p role="alert" className="warning-text">
            {storageWarning}
          </p>
        )}
        {hasSession && canRestart && screen !== 'results' && (
          <div className="action-row wrap top16">
            <button className="button secondary" disabled={busy || pending} onClick={startOver}>
              Start a new test run
            </button>
            {role === 'team' && screen !== 'home' && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setScreen('home')}
              >
                Team settings
              </button>
            )}
          </div>
        )}
        {screen === 'home' && (
          <>
            {role === 'team' && (
              <section className="card setup-card top20" aria-label="Team settings">
                <div className="eyebrow">Team only</div>
                <h2>Study settings</h2>
                <label className="label" htmlFor="answer-mode">
                  Response format
                </label>
                <select
                  id="answer-mode"
                  className="text-input"
                  value={draftMode}
                  disabled={busy}
                  onChange={(e) => setDraftMode(e.target.value)}
                >
                  <option value="hybrid">MNIST + Fashion choices; CIFAR-10 open answers</option>
                  <option value="choices">Answer choices for every image</option>
                </select>
                <p className="muted">
                  Settings apply to new invitation links and test runs. Respondents cannot change
                  the format.
                </p>
                <div className="action-row wrap">
                  <button className="button primary" disabled={busy || !dirty} onClick={saveMode}>
                    Save settings
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || dirty}
                    onClick={createInvite}
                  >
                    Create respondent link
                  </button>
                </div>
                {notice && (
                  <p role="status" className="muted">
                    {notice}
                  </p>
                )}
                {respondentLink && (
                  <>
                    <label className="label" htmlFor="respondent-link">
                      Share this link with one respondent
                    </label>
                    <input
                      id="respondent-link"
                      className="text-input"
                      readOnly
                      value={respondentLink}
                      onFocus={(e) => e.target.select()}
                    />
                    <button className="button secondary top16" onClick={copyRespondentLink}>
                      Copy complete link
                    </button>
                    {copyNotice && (
                      <p role="status" className="muted">
                        {copyNotice}
                      </p>
                    )}
                    <p className="muted">
                      One link per respondent. For team testing, share the reusable team link
                      instead.
                    </p>
                    <a
                      href={respondentLink}
                      target="_blank"
                      rel="noreferrer"
                      className="back-link top16"
                    >
                      Open respondent view
                    </a>
                  </>
                )}
                <p className="warning-text">
                  Keep your team link private: it grants access to these settings and test restarts.
                </p>
              </section>
            )}
            <section className="card setup-card top20">
              <div className="eyebrow">Constellation recognition</div>
              <h1>What do you see in the stars?</h1>
              <p className="intro">
                Identify the shape in each image. Select an answer when options are shown;
                otherwise, describe what you see in English. You may draw lines to help you see the
                shape. Drawing is optional.
              </p>
              <p className="muted">
                The study has 21 images and progresses from easier to harder images, starting with
                digits. After submitting or skipping an image, you will see the expected answer and
                can continue. You cannot change an answer after revealing it.
              </p>
              <p className="muted">
                We save answers, response times, drawing actions, answer changes and page
                visibility. A browser session lets you resume. Please do not enter personal
                information.
              </p>
              {booting ? (
                <p role="status">Connecting…</p>
              ) : hasSession ? (
                <div className="stack gap12">
                  <p>Your browser has a saved session.</p>
                  <button className="button primary" disabled={busy} onClick={resume}>
                    Resume saved session
                  </button>
                </div>
              ) : (
                <>
                  <label className="label" htmlFor="alias">
                    Participant alias (optional)
                  </label>
                  <input
                    id="alias"
                    className="text-input"
                    maxLength={30}
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                  />
                  <label className="label" htmlFor="kind">
                    Participant type
                  </label>
                  <select
                    id="kind"
                    className="text-input"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="human">Human</option>
                    <option value="model">Language model</option>
                  </select>
                  {(role === 'team' || (!context.current.invite && config?.public_runs)) && (
                    <div className="stack gap12 top20">
                      {config?.conditions.map((c) => (
                        <button
                          key={c.id}
                          disabled={!c.ready}
                          className={`tier-row ${condition === c.id ? 'selected' : ''}`}
                          onClick={() => setCondition(c.id)}
                        >
                          {c.name}
                          {!c.ready && ' · Needs images'}
                        </button>
                      ))}
                    </div>
                  )}
                  {role === 'team' && (
                    <p className="muted">
                      Current format: {modeName(mode)}. Test runs are marked as team data.
                    </p>
                  )}
                  {context.current.invite && accessValid && inviteUsed && !hasSession && (
                    <p role="alert" className="warning-text">
                      This single-use invitation has already been started in another browser. Return
                      to that browser to resume, or ask the organiser for a new link. Do not share
                      one respondent link with several people.
                    </p>
                  )}
                  {!config?.public_runs && !context.current.invite && role !== 'team' && (
                    <p className="warning-text">
                      Use your invitation link to start. Ask the organiser if you do not have one.
                    </p>
                  )}
                  <button
                    className="button primary wide top24"
                    disabled={
                      busy ||
                      !config ||
                      ((context.current.invite || context.current.team_key) && !accessValid) ||
                      (context.current.invite && inviteUsed && !hasSession) ||
                      dirty ||
                      (!context.current.invite &&
                        role !== 'team' &&
                        (!config.public_runs || !currentCondition?.ready))
                    }
                    onClick={startRun}
                  >
                    {busy ? 'Starting…' : role === 'team' ? 'Start test run' : 'Start study'}
                  </button>
                </>
              )}
              {config?.conditions.some((c) => c.demo) && (
                <p className="warning-text">
                  Synthetic demo images are active. These are for technical testing only.
                </p>
              )}
            </section>
          </>
        )}
        {screen === 'loading' && (
          <section className="card">
            <p role="status">Loading your session…</p>
            {!busy && (
              <button className="button secondary" onClick={resume}>
                Resume session
              </button>
            )}
          </section>
        )}
        {screen === 'play' && (
          <section className="play-layout top20">
            <div className="card stimulus-card">
              <div className="eyebrow">Recognition task</div>
              <h1>Constellation</h1>
              <div className="trial-meta">
                <span>
                  Trial{' '}
                  {state?.trial?.ordinal ||
                    session.current?.last_feedback?.ordinal ||
                    session.current?.pending?.ordinal}{' '}
                  / {state?.trial_count || 21}
                </span>
                <span>
                  {{ mnist: 'MNIST', fashion: 'Fashion', cifar10: 'CIFAR-10' }[state?.dataset] ||
                    ''}{' '}
                  {state?.difficulty ? `d = ${state.difficulty}` : ''}
                </span>
              </div>
              {image && state?.trial?.id && (
                <Drawing
                  key={state.trial.id}
                  image={image}
                  enabled={ready && !busy && !locked.current && !truncated}
                  onLoad={() => imageLoaded(state.trial.id)}
                  onError={() =>
                    setError('The image could not be displayed. Reload the current trial.')
                  }
                  record={record}
                />
              )}
              {truncated && (
                <p className="warning-text">Drawing limit reached. You can still answer or skip.</p>
              )}
            </div>
            <div className="card answer-card">
              <h2>
                {state?.trial?.answer_type === 'digit'
                  ? 'What digit do you see?'
                  : 'What do you see?'}
              </h2>
              <p className="muted">
                {choice
                  ? 'Select the answer that best matches what you see.'
                  : 'Describe what you see in English.'}{' '}
                Optional: draw lines on the image to help you recognise the shape.
              </p>
              {choice ? (
                <div
                  className={state.trial.answer_type === 'digit' ? 'digit-grid' : 'answer-options'}
                >
                  {(state.trial.options || []).map((value) => (
                    <button
                      key={value}
                      disabled={!ready || busy || locked.current}
                      className={`${state.trial.answer_type === 'digit' ? 'digit-button' : 'tier-row'} ${selected === value ? 'selected' : ''}`}
                      onClick={() => choose(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <label className="label" htmlFor="object-answer">
                    Your answer
                  </label>
                  <input
                    id="object-answer"
                    className="text-input"
                    maxLength={500}
                    value={selected}
                    disabled={!ready || busy || locked.current}
                    onChange={(e) => {
                      setSelected(e.target.value);
                      record('answer_changed');
                    }}
                  />
                </>
              )}
              {feedback ? (
                <>
                  <div
                    role="status"
                    className={`feedback-box ${feedback.skipped || feedback.correct === null ? '' : feedback.correct ? 'success' : 'error'}`}
                  >
                    {feedback.skipped
                      ? 'Skipped.'
                      : feedback.correct
                        ? 'Correct!'
                        : feedback.correct === null
                          ? 'Saved for review.'
                          : `Your answer: ${feedback.answer}.`}{' '}
                    Expected answer: {feedback.correct_answer}.
                  </div>
                  {feedback.grading_method === 'synonyms-v1' && (
                    <p className="muted">Your wording was accepted as a matching answer.</p>
                  )}
                  <p className="muted">Saved to the study server. This answer is locked.</p>
                  <button className="button primary wide top20" disabled={busy} onClick={next}>
                    {busy ? 'Loading…' : 'Continue'}
                  </button>
                </>
              ) : pending ? (
                <>
                  <p className="warning-text">
                    Your answer is waiting for server confirmation. Retrying sends the same locked
                    answer.
                  </p>
                  <button className="button primary wide" disabled={busy} onClick={retry}>
                    Retry saving answer
                  </button>
                  <button
                    className="button secondary top16"
                    onClick={() =>
                      exportFile(
                        'pending-answer.json',
                        JSON.stringify(session.current.pending, null, 2),
                      )
                    }
                  >
                    Export pending answer backup
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="button primary wide top20"
                    disabled={!ready || !selected.trim() || busy}
                    onClick={() => submit(false)}
                  >
                    {busy ? 'Saving…' : 'Submit answer'}
                  </button>
                  <button
                    className="button secondary wide top16"
                    disabled={!ready || busy || locked.current}
                    onClick={() => submit(true)}
                  >
                    Skip and show answer
                  </button>
                </>
              )}
              {!ready && !feedback && !pending && !busy && (
                <button className="button secondary top16" onClick={resume}>
                  Reload current trial
                </button>
              )}
            </div>
          </section>
        )}
        {screen === 'results' && (
          <Results
            rows={results}
            runId={session.current.run_id}
            team={role === 'team'}
            canRestart={canRestart}
            onRestart={startOver}
            onSettings={() => setScreen('home')}
            receipt={receipt}
            receiptBusy={receiptBusy}
            receiptError={receiptError}
            onVerify={verifyStorage}
            onExport={() =>
              exportFile(
                `constellation-${session.current.run_id}.csv`,
                csv(results.map((row) => ({ run_id: session.current.run_id, ...row }))),
                'text/csv',
              )
            }
          />
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);
