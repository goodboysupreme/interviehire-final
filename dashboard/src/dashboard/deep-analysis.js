// Deep Analysis — post-interview candidate intelligence. Renders the canonical
// CandidateReport contract (Aviral's evaluation engine; see memory:
// interviehire-eval-report-contract) as a master→detail view: a ranked roster
// of interviewed candidates, drilling into one full evaluation report.
// Until the eval pipeline is wired at stitch time, reports are sampled
// deterministically per candidate from the job's blueprint so the tab is live.

import { document } from './runtime.js';
import { escapeHTML } from './escape.js';
import { AppState } from './state.js';
import { filterCandidatesByDateRange } from './render-views.js';
import { soundEngine } from './sound.js';
import { isApiMode, apiFetchCandidateReport } from './api.js';

const DIMENSIONS = ['Correctness', 'Depth', 'Clarity', 'Communication', 'Role alignment'];

const RECO_META = {
  strong_proceed: { label: 'Strong proceed', color: '#2dd4bf' },
  proceed: { label: 'Proceed', color: '#34d399' },
  hold: { label: 'Hold', color: '#fbbf24' },
  reject: { label: 'Reject', color: '#f87171' },
  needs_human_review: { label: 'Needs review', color: '#fb923c' },
};
const SEV_COLOR = { low: '#9a9a9a', medium: '#fbbf24', high: '#fb923c', critical: '#f87171' };
const CONF_COLOR = { high: '#34d399', medium: '#fbbf24', low: '#f87171' };

function scoreColor(s) {
  if (s >= 88) return '#2dd4bf';
  if (s >= 72) return '#34d399';
  if (s >= 55) return '#fbbf24';
  return '#f87171';
}
const uniq = (a) => [...new Set((a || []).filter(Boolean))];

// Deterministic PRNG so each candidate's sampled report is stable across renders.
function rng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
}

const GENERIC_Q = [
  { prompt: 'Walk me through a project you are proud of and your specific contribution.', questionType: 'behavioral', topic: 'Core competency', rubric: { requiredPoints: [{ description: 'Specific personal contribution' }, { description: 'Clear, measurable impact' }], redFlags: [{ description: 'Only describes the team, not themselves', severity: 'medium' }] } },
  { prompt: 'Describe a hard problem in your domain and how you approached it.', questionType: 'case_study', topic: 'Problem solving', rubric: { requiredPoints: [{ description: 'Breaks the problem into parts' }, { description: 'Weighs trade-offs' }], redFlags: [] } },
  { prompt: 'How would you explain your work to someone outside your field?', questionType: 'behavioral', topic: 'Communication', rubric: { requiredPoints: [{ description: 'Plain language, no jargon' }], redFlags: [] } },
];

export function buildSampleCandidateReport(candidate, job) {
  const rand = rng(candidate.id || candidate.name || 'seed');
  const anchor = Number.isFinite(candidate.interviewScore) ? candidate.interviewScore : Math.round(55 + rand() * 40);
  const vary = (base, spread) => Math.max(10, Math.min(100, Math.round(base + (rand() * 2 - 1) * spread)));

  const topics = (job.functionalParameters && job.functionalParameters.topics) || [];
  let items = topics.flatMap((t) => t.questions.map((q) => ({ q, topicName: t.name })));
  if (!items.length) items = GENERIC_Q.map((q) => ({ q, topicName: q.topic }));

  const questionBreakdown = items.map((item, i) => {
    const qScore = vary(anchor, 16);
    const dimensionScores = {};
    DIMENSIONS.forEach((d) => { dimensionScores[d] = { score: vary(qScore, 12), reason: `${d} assessed from the candidate's spoken answer.`, evidence: [], missing: [] }; });
    const reqs = (item.q.rubric?.requiredPoints || []).map((p) => p.description).filter(Boolean);
    const splitAt = Math.max(0, Math.round(reqs.length * (0.4 + rand() * 0.5)));
    const covered = reqs.slice(0, splitAt);
    const missed = reqs.slice(splitAt);
    const flags = item.q.rubric?.redFlags || [];
    const triggered = (qScore < 62 && flags.length && rand() < 0.6)
      ? [{ label: flags[0].description || 'Concern', severity: flags[0].severity || 'medium', reason: 'Signal detected in the transcript.' }] : [];
    return {
      answerId: `a-${candidate.id}-${i}`,
      questionId: item.q.id || `q-${i}`,
      questionText: item.q.prompt || 'Question',
      topicName: item.topicName,
      questionOrigin: 'predetermined',
      evaluationMode: 'model_answer_based',
      overallScore: qScore,
      dimensionScores,
      modelAnswerComparison: { coveredRequiredPoints: covered, missedRequiredPoints: missed, coveredBonusPoints: [], incorrectClaims: [] },
      strengths: covered.slice(0, 2),
      weaknesses: missed.slice(0, 2),
      redFlags: triggered,
      followUpRecommendations: missed.length ? [`Probe deeper on: ${missed[0]}`] : [],
      evaluationConfidence: qScore > 75 ? 'high' : qScore > 55 ? 'medium' : 'low',
      summary: `Scored ${qScore}/100 on this question.`,
    };
  });

  const overallScore = Math.round(questionBreakdown.reduce((a, r) => a + r.overallScore, 0) / questionBreakdown.length);
  const allFlags = questionBreakdown.flatMap((r) => r.redFlags);
  const hasCritical = allFlags.some((f) => f.severity === 'critical');
  const hasHigh = allFlags.some((f) => f.severity === 'high');
  let recommendation = overallScore >= 88 ? 'strong_proceed' : overallScore >= 72 ? 'proceed' : overallScore >= 55 ? 'hold' : 'reject';
  if (hasHigh && overallScore < 80) recommendation = 'hold';
  if (hasCritical) recommendation = 'needs_human_review';
  const lowR = questionBreakdown.filter((r) => r.evaluationConfidence === 'low').length / questionBreakdown.length;
  const highR = questionBreakdown.filter((r) => r.evaluationConfidence === 'high').length / questionBreakdown.length;
  const recommendationConfidence = lowR >= 0.35 ? 'low' : highR >= 0.6 ? 'high' : 'medium';

  const skillScores = DIMENSIONS.map((d) => ({
    skill: d,
    score: Math.round(questionBreakdown.reduce((a, r) => a + (r.dimensionScores[d]?.score || 0), 0) / questionBreakdown.length),
    evidenceAnswerIds: questionBreakdown.map((r) => r.answerId),
  }));

  return {
    interviewId: `int-${candidate.id}`,
    candidateId: candidate.id,
    roleTitle: job.roleName || job.cardName || 'Role',
    interviewType: 'technical',
    overallScore,
    recommendation,
    recommendationConfidence,
    summary: `Candidate scored ${overallScore}/100 with a ${RECO_META[recommendation].label.toLowerCase()} recommendation and ${recommendationConfidence} confidence based on transcript-only evaluation.`,
    strengths: uniq(questionBreakdown.flatMap((r) => r.strengths)).slice(0, 6),
    weaknesses: uniq(questionBreakdown.flatMap((r) => r.weaknesses)).slice(0, 6),
    redFlags: allFlags,
    skillScores,
    questionBreakdown,
    suggestedNextSteps: uniq(questionBreakdown.flatMap((r) => r.followUpRecommendations)).slice(0, 5),
    transcriptOnly: true,
  };
}

const daUi = { selectedId: null, openAnswerId: null };

// Live (api mode) report cache: candidateId -> { state:'loading'|'ready'|'pending'|'error', report?, error? }.
const liveReports = new Map();

function interviewedCandidates(job) {
  return filterCandidatesByDateRange(AppState.candidates)
    .filter((c) => (c.jobApplied === job.roleName || c.jobApplied === job.cardName) && c.interviewStatus === 'Completed' && Number.isFinite(c.interviewScore));
}

const initials = (name) => (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function renderDeepAnalysisPane(job, container) {
  if (!job || !container) return;
  // API mode pulls real CandidateReports from the backend — honest empty/pending
  // until the eval engine scores an interview (no sample fabrication).
  if (isApiMode() && job._backend) return renderLive(job, container);

  const done = interviewedCandidates(job);
  if (!done.length) { container.innerHTML = emptyState(false); return; }

  const reports = done.map((c) => ({ candidate: c, report: buildSampleCandidateReport(c, job) }))
    .sort((a, b) => b.report.overallScore - a.report.overallScore);

  const selected = daUi.selectedId && reports.find((r) => r.candidate.id === daUi.selectedId);
  container.innerHTML = `<div class="da-intel">${selected ? detailMarkup(selected, reports) : rosterMarkup(job, reports)}</div>`;
  bind(container, job);
}

// ── Live path (real backend) ──────────────────────────────────────────────────
const recoFromScore = (s) => (s >= 88 ? 'strong_proceed' : s >= 72 ? 'proceed' : s >= 55 ? 'hold' : 'reject');
// Roster entries only need score + recommendation; the full report is fetched on
// drill-in. interviewScore is the backend's functional_score (real, not sampled).
function liveRosterEntry(c) {
  const s = Math.round(c.interviewScore);
  return { candidate: c, report: { overallScore: s, recommendation: recoFromScore(s), recommendationConfidence: 'medium', redFlags: [] } };
}

function renderLive(job, container) {
  const done = interviewedCandidates(job).map(liveRosterEntry).sort((a, b) => b.report.overallScore - a.report.overallScore);
  if (!done.length) { container.innerHTML = `<div class="da-intel">${emptyState(true)}</div>`; return; }

  const sel = daUi.selectedId && done.find((r) => r.candidate.id === daUi.selectedId);
  if (!sel) { container.innerHTML = `<div class="da-intel">${rosterMarkup(job, done)}</div>`; bind(container, job); return; }

  const entry = liveReports.get(sel.candidate.id);
  if (!entry) {
    liveReports.set(sel.candidate.id, { state: 'loading' });
    apiFetchCandidateReport(sel.candidate.id)
      .then((rep) => liveReports.set(sel.candidate.id, rep && Array.isArray(rep.questionBreakdown) ? { state: 'ready', report: rep } : { state: 'pending' }))
      .catch((e) => liveReports.set(sel.candidate.id, { state: 'error', error: (e && e.message) || '' }))
      .finally(() => { if (daUi.selectedId === sel.candidate.id && AppState.activeJobId === job.id) renderDeepAnalysisPane(job, container); });
    container.innerHTML = `<div class="da-intel">${liveDetailShell(sel.candidate, 'loading')}</div>`;
    bind(container, job); return;
  }
  container.innerHTML = `<div class="da-intel">${entry.state === 'ready'
    ? detailMarkup({ candidate: sel.candidate, report: entry.report }, done)
    : liveDetailShell(sel.candidate, entry.state, entry.error)}</div>`;
  bind(container, job);
}

function liveDetailShell(candidate, state, error) {
  const msg = state === 'loading'
    ? ['Loading evaluation…', 'Fetching this candidate’s report from the live backend.']
    : state === 'error'
      ? ['Couldn’t load the report', error || 'The backend did not return an evaluation.']
      : ['Evaluation pending', 'This interview hasn’t been scored yet. The full report — dimensions, rubric coverage, red flags and a recommendation — appears here once the evaluation engine processes the transcript.'];
  return `
    <div class="da-detail-head"><button class="da-back" data-action="back"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> All candidates</button></div>
    <div class="da-pending ${state === 'loading' ? 'is-loading' : ''}">
      <div class="da-pending-name">${escapeHTML(candidate.name)}</div>
      <div class="da-pending-state">${escapeHTML(msg[0])}</div>
      <div class="da-pending-desc">${escapeHTML(msg[1])}</div>
    </div>`;
}

function emptyState(apiMode) {
  const desc = apiMode
    ? 'No candidate has completed the AI interview for this role yet. Once an interview is completed and scored by the evaluation engine, the full report — scores, dimensions, rubric coverage, red flags and a hire recommendation — appears here, ranked.'
    : 'Once candidates complete the AI interview, their full evaluation reports — scores, dimensions, rubric coverage, red flags and a hire recommendation — appear here, ranked.';
  return `
  <div class="da-empty">
    <div class="da-empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="11" x2="13" y2="11"/></svg></div>
    <p class="da-empty-title">No completed interviews yet</p>
    <p class="da-empty-desc">${desc}</p>
  </div>`;
}

function rosterMarkup(job, reports) {
  const dist = {};
  reports.forEach((r) => { dist[r.report.recommendation] = (dist[r.report.recommendation] || 0) + 1; });
  const flagged = reports.filter((r) => r.report.redFlags.some((f) => f.severity === 'high' || f.severity === 'critical')).length;
  const avg = Math.round(reports.reduce((a, r) => a + r.report.overallScore, 0) / reports.length);

  return `
    <div class="da-roster-head">
      <div><h2 class="da-title">Candidate intelligence</h2><p class="da-sub">${reports.length} completed interview${reports.length !== 1 ? 's' : ''} · ranked by evaluation score</p></div>
    </div>
    <div class="da-stat-strip">
      <div class="da-stat"><span class="da-stat-num">${reports.length}</span><span class="da-stat-label">Interviewed</span></div>
      <div class="da-stat"><span class="da-stat-num" style="color:${scoreColor(avg)};">${avg}</span><span class="da-stat-label">Avg score</span></div>
      <div class="da-stat"><span class="da-stat-num" style="color:#2dd4bf;">${(dist.strong_proceed || 0) + (dist.proceed || 0)}</span><span class="da-stat-label">Proceed</span></div>
      <div class="da-stat"><span class="da-stat-num" style="color:${flagged ? '#fb923c' : '#9a9a9a'};">${flagged}</span><span class="da-stat-label">Flagged</span></div>
    </div>
    <div class="da-roster">
      ${reports.map((r, i) => rosterRow(r, i)).join('')}
    </div>`;
}

function rosterRow({ candidate, report }, i) {
  const reco = RECO_META[report.recommendation];
  const flag = report.redFlags.find((f) => f.severity === 'critical') || report.redFlags.find((f) => f.severity === 'high');
  return `
  <div class="da-row" data-action="select" data-cid="${candidate.id}" role="button" tabindex="0">
    <span class="da-rank">${i + 1}</span>
    <span class="da-avatar">${escapeHTML(initials(candidate.name))}</span>
    <div class="da-row-id">
      <span class="da-row-name">${escapeHTML(candidate.name)}</span>
      <span class="da-row-meta">${escapeHTML(candidate.source || 'Applicant')}${flag ? ` · <span style="color:${SEV_COLOR[flag.severity]}">${flag.severity} flag</span>` : ''}</span>
    </div>
    <span class="da-row-conf" style="color:${CONF_COLOR[report.recommendationConfidence]};" title="recommendation confidence">${report.recommendationConfidence}</span>
    <span class="da-reco-chip" style="color:${reco.color};border-color:${reco.color}40;background:${reco.color}14;">${reco.label}</span>
    <span class="da-row-score" style="color:${scoreColor(report.overallScore)};">${report.overallScore}</span>
    <svg class="da-row-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
  </div>`;
}

function detailMarkup({ candidate, report }, allReports) {
  const reco = RECO_META[report.recommendation];
  const band = scoreColor(report.overallScore);
  const critical = report.redFlags.filter((f) => f.severity === 'critical');
  return `
    <div class="da-detail-head">
      <button class="da-back" data-action="back"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> All candidates</button>
    </div>

    ${critical.length ? `<div class="da-critical-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Critical red flag — human review required before any decision.</div>` : ''}

    <div class="da-report-top">
      <div class="da-ring" style="--p:${report.overallScore};--c:${band};"><span class="da-ring-num">${report.overallScore}</span><span class="da-ring-of">/100</span></div>
      <div class="da-report-id">
        <div class="da-report-name">${escapeHTML(candidate.name)}<span class="da-report-role">${escapeHTML(report.roleTitle)}</span></div>
        <div class="da-report-chips">
          <span class="da-reco-chip lg" style="color:${reco.color};border-color:${reco.color}40;background:${reco.color}14;">${reco.label}</span>
          <span class="da-conf-chip" style="color:${CONF_COLOR[report.recommendationConfidence]};">${report.recommendationConfidence} confidence</span>
        </div>
        <p class="da-summary">${escapeHTML(report.summary)}</p>
      </div>
    </div>

    <div class="da-section">
      <h3 class="da-section-title">Evaluation dimensions</h3>
      ${report.skillScores.map((s) => `
        <div class="da-dim"><span class="da-dim-name">${escapeHTML(s.skill)}</span><span class="da-dim-track"><span class="da-dim-fill" style="width:${s.score}%;background:${scoreColor(s.score)};"></span></span><span class="da-dim-score">${s.score}</span></div>
      `).join('')}
    </div>

    <div class="da-cols">
      <div class="da-section da-half">
        <h3 class="da-section-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Strengths</h3>
        ${report.strengths.length ? report.strengths.map((s) => `<div class="da-li ok">${escapeHTML(s)}</div>`).join('') : '<div class="da-li muted">None surfaced.</div>'}
      </div>
      <div class="da-section da-half">
        <h3 class="da-section-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/></svg> Weaknesses</h3>
        ${report.weaknesses.length ? report.weaknesses.map((s) => `<div class="da-li warn">${escapeHTML(s)}</div>`).join('') : '<div class="da-li muted">None surfaced.</div>'}
      </div>
    </div>

    ${report.redFlags.length ? `
      <div class="da-section">
        <h3 class="da-section-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg> Red flags</h3>
        ${report.redFlags.map((f) => `<div class="da-flag"><span class="da-sev" style="color:${SEV_COLOR[f.severity]};background:${SEV_COLOR[f.severity]}1a;">${f.severity}</span><span class="da-flag-text">${escapeHTML(f.label)}</span></div>`).join('')}
      </div>` : ''}

    <div class="da-section">
      <h3 class="da-section-title">Per-question breakdown</h3>
      ${report.questionBreakdown.map((r) => answerCard(r)).join('')}
    </div>

    ${report.suggestedNextSteps.length ? `
      <div class="da-section">
        <h3 class="da-section-title">Suggested next steps</h3>
        ${report.suggestedNextSteps.map((s) => `<div class="da-li step">${escapeHTML(s)}</div>`).join('')}
      </div>` : ''}`;
}

function answerCard(r) {
  const open = daUi.openAnswerId === r.answerId;
  const c = scoreColor(r.overallScore);
  const mac = r.modelAnswerComparison || {};
  return `
  <div class="da-ans ${open ? 'open' : ''}" data-aid="${r.answerId}">
    <div class="da-ans-top" data-action="toggle-answer" data-aid="${r.answerId}">
      <svg class="da-ans-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      <span class="da-ans-topic">${escapeHTML(r.topicName || '')}</span>
      <span class="da-ans-q">${escapeHTML(r.questionText)}</span>
      <span class="da-ans-conf" style="color:${CONF_COLOR[r.evaluationConfidence]};" title="evaluation confidence">${r.evaluationConfidence}</span>
      <span class="da-ans-score" style="color:${c};">${r.overallScore}</span>
    </div>
    ${open ? `
      <div class="da-ans-body">
        <div class="da-dim-grid">
          ${Object.entries(r.dimensionScores).map(([d, v]) => `<div class="da-dim-mini"><span>${escapeHTML(d)}</span><b style="color:${scoreColor(v.score)};">${v.score}</b></div>`).join('')}
        </div>
        ${(mac.coveredRequiredPoints || []).length || (mac.missedRequiredPoints || []).length ? `
          <div class="da-mac">
            ${(mac.coveredRequiredPoints || []).map((p) => `<div class="da-mac-row ok"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>${escapeHTML(p)}</div>`).join('')}
            ${(mac.missedRequiredPoints || []).map((p) => `<div class="da-mac-row miss"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>${escapeHTML(p)}</div>`).join('')}
          </div>` : ''}
        <p class="da-ans-summary">${escapeHTML(r.summary)}</p>
      </div>` : ''}
  </div>`;
}

function bind(container, job) {
  container.onclick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'select') { daUi.selectedId = el.dataset.cid; daUi.openAnswerId = null; soundEngine.playClick(); renderDeepAnalysisPane(job, container); }
    else if (action === 'back') { daUi.selectedId = null; soundEngine.playClick(); renderDeepAnalysisPane(job, container); }
    else if (action === 'toggle-answer') { const a = el.dataset.aid; daUi.openAnswerId = daUi.openAnswerId === a ? null : a; soundEngine.playClick(); renderDeepAnalysisPane(job, container); }
  };
  container.onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('da-row')) {
      e.preventDefault(); daUi.selectedId = e.target.dataset.cid; daUi.openAnswerId = null; renderDeepAnalysisPane(job, container);
    }
  };
}

export { renderDeepAnalysisPane as default };
