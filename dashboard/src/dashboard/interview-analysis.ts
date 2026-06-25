// interview-analysis.js
//
// Renders the job-detail "Interview Analysis" tab: a job-level listing of every
// candidate whose AI interview has been EVALUATED, with the score, recommendation
// and proctoring read from the report the engine generated and stored autonomously
// at interview end (see backend GET /jobs/{id}/interview-analysis). Opening a row
// jumps straight to the saved structured report (report-page.js, 'analysis' tab).
//
// Style mirrors the Screening/Functional stage tables (stage-table-container /
// stage-data-table) so the tab feels identical to the rest of the responses page.

import { document } from './runtime';
import { escapeHTML } from './escape';
import { AppState } from './state';
import { soundEngine } from './sound';
import { showPremiumToast } from './sourcing';
import { isApiMode, apiFetchInterviewAnalysis } from './api';
import { openCandidateReportPage } from './report-page';
import type { Job, Candidate } from '../types/models';

interface InterviewAnalysisRow {
  id?: string | null;
  name?: string;
  email?: string | null;
  status?: string;
  overallScore?: number | null;
  recommendation?: string | null;
  summary?: string;
  questionCount?: number;
  proctoringSeverity?: string | null;
  cheatProbability?: string | null;
  violationCount?: number;
  hasStructured?: boolean;
  reportUrl?: string | null;
  evaluatedAt?: string | null;
  source?: string | null;
}

// Cache the last fetched rows per job so re-renders (tab re-entry) are instant and
// the count pill can update without a refetch.
const analysisCache: Record<string, InterviewAnalysisRow[]> = {};

function scoreColor(score: number | null | undefined) {
  if (score == null) return '';
  if (score >= 80) return 'score-green';
  if (score >= 60) return 'score-yellow';
  return 'score-red';
}

function recommendationBadge(rec: string | null | undefined) {
  if (!rec) return '<span class="ia-rec ia-rec-na">—</span>';
  const key = String(rec).toUpperCase();
  const map: Record<string, { cls: string; label: string }> = {
    STRONG_YES: { cls: 'ia-rec-strong-yes', label: 'Strong Yes' },
    YES: { cls: 'ia-rec-yes', label: 'Yes' },
    HOLD: { cls: 'ia-rec-hold', label: 'Hold' },
    NO: { cls: 'ia-rec-no', label: 'No' },
    STRONG_NO: { cls: 'ia-rec-strong-no', label: 'Strong No' },
  };
  const m = map[key] || { cls: 'ia-rec-na', label: rec };
  return `<span class="ia-rec ${m.cls}">${escapeHTML(m.label)}</span>`;
}

function cheatBadge(prob: string | null | undefined) {
  if (!prob) return '—';
  const cls = prob === 'High' ? 'cheat-high' : prob === 'Medium' ? 'cheat-medium' : 'cheat-low';
  return `<span class="cheat-prob-badge ${cls}">${escapeHTML(prob)}</span>`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return '—'; }
}

// Local-mode fallback: derive a row set from candidates already in AppState that
// have an interview score (api mode is the real source via the backend endpoint).
function deriveLocalRows(job: Job): InterviewAnalysisRow[] {
  return ((AppState.candidates || []) as Candidate[])
    .filter(c => (c.jobId === job.id || c.jobApplied === job.roleName || c.jobApplied === job.cardName))
    .filter(c => c.interviewScore != null || c.interviewStatus === 'Completed')
    .map(c => ({
      id: c.id,
      name: c.name || '',
      email: c.email || '',
      status: 'EVALUATED',
      overallScore: c.interviewScore ?? null,
      recommendation: null,
      summary: '',
      questionCount: 0,
      proctoringSeverity: null,
      cheatProbability: c.cheatProbability || null,
      violationCount: 0,
      hasStructured: false,
      reportUrl: null,
      evaluatedAt: c.attemptedAt || null,
      source: c.source || null,
    }));
}

function emptyState(message: string) {
  return `
    <div class="jd-empty-pane">
      <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"></path></svg>
      <p>${escapeHTML(message)}</p>
    </div>`;
}

function tableHTML(rows: InterviewAnalysisRow[]) {
  return `
    <div class="ia-header">
      <div>
        <h3 class="ra-candidates-title">Interview Analysis</h3>
        <p class="ra-flow-redirect-copy">AI interview reports generated automatically at the end of each interview — score, recommendation, competency breakdown and proctoring, saved and ready to review.</p>
      </div>
      <span class="ia-count-tag">${rows.length} report${rows.length === 1 ? '' : 's'}</span>
    </div>
    <div class="stage-table-container">
      <table class="stage-data-table ia-table">
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Score <span class="sort-arrows">⇅</span></th>
            <th>Recommendation</th>
            <th>Questions</th>
            <th>Proctoring</th>
            <th>Evaluated</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr data-candidate-id="${escapeHTML(r.id as string)}">
              <td>
                <div class="table-candidate-cell">
                  <span class="cand-name-link ia-open" data-cand-id="${escapeHTML(r.id as string)}">${escapeHTML(r.name)} <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></span>
                  <span class="cand-email-sub">${escapeHTML(r.email as string)}</span>
                </div>
              </td>
              <td><span class="interview-score-dot ${scoreColor(r.overallScore)}"></span> ${r.overallScore != null ? Math.round(r.overallScore) : '—'}</td>
              <td>${recommendationBadge(r.recommendation)}</td>
              <td>${r.questionCount || '—'}</td>
              <td>${cheatBadge(r.cheatProbability)}${r.violationCount ? ` <span class="ia-violations">${r.violationCount} flag${r.violationCount === 1 ? '' : 's'}</span>` : ''}</td>
              <td>${fmtDate(r.evaluatedAt)}</td>
              <td><a href="#" class="report-link ia-open" data-cand-id="${escapeHTML(r.id as string)}">View Report <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function bindRows(container: HTMLElement) {
  container.querySelectorAll('.ia-open').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const candId = el.getAttribute('data-cand-id');
      if (!candId) return;
      soundEngine.playClick();
      // Open the saved structured report directly on its Interview Analysis tab.
      openCandidateReportPage(candId, 'analysis');
    });
  });
}

function setCountPill(n: number) {
  const pill = document.getElementById('jd-count-interviewanalysis');
  if (pill) pill.textContent = n as any;
}

// Public: render the Interview Analysis pane for a job into `container`.
// Fetches in api mode (with a loading state), falls back to AppState locally.
export async function renderInterviewAnalysisStage(job: Job, container: HTMLElement | null) {
  if (!container) return;

  const jobKey = job.id as string;

  if (!isApiMode()) {
    const rows = deriveLocalRows(job);
    analysisCache[jobKey] = rows;
    setCountPill(rows.length);
    container.innerHTML = rows.length
      ? tableHTML(rows)
      : emptyState('No interview reports yet. Reports appear here automatically once candidates complete their AI interview.');
    if (rows.length) bindRows(container);
    return;
  }

  // Show cached rows instantly if we have them, otherwise a loading shell.
  const cached = analysisCache[jobKey];
  if (cached) {
    setCountPill(cached.length);
    container.innerHTML = cached.length ? tableHTML(cached) : emptyState('No interview reports yet. Reports appear here automatically once candidates complete their AI interview.');
    if (cached.length) bindRows(container);
  } else {
    container.innerHTML = `<div class="ia-loading"><span class="ia-spinner"></span> Loading interview reports…</div>`;
  }

  let rows: InterviewAnalysisRow[];
  try {
    rows = await apiFetchInterviewAnalysis(job.id as string);
  } catch (err: any) {
    console.warn('Interview analysis fetch failed:', err);
    if (!cached) {
      container.innerHTML = emptyState('Could not load interview reports. Please try again.');
    }
    showPremiumToast(`Couldn't load interview reports: ${(err && err.message) || 'backend error'}`, 'error');
    return;
  }

  // Guard: the user may have switched tabs/jobs while the fetch was in flight.
  if (AppState.activeJobId !== job.id) { analysisCache[jobKey] = rows; return; }

  analysisCache[jobKey] = rows;
  setCountPill(rows.length);
  container.innerHTML = rows.length
    ? tableHTML(rows)
    : emptyState('No interview reports yet. Reports appear here automatically once candidates complete their AI interview.');
  if (rows.length) bindRows(container);
}
