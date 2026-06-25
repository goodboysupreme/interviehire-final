// Deep Analysis — post-interview candidate intelligence. Renders the canonical
// CandidateReport contract (Aviral's evaluation engine; see memory:
// interviehire-eval-report-contract) as a master→detail view: a ranked roster
// of interviewed candidates, drilling into one full evaluation report.
// Until the eval pipeline is wired at stitch time, reports are sampled
// deterministically per candidate from the job's blueprint so the tab is live.

import { document } from './runtime';
import { escapeHTML } from './escape';
import { AppState } from './state';
import { filterCandidatesByDateRange } from './render-views';
import { soundEngine } from './sound';
import { isApiMode, apiFetchCandidateReport, apiFetchTestReport } from './api';
import type { Candidate, Job, CandidateReport, SkillScore, QuestionBreakdown, RedFlag } from '../types/models';

const DIMENSIONS = ['Correctness', 'Depth', 'Clarity', 'Communication', 'Role alignment'];

// The evaluation engine emits a different dimension set per question type
// (technical vs behavioral vs system_design vs coding …), so a mixed interview
// yields a long, uneven skillScores list of raw snake_case keys. We map keys to
// human labels, order by canonical priority (broadly-assessed core dimensions
// first), and cap the list with a toggle — faithful to the data, just legible.
const normKey = (k: any) => String(k || '').toLowerCase().replace(/\s+/g, '_');
const DIM_LABELS: Record<string, string> = {
  relevance: 'Relevance', correctness: 'Correctness', completeness: 'Completeness',
  depth: 'Depth', clarity: 'Clarity', communication: 'Communication', role_alignment: 'Role alignment',
  ownership: 'Ownership', impact: 'Impact', reflection: 'Reflection',
  requirements_understanding: 'Requirements', architecture: 'Architecture', tradeoffs: 'Trade-offs',
  scalability: 'Scalability', failure_handling: 'Failure handling',
  problem_framing: 'Problem framing', analysis_quality: 'Analysis quality',
  business_judgment: 'Business judgment', recommendation_quality: 'Recommendation',
  discovery_quality: 'Discovery', objection_handling: 'Objection handling',
  customer_empathy: 'Customer empathy', persuasion: 'Persuasion', structure: 'Structure',
  motivation: 'Motivation', professionalism: 'Professionalism', risk_flags: 'Risk flags',
  concept_coverage: 'Concept coverage', examples: 'Examples',
  problem_understanding: 'Problem understanding', algorithm_correctness: 'Algorithm correctness',
  edge_cases: 'Edge cases', complexity_analysis: 'Complexity analysis', code_quality: 'Code quality',
  addressed_followup: 'Follow-up handling', depth_expansion: 'Depth expansion',
  consistency: 'Consistency', adaptability: 'Adaptability',
};
// Cross-cutting dimensions lead; specialised per-type dimensions follow, ordered
// by how many answers actually scored them (set in dimensionsSection).
const DIM_PRIORITY = ['correctness', 'algorithm_correctness', 'completeness', 'concept_coverage',
  'depth', 'depth_expansion', 'clarity', 'communication', 'relevance', 'role_alignment'];
const DIM_CAP = 6;
function prettyDim(key: any) {
  const n = normKey(key);
  if (DIM_LABELS[n]) return DIM_LABELS[n];
  const s = n.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function dimPriority(key: any) { const i = DIM_PRIORITY.indexOf(normKey(key)); return i === -1 ? 99 : i; }

const RECO_META: Record<string, { label: string; color: string }> = {
  strong_proceed: { label: 'Strong proceed', color: '#2dd4bf' },
  proceed: { label: 'Proceed', color: '#34d399' },
  hold: { label: 'Hold', color: '#fbbf24' },
  reject: { label: 'Reject', color: '#f87171' },
  needs_human_review: { label: 'Needs review', color: '#fb923c' },
};
const SEV_COLOR: Record<string, string> = { low: '#9a9a9a', medium: '#fbbf24', high: '#fb923c', critical: '#f87171' };
const CONF_COLOR: Record<string, string> = { high: '#34d399', medium: '#fbbf24', low: '#f87171' };

function scoreColor(s: number) {
  if (s >= 88) return '#2dd4bf';
  if (s >= 72) return '#34d399';
  if (s >= 55) return '#fbbf24';
  return '#f87171';
}
const uniq = (a: any[]) => [...new Set((a || []).filter(Boolean))];

// Deterministic PRNG so each candidate's sampled report is stable across renders.
function rng(seedStr: string) {
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

export function buildSampleCandidateReport(candidate: Candidate, job: Job): CandidateReport {
  const rand = rng(candidate.id || candidate.name || 'seed');
  const anchor = Number.isFinite(candidate.interviewScore) ? (candidate.interviewScore as number) : Math.round(55 + rand() * 40);
  const vary = (base: number, spread: number) => Math.max(10, Math.min(100, Math.round(base + (rand() * 2 - 1) * spread)));

  const topics: any[] = (job.functionalParameters && job.functionalParameters.topics) || [];
  let items: any[] = topics.flatMap((t: any) => t.questions.map((q: any) => ({ q, topicName: t.name })));
  if (!items.length) items = GENERIC_Q.map((q) => ({ q, topicName: q.topic }));

  const questionBreakdown = items.map((item: any, i: number) => {
    const qScore = vary(anchor, 16);
    const reqs = (item.q.rubric?.requiredPoints || []).map((p: any) => p.description).filter(Boolean);
    const splitAt = Math.max(0, Math.round(reqs.length * (0.4 + rand() * 0.5)));
    const covered = reqs.slice(0, splitAt);
    const missed = reqs.slice(splitAt);
    // Seed per-dimension grounding so the evidence UI is demonstrable offline.
    // The real engine populates evidence[] with verbatim transcript quotes.
    const dimensionScores: Record<string, any> = {};
    DIMENSIONS.forEach((d, di) => {
      const dScore = vary(qScore, 12);
      const src = covered.length ? covered[(i + di) % covered.length] : null;
      dimensionScores[d] = {
        score: dScore,
        reason: `${d} graded on how the candidate handled the question's required points.`,
        evidence: src ? [`Candidate addressed “${src}”.`] : [],
        missing: dScore < 65 && missed.length ? [missed[di % missed.length]] : [],
      };
    });
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

  const overallScore = Math.round(questionBreakdown.reduce((a: number, r: any) => a + r.overallScore, 0) / questionBreakdown.length);
  const allFlags = questionBreakdown.flatMap((r: any) => r.redFlags);
  const hasCritical = allFlags.some((f: any) => f.severity === 'critical');
  const hasHigh = allFlags.some((f: any) => f.severity === 'high');
  let recommendation = overallScore >= 88 ? 'strong_proceed' : overallScore >= 72 ? 'proceed' : overallScore >= 55 ? 'hold' : 'reject';
  if (hasHigh && overallScore < 80) recommendation = 'hold';
  if (hasCritical) recommendation = 'needs_human_review';
  const lowR = questionBreakdown.filter((r: any) => r.evaluationConfidence === 'low').length / questionBreakdown.length;
  const highR = questionBreakdown.filter((r: any) => r.evaluationConfidence === 'high').length / questionBreakdown.length;
  const recommendationConfidence = lowR >= 0.35 ? 'low' : highR >= 0.6 ? 'high' : 'medium';

  const skillScores = DIMENSIONS.map((d) => ({
    skill: d,
    score: Math.round(questionBreakdown.reduce((a: number, r: any) => a + (r.dimensionScores[d]?.score || 0), 0) / questionBreakdown.length),
    evidenceAnswerIds: questionBreakdown.map((r: any) => r.answerId),
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
    strengths: uniq(questionBreakdown.flatMap((r: any) => r.strengths)).slice(0, 6),
    weaknesses: uniq(questionBreakdown.flatMap((r: any) => r.weaknesses)).slice(0, 6),
    redFlags: allFlags,
    skillScores,
    questionBreakdown,
    suggestedNextSteps: uniq(questionBreakdown.flatMap((r: any) => r.followUpRecommendations)).slice(0, 5),
    transcriptOnly: true,
  };
}

const daUi: {
  selectedId: string | null;
  openAnswerId: string | null;
  showAllDims: boolean;
  openDimKey: string | null;
  testOpen: boolean;
} = { selectedId: null, openAnswerId: null, showAllDims: false, openDimKey: null, testOpen: false };

// Live (api mode) report cache: candidateId -> { state:'loading'|'ready'|'pending'|'error', report?, error? }.
const liveReports = new Map<any, any>();

// "Run test interview" result cache: jobId -> { state:'loading'|'ready'|'none', report? }.
// Test interviews use a throwaway candidate that's excluded from the roster/funnel,
// so its report is fetched and shown separately, never added to AppState.candidates.
const testReports = new Map<any, any>();

// Render the job's test-interview result as a separate, collapsible card above the
// roster — additive only: it does not enter AppState.candidates, the roster, or the
// stat strip, so the funnel and analytics counts are unaffected.
function testInterviewSection(job: Job, container: HTMLElement) {
  const entry = testReports.get(job.id);
  if (!entry) {
    testReports.set(job.id, { state: 'loading' });
    apiFetchTestReport(job.id as string)
      .then((rep: any) => testReports.set(job.id, rep ? { state: 'ready', report: rep } : { state: 'none' }))
      .catch(() => testReports.set(job.id, { state: 'none' }))
      .finally(() => { if (AppState.activeJobId === job.id && !daUi.selectedId) renderDeepAnalysisPane(job, container); });
    return '';
  }
  if (entry.state !== 'ready') return '';
  const rep = entry.report;
  const band = scoreColor(rep.overallScore);
  const open = daUi.testOpen;
  return `
    <div class="da-test-card" style="border:1px solid rgba(129,140,248,.35);background:rgba(129,140,248,.06);border-radius:12px;margin:0 0 18px;overflow:hidden;">
      <div data-action="toggle-test" role="button" tabindex="0" style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;">
        <span style="font-size:10px;font-weight:700;letter-spacing:.06em;color:#a5b4fc;border:1px solid rgba(129,140,248,.4);border-radius:5px;padding:2px 6px;">TEST</span>
        <span style="font-weight:600;color:#e7e7ea;">Last test interview result</span>
        <span style="margin-left:auto;font-weight:700;color:${band};">${rep.overallScore}</span>
        <button data-action="refresh-test" title="Refresh test report" style="background:none;border:none;color:#9a9a9a;cursor:pointer;font-size:14px;padding:2px 4px;line-height:1;">↻</button>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9a9a9a" stroke-width="2" style="transform:rotate(${open ? 90 : 0}deg);transition:transform .15s;"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      ${open ? `<div style="padding:0 14px 14px;">${functionalReportBody(rep)}</div>` : ''}
    </div>`;
}

const hasFunctional = (c: Candidate) => c.interviewStatus === 'Completed' && Number.isFinite(c.interviewScore);
const hasResume = (c: Candidate) => !!c.resumeAnalysis || c.matchScore != null;
const hasScreening = (c: Candidate) => !!c.recruiterScreening || c.recruiterScreeningScore != null;

// Deep Analysis now holds ALL THREE result blocks per candidate (resume, screening,
// functional), so the roster includes anyone with at least one result — not just
// candidates who finished the interview (which left the tab empty pre-interview).
function rosterCandidates(job: Job): Candidate[] {
  return filterCandidatesByDateRange(AppState.candidates)
    .filter((c: Candidate) => (c.jobApplied === job.roleName || c.jobApplied === job.cardName) && (hasResume(c) || hasScreening(c) || hasFunctional(c)));
}

// One headline number per candidate: functional score if interviewed, else resume
// match, else screening score. Null when nothing numeric exists yet.
function headlineScore(c: Candidate): number | null {
  if (hasFunctional(c)) return Math.round(c.interviewScore as number);
  const m = (c.resumeAnalysis && c.resumeAnalysis.matchScore) ?? c.matchScore;
  if (Number.isFinite(m)) return Math.round(m as number);
  if (Number.isFinite(c.recruiterScreeningScore)) return Math.round(c.recruiterScreeningScore as number);
  return null;
}

function rosterEntry(c: Candidate) {
  const score = headlineScore(c);
  let recommendation = 'hold';
  if (hasFunctional(c)) recommendation = recoFromScore(score as number);
  else if (c.resumeAnalysis && c.resumeAnalysis.recommendation) {
    const r = c.resumeAnalysis.recommendation;
    recommendation = r === 'Advance' ? 'proceed' : r === 'Reject' ? 'reject' : 'hold';
  } else if (c.recruiterScreening) {
    recommendation = c.recruiterScreening === 'Good fit' ? 'proceed' : c.recruiterScreening === 'Poor fit' ? 'reject' : 'hold';
  }
  return { candidate: c, report: { overallScore: score, recommendation, recommendationConfidence: 'medium', redFlags: [], stages: { resume: hasResume(c), screening: hasScreening(c), functional: hasFunctional(c) } } };
}

const initials = (name: string | undefined) => (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function renderDeepAnalysisPane(job: Job, container: HTMLElement) {
  if (!job || !container) return;
  const apiLive = isApiMode() && !!job._backend;
  // The test-interview result renders above the roster (api mode only). It's fetched
  // and cached separately so it never affects the roster or the stat strip below.
  const testHTML = apiLive ? testInterviewSection(job, container) : '';
  const entries = rosterCandidates(job).map(rosterEntry)
    .sort((a, b) => (b.report.overallScore ?? -1) - (a.report.overallScore ?? -1));
  if (!entries.length) { container.innerHTML = `<div class="da-intel">${testHTML}${emptyState(apiLive)}</div>`; bind(container, job); return; }

  const selected = daUi.selectedId && entries.find((e) => e.candidate.id === daUi.selectedId);
  if (!selected) { container.innerHTML = `<div class="da-intel">${testHTML}${rosterMarkup(job, entries)}</div>`; bind(container, job); return; }
  renderDetail(job, container, selected.candidate);
}

// ── Live path (real backend) ──────────────────────────────────────────────────
const recoFromScore = (s: number) => (s >= 88 ? 'strong_proceed' : s >= 72 ? 'proceed' : s >= 55 ? 'hold' : 'reject');
// Detail: three stacked blocks. Resume + screening render synchronously off the
// candidate object; the functional block is sampled in local mode, or fetched live
// in api mode (loading → ready/pending/error) without blocking the other two.
function renderDetail(job: Job, container: HTMLElement, candidate: Candidate) {
  const apiLive = isApiMode() && !!job._backend;
  let functionalHTML;
  if (!hasFunctional(candidate)) {
    functionalHTML = `<div class="da-li muted">No functional interview completed yet.</div>`;
  } else if (!apiLive) {
    functionalHTML = functionalReportBody(buildSampleCandidateReport(candidate, job));
  } else {
    const entry = liveReports.get(candidate.id as string);
    if (!entry) {
      liveReports.set(candidate.id as string, { state: 'loading' });
      apiFetchCandidateReport(candidate.id as string)
        .then((rep: any) => liveReports.set(candidate.id as string, rep && Array.isArray(rep.questionBreakdown) ? { state: 'ready', report: rep } : { state: 'pending' }))
        .catch((e: any) => liveReports.set(candidate.id as string, { state: 'error', error: (e && e.message) || '' }))
        .finally(() => { if (daUi.selectedId === candidate.id && AppState.activeJobId === job.id) renderDeepAnalysisPane(job, container); });
      functionalHTML = functionalPending('loading');
    } else if (entry.state === 'ready') {
      functionalHTML = functionalReportBody(entry.report);
    } else {
      functionalHTML = functionalPending(entry.state, entry.error);
    }
  }
  container.innerHTML = `<div class="da-intel">${detailShell(candidate, functionalHTML)}</div>`;
  bind(container, job);
}

function functionalPending(state: string, error?: string) {
  const msg = state === 'loading'
    ? ['Loading evaluation…', 'Fetching this candidate’s interview report from the backend.']
    : state === 'error'
      ? ['Couldn’t load the report', error || 'The backend did not return an evaluation.']
      : ['Evaluation pending', 'This interview hasn’t been scored yet. Dimensions, rubric coverage, red flags and a recommendation appear here once the engine processes the transcript.'];
  return `<div class="da-pending ${state === 'loading' ? 'is-loading' : ''}"><div class="da-pending-state">${escapeHTML(msg[0])}</div><div class="da-pending-desc">${escapeHTML(msg[1])}</div></div>`;
}

function sectionEmpty(title: string, copy: string) {
  return `<div class="da-section"><h3 class="da-section-title">${escapeHTML(title)}</h3><div class="da-li muted">${escapeHTML(copy)}</div></div>`;
}

// Resume analysis block — match score + recommendation + evidenced strengths/gaps.
function resumeBlock(c: Candidate) {
  const a = c.resumeAnalysis;
  const score = (a && a.matchScore) ?? c.matchScore;
  if (!a && score == null) return sectionEmpty('Resume analysis', 'Not analysed yet — run resume analysis on this candidate to populate this block.');
  const reco = a && a.recommendation;
  const strengths = (a && a.strengths) || [];
  const gaps = (a && a.improvements) || [];
  const recoColor = reco === 'Advance' ? '#34d399' : reco === 'Reject' ? '#f87171' : '#fbbf24';
  return `
    <div class="da-section">
      <h3 class="da-section-title">Resume analysis${score != null ? `<span class="da-dim-count" style="color:${scoreColor(score)};">${Math.round(score)}</span>` : ''}${reco ? `<span class="da-reco-chip" style="color:${recoColor};border-color:${recoColor}40;background:${recoColor}14;">${escapeHTML(reco)}</span>` : ''}</h3>
      ${strengths.length || gaps.length ? `
        <div class="da-cols">
          <div class="da-section da-half"><h3 class="da-section-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Strengths</h3>${strengths.length ? strengths.slice(0, 3).map((s: string) => `<div class="da-li ok">${escapeHTML(s)}</div>`).join('') : '<div class="da-li muted">None surfaced.</div>'}</div>
          <div class="da-section da-half"><h3 class="da-section-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/></svg> Gaps</h3>${gaps.length ? gaps.slice(0, 3).map((s: string) => `<div class="da-li warn">${escapeHTML(s)}</div>`).join('') : '<div class="da-li muted">None surfaced.</div>'}</div>
        </div>` : '<div class="da-li muted">Analysis recorded — open the full report for the breakdown.</div>'}
    </div>`;
}

// Recruiter screening block — verdict + parameter match score + status.
function screeningBlock(c: Candidate) {
  const verdict = c.recruiterScreening;
  const score = c.recruiterScreeningScore;
  if (!verdict && score == null) return sectionEmpty('Recruiter screening', 'Not screened yet — results appear here once the candidate completes the screening stage.');
  const tone = verdict === 'Good fit' ? '#34d399' : verdict === 'Poor fit' ? '#f87171' : '#fbbf24';
  return `
    <div class="da-section">
      <h3 class="da-section-title">Recruiter screening${verdict ? `<span class="da-reco-chip" style="color:${tone};border-color:${tone}40;background:${tone}14;">${escapeHTML(verdict)}</span>` : ''}${score != null ? `<span class="da-dim-count" style="color:${scoreColor(score)};">${Math.round(score)}</span>` : ''}</h3>
      <div class="da-li">${score != null ? `Parameter match score ${Math.round(score)}/100` : 'Screening recorded'}${c.screeningStatus ? ` · status: ${escapeHTML(c.screeningStatus)}` : ''}.</div>
    </div>`;
}

function detailShell(candidate: Candidate, functionalHTML: string) {
  return `
    <div class="da-detail-head">
      <button class="da-back" data-action="back"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> All candidates</button>
      <button class="da-open-report" data-action="open-report" data-cid="${escapeHTML(candidate.id || undefined)}" style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#cfcfcf;border-radius:7px;padding:6px 11px;font-size:12px;cursor:pointer;">Open full report <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>
    </div>
    <div class="da-detail-id" style="display:flex;align-items:center;gap:12px;margin:14px 0 4px;">
      <span class="da-avatar" style="width:40px;height:40px;font-size:15px;">${escapeHTML(initials(candidate.name))}</span>
      <div>
        <div class="da-report-name">${escapeHTML(candidate.name)}</div>
        <div class="da-report-role">${escapeHTML(candidate.jobApplied || '')}</div>
      </div>
    </div>
    ${resumeBlock(candidate)}
    ${screeningBlock(candidate)}
    <div class="da-section">
      <h3 class="da-section-title">Functional interview</h3>
      ${functionalHTML}
    </div>`;
}

function emptyState(apiMode: boolean) {
  const desc = 'Run resume analysis, recruiter screening or the AI interview on a candidate and they appear here — each row holds all three result blocks, ranked by score, drilling into one full evaluation report.';
  return `
  <div class="da-empty">
    <div class="da-empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="11" x2="13" y2="11"/></svg></div>
    <p class="da-empty-title">No analysed candidates yet</p>
    <p class="da-empty-desc">${desc}</p>
  </div>`;
}

function rosterMarkup(job: Job, reports: any[]) {
  const dist: Record<string, number> = {};
  reports.forEach((r: any) => { dist[r.report.recommendation] = (dist[r.report.recommendation] || 0) + 1; });
  const scored = reports.map((r: any) => r.report.overallScore).filter((s: any) => Number.isFinite(s));
  const avg = scored.length ? Math.round(scored.reduce((a: number, s: number) => a + s, 0) / scored.length) : 0;
  const interviewed = reports.filter((r: any) => r.report.stages && r.report.stages.functional).length;

  return `
    <div class="da-roster-head">
      <div><h2 class="da-title">Candidate intelligence</h2><p class="da-sub">${reports.length} analysed candidate${reports.length !== 1 ? 's' : ''} · resume, screening &amp; interview · ranked by score</p></div>
    </div>
    <div class="da-stat-strip">
      <div class="da-stat"><span class="da-stat-num">${reports.length}</span><span class="da-stat-label">Candidates</span></div>
      <div class="da-stat"><span class="da-stat-num" style="color:${scoreColor(avg)};">${avg}</span><span class="da-stat-label">Avg score</span></div>
      <div class="da-stat"><span class="da-stat-num" style="color:#2dd4bf;">${(dist.strong_proceed || 0) + (dist.proceed || 0)}</span><span class="da-stat-label">Proceed</span></div>
      <div class="da-stat"><span class="da-stat-num" style="color:${interviewed ? '#34d399' : '#9a9a9a'};">${interviewed}</span><span class="da-stat-label">Interviewed</span></div>
    </div>
    <div class="da-roster">
      ${reports.map((r, i) => rosterRow(r, i)).join('')}
    </div>`;
}

function rosterRow({ candidate, report }: { candidate: Candidate; report: any }, i: number) {
  const reco = RECO_META[report.recommendation] || RECO_META.hold;
  const s = report.overallScore;
  const st = report.stages || {};
  const dot = (on: boolean, label: string) => `<span title="${label}${on ? '' : ' — pending'}" style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;font-size:10px;font-weight:700;background:${on ? 'rgba(45,212,191,.14)' : 'rgba(255,255,255,.04)'};color:${on ? '#2dd4bf' : '#6b6b6b'};border:1px solid ${on ? 'rgba(45,212,191,.35)' : 'rgba(255,255,255,.08)'};">${label[0]}</span>`;
  return `
  <div class="da-row" data-action="select" data-cid="${candidate.id}" role="button" tabindex="0">
    <span class="da-rank">${i + 1}</span>
    <span class="da-avatar">${escapeHTML(initials(candidate.name))}</span>
    <div class="da-row-id">
      <span class="da-row-name">${escapeHTML(candidate.name)}</span>
      <span class="da-row-meta">${escapeHTML(candidate.source || 'Applicant')}</span>
    </div>
    <span class="da-row-conf" title="Resume · Screening · Functional" style="display:inline-flex;gap:4px;">${dot(st.resume, 'Resume')}${dot(st.screening, 'Screening')}${dot(st.functional, 'Functional')}</span>
    <span class="da-reco-chip" style="color:${reco.color};border-color:${reco.color}40;background:${reco.color}14;">${reco.label}</span>
    <span class="da-row-score" style="color:${s != null ? scoreColor(s) : '#9a9a9a'};">${s != null ? s : '—'}</span>
    <svg class="da-row-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
  </div>`;
}

function functionalReportBody(report: any) {
  const reco = RECO_META[report.recommendation] || RECO_META.hold;
  const band = scoreColor(report.overallScore);
  const critical = (report.redFlags || []).filter((f: any) => f.severity === 'critical');
  return `
    ${critical.length ? `<div class="da-critical-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Critical red flag — human review required before any decision.</div>` : ''}

    <div class="da-report-top">
      <div class="da-ring" style="--p:${report.overallScore};--c:${band};"><span class="da-ring-num">${report.overallScore}</span><span class="da-ring-of">/100</span></div>
      <div class="da-report-id">
        <div class="da-report-name">Interview evaluation<span class="da-report-role">${escapeHTML(report.roleTitle || '')}</span></div>
        <div class="da-report-chips">
          <span class="da-reco-chip lg" style="color:${reco.color};border-color:${reco.color}40;background:${reco.color}14;">${reco.label}</span>
          <span class="da-conf-chip" style="color:${CONF_COLOR[report.recommendationConfidence]};">${report.recommendationConfidence} confidence</span>
        </div>
        <p class="da-summary">${escapeHTML(report.summary || '')}</p>
      </div>
    </div>

    ${dimensionsSection(report.skillScores)}

    <div class="da-cols">
      <div class="da-section da-half">
        <h3 class="da-section-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Strengths</h3>
        ${report.strengths.length ? report.strengths.map((s: any) => `<div class="da-li ok">${escapeHTML(s)}</div>`).join('') : '<div class="da-li muted">None surfaced.</div>'}
      </div>
      <div class="da-section da-half">
        <h3 class="da-section-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/></svg> Weaknesses</h3>
        ${report.weaknesses.length ? report.weaknesses.map((s: any) => `<div class="da-li warn">${escapeHTML(s)}</div>`).join('') : '<div class="da-li muted">None surfaced.</div>'}
      </div>
    </div>

    ${report.redFlags.length ? `
      <div class="da-section">
        <h3 class="da-section-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg> Red flags</h3>
        ${report.redFlags.map((f: any) => `<div class="da-flag"><span class="da-sev" style="color:${SEV_COLOR[f.severity]};background:${SEV_COLOR[f.severity]}1a;">${f.severity}</span><span class="da-flag-text">${escapeHTML(f.label)}</span></div>`).join('')}
      </div>` : ''}

    <div class="da-section">
      <h3 class="da-section-title">Per-question breakdown</h3>
      ${report.questionBreakdown.map((r: any) => answerCard(r)).join('')}
    </div>

    ${report.suggestedNextSteps.length ? `
      <div class="da-section">
        <h3 class="da-section-title">Suggested next steps</h3>
        ${report.suggestedNextSteps.map((s: any) => `<div class="da-li step">${escapeHTML(s)}</div>`).join('')}
      </div>` : ''}`;
}

// "Evaluation dimensions" — the engine can return 15+ raw dimensions across a
// mixed interview. Normalise labels, rank by priority then evidence breadth then
// score, and cap to DIM_CAP with a toggle so the list reads short and even.
function dimensionsSection(skillScores: any) {
  const dims = (skillScores || [])
    .filter((s: any) => s && Number.isFinite(s.score))
    .map((s: any) => ({ key: s.skill, label: prettyDim(s.skill), score: s.score, n: (s.evidenceAnswerIds || []).length }))
    .sort((a: any, b: any) => dimPriority(a.key) - dimPriority(b.key) || b.n - a.n || b.score - a.score);
  if (!dims.length) return '';

  const overflow = dims.length - DIM_CAP;
  const visible = daUi.showAllDims ? dims : dims.slice(0, DIM_CAP);
  const toggle = overflow > 0
    ? `<button class="da-dim-more" data-action="toggle-dims">${daUi.showAllDims ? 'Show fewer' : `Show all ${dims.length} dimensions`}</button>`
    : '';
  return `
    <div class="da-section">
      <h3 class="da-section-title">Evaluation dimensions<span class="da-dim-count">${dims.length}</span></h3>
      ${visible.map(dimRow).join('')}
      ${toggle}
    </div>`;
}

function dimRow(d: any) {
  const c = scoreColor(d.score);
  return `<div class="da-dim"><span class="da-dim-name" title="${escapeHTML(d.label)}">${escapeHTML(d.label)}</span><span class="da-dim-track"><span class="da-dim-fill" style="width:${d.score}%;background:${c};"></span></span><span class="da-dim-score" style="color:${c};">${d.score}</span></div>`;
}

function answerCard(r: any) {
  const open = daUi.openAnswerId === r.answerId;
  const c = scoreColor(r.overallScore);
  const mac = r.modelAnswerComparison || {};
  const dims = Object.entries(r.dimensionScores as Record<string, any>)
    .map(([d, v]) => ({
      key: d, label: prettyDim(d), score: v.score, reason: v.reason || '',
      evidence: (v.evidence || []).filter(Boolean), missing: (v.missing || []).filter(Boolean),
    }))
    .sort((a, b) => dimPriority(a.key) - dimPriority(b.key) || b.score - a.score);
  const openDim = daUi.openDimKey && daUi.openDimKey.indexOf(`${r.answerId}::`) === 0
    ? dims.find((d) => `${r.answerId}::${d.key}` === daUi.openDimKey) : null;
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
          ${dims.map((d) => {
    const grounded = d.evidence.length || d.reason || d.missing.length;
    const active = openDim && openDim.key === d.key;
    return `<div class="da-dim-mini${grounded ? ' grounded' : ''}${active ? ' active' : ''}"${grounded ? ` data-action="toggle-dim" data-aid="${r.answerId}" data-dim="${escapeHTML(d.key)}" role="button" tabindex="0" title="Show the evidence behind this score"` : ` title="${escapeHTML(d.label)}"`}>
              <span>${escapeHTML(d.label)}</span><b style="color:${scoreColor(d.score)};">${d.score}</b>${grounded ? '<svg class="da-dim-cue" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>' : ''}
            </div>`;
  }).join('')}
        </div>
        ${openDim ? dimEvidence(openDim) : ''}
        ${(mac.coveredRequiredPoints || []).length || (mac.missedRequiredPoints || []).length ? `
          <div class="da-mac">
            ${(mac.coveredRequiredPoints || []).map((p: any) => `<div class="da-mac-row ok"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>${escapeHTML(p)}</div>`).join('')}
            ${(mac.missedRequiredPoints || []).map((p: any) => `<div class="da-mac-row miss"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>${escapeHTML(p)}</div>`).join('')}
          </div>` : ''}
        <p class="da-ans-summary">${escapeHTML(r.summary)}</p>
      </div>` : ''}
  </div>`;
}

// Evidence panel for one dimension: the model's reason, the transcript quote(s)
// it cited, and any required point it found missing. This is the grounding that
// turns a bare score into something a recruiter can audit.
function dimEvidence(d: any) {
  const c = scoreColor(d.score);
  return `
  <div class="da-evidence">
    <div class="da-evidence-head"><span class="da-evidence-dim" style="border-color:${c}66;color:${c};">${escapeHTML(d.label)} · ${d.score}</span>${d.reason ? `<span class="da-evidence-reason">${escapeHTML(d.reason)}</span>` : ''}</div>
    ${d.evidence.map((q: any) => `<blockquote class="da-quote">${escapeHTML(q)}</blockquote>`).join('')}
    ${d.missing.map((m: any) => `<div class="da-mac-row miss"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>${escapeHTML(m)}</div>`).join('')}
    ${!d.evidence.length && !d.missing.length && !d.reason ? '<p class="da-evidence-empty">No transcript evidence was captured for this dimension.</p>' : ''}
  </div>`;
}

function bind(container: HTMLElement, job: Job) {
  container.onclick = (e) => {
    const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'select') { daUi.selectedId = el.dataset.cid as string; daUi.openAnswerId = null; daUi.openDimKey = null; daUi.showAllDims = false; soundEngine.playClick(); renderDeepAnalysisPane(job, container); }
    else if (action === 'back') { daUi.selectedId = null; daUi.openDimKey = null; daUi.showAllDims = false; soundEngine.playClick(); renderDeepAnalysisPane(job, container); }
    else if (action === 'open-report') { soundEngine.playClick(); const cid = el.dataset.cid as string; import('./report-page').then((m) => m.openCandidateReportPage && m.openCandidateReportPage(cid)); }
    else if (action === 'toggle-answer') { const a = el.dataset.aid as string; daUi.openAnswerId = daUi.openAnswerId === a ? null : a; daUi.openDimKey = null; soundEngine.playClick(); renderDeepAnalysisPane(job, container); }
    else if (action === 'toggle-test') { daUi.testOpen = !daUi.testOpen; soundEngine.playClick(); renderDeepAnalysisPane(job, container); }
    else if (action === 'refresh-test') { testReports.delete(job.id); soundEngine.playClick(); renderDeepAnalysisPane(job, container); }
    else if (action === 'toggle-dims') { daUi.showAllDims = !daUi.showAllDims; soundEngine.playClick(); renderDeepAnalysisPane(job, container); }
    else if (action === 'toggle-dim') { const k = `${el.dataset.aid}::${el.dataset.dim}`; daUi.openDimKey = daUi.openDimKey === k ? null : k; soundEngine.playClick(); renderDeepAnalysisPane(job, container); }
  };
  container.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target as HTMLElement;
    if (t.classList && t.classList.contains('da-row')) {
      e.preventDefault(); daUi.selectedId = t.dataset.cid as string; daUi.openAnswerId = null; daUi.openDimKey = null; daUi.showAllDims = false; renderDeepAnalysisPane(job, container);
    } else if (t.classList && t.classList.contains('da-dim-mini') && t.dataset.dim) {
      e.preventDefault(); const k = `${t.dataset.aid}::${t.dataset.dim}`; daUi.openDimKey = daUi.openDimKey === k ? null : k; renderDeepAnalysisPane(job, container);
    }
  };
}

export { renderDeepAnalysisPane as default };
