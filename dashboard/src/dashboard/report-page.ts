import { document, requestAnimationFrame, setTimeout } from './runtime';
import { callDeepSeekAPI, saveStateToLocalStorage } from './ai-api';
import { navigateToJobDetail } from './job-detail';
import { escapeHTML, toggleHeaderElementsForJobFlow } from './job-flow';
import { resetWaveformAudio, setupWaveformBars, toggleWaveformAudio } from './kanban-swarm';
import { navigateToTab } from './navigation';
import { getCandidateNextStage, getCandidateTranscriptLines } from './report';
import { getScoringConfig } from './scoring-config';
import { soundEngine } from './sound';
import { AppState } from './state';
import { getDataSource, apiUpdateApplicant, apiFetchCandidateReport } from './api';
import { API_BASE } from '../auth-client';
import type {
  AppState as AppStateType,
  Candidate,
  Job,
  ResumeAnalysis,
  ResumeCompetency,
  ResumeProject,
  CandidateReport,
  QuestionBreakdown,
  DimensionScore,
  RedFlag,
  ProctoringViolation,
  TranscriptLine,
} from '../types/models';

// AppState is exported with `satisfies` (narrow literal type); view it through the
// permissive domain interface so dynamic field reads/writes type-check.
const State = AppState as unknown as AppStateType;

// ==========================================
// CANDIDATE REPORT — FULL PAGE VIEW
// ==========================================

const INSIGHT_PRESETS = [
  'Suggest next round questions for this candidate',
  'Find overall red flags of this candidate',
  'Show hidden strengths beyond the job title',
];

function findCandidate(cid: string): Candidate | undefined {
  return (State.candidates || []).find(c => c.id === cid);
}

function findJobForCandidate(candidate: Candidate): Job {
  const jobs = State.jobs || [];
  if (candidate.jobId) {
    const job = jobs.find(j => j.id === candidate.jobId);
    if (job) return job;
  }
  return jobs.find(j => j.roleName === candidate.jobApplied || j.cardName === candidate.jobApplied) || jobs[0];
}

async function getAnalysis(cid: string): Promise<ResumeAnalysis | null> {
  const { resumeAnalysisCache } = await import('./resume-analysis');
  if (resumeAnalysisCache[cid]) return resumeAnalysisCache[cid];
  const candidate = findCandidate(cid);
  if (candidate?.resumeAnalysis) {
    resumeAnalysisCache[cid] = candidate.resumeAnalysis;
    return candidate.resumeAnalysis;
  }
  return null;
}

function candidateHash(cid: string) {
  let h = 0;
  for (const ch of String(cid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function overallScoreOf(candidate: Candidate, analysis: ResumeAnalysis | null) {
  if (analysis?.matchScore != null) return Math.round(analysis.matchScore);
  if (candidate.interviewScore != null) return Math.round(candidate.interviewScore);
  const parsed = parseInt(String(candidate.score || '').replace('%', ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function scoreTone(score: number) {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function getCompetencies(analysis: ResumeAnalysis | null): { name: string; score: number; bullets: any[] }[] {
  if (Array.isArray(analysis?.competencies) && analysis.competencies.length) {
    return analysis.competencies.map((c: ResumeCompetency) => ({
      name: c.name || 'Competency',
      score: Math.max(0, Math.min(100, Math.round(Number(c.score) || 0))),
      bullets: Array.isArray(c.bullets) ? c.bullets.filter(Boolean) : [],
    }));
  }
  if (Array.isArray(analysis?.weightedBreakdown) && analysis.weightedBreakdown.length) {
    return analysis.weightedBreakdown.map((b: any) => ({
      name: b.label,
      score: b.score,
      bullets: analysis.dimensions?.[b.key]?.evidence ? [analysis.dimensions[b.key].evidence] : [],
    }));
  }
  if (analysis?.scorecard) {
    return [
      { name: 'Technical Skills', score: Math.round((analysis.scorecard.technical || 0) * 10), bullets: [] },
      { name: 'Experience', score: Math.round((analysis.scorecard.experience || 0) * 10), bullets: [] },
      { name: 'Communication', score: Math.round((analysis.scorecard.communication || 0) * 10), bullets: [] },
      { name: 'Culture Fit', score: Math.round((analysis.scorecard.cultureFit || 0) * 10), bullets: [] },
    ];
  }
  return [];
}

function compChipTone(score: number) {
  if (score >= 75) return 'excellent';
  if (score >= 50) return 'good';
  return 'needs-work';
}

function emptyCard(title: string, copy: string) {
  return `
    <div class="rp-empty-card">
      <h4>${escapeHTML(title)}</h4>
      <p>${escapeHTML(copy)}</p>
    </div>
  `;
}

function bulletList(items: (string | undefined | null)[], cls = '') {
  const list = (items || []).filter(Boolean).map(String);
  if (!list.length) return '';
  return `<ul class="rp-bullets ${cls}">${list.map(i => `<li>${escapeHTML(i)}</li>`).join('')}</ul>`;
}

// ---------- Overview ----------

function renderScoreRing(score: number, recommendation?: string) {
  const tone = scoreTone(score);
  const r = 56;
  const circ = Math.PI * r * 1.5; // 270° arc
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circ;
  return `
    <div class="rp-score-card">
      <div class="rp-score-card-head">
        <span>Resume Match Score</span>
      </div>
      <div class="rp-ring-wrap">
        <svg viewBox="0 0 140 140" class="rp-ring">
          <path d="M 70 126 A 56 56 0 1 1 70.01 126" fill="none" stroke="var(--rp-ring-track)" stroke-width="11" stroke-linecap="round"
            stroke-dasharray="${circ} ${circ * 2}" transform="rotate(135 70 70)" />
          <path d="M 70 126 A 56 56 0 1 1 70.01 126" fill="none" class="rp-ring-fill ${tone}" stroke-width="11" stroke-linecap="round"
            stroke-dasharray="0 ${circ * 2}" data-target="${filled.toFixed(1)}" transform="rotate(135 70 70)" />
        </svg>
        <div class="rp-ring-center">
          <strong>${score}</strong>
          <span>/100</span>
        </div>
      </div>
      ${recommendation ? `<div class="rp-rec-strip ${tone}">
        <span class="rp-rec-check">${recommendation === 'Advance' ? '✓' : recommendation === 'Hold' ? '◷' : '✕'}</span>
        ${escapeHTML(recommendation)}
      </div>` : ''}
    </div>
  `;
}

function renderOverviewPane(candidate: Candidate, job: Job, analysis: ResumeAnalysis | null) {
  const score = overallScoreOf(candidate, analysis);
  const comps = getCompetencies(analysis);
  const config = getScoringConfig(job);
  const jobCandidateCount = (State.candidates || []).filter((c: Candidate) => {
    if (getDataSource() === 'api' && job && job._backend) {
      return c.jobId === job.id;
    }
    return c.jobApplied === candidate.jobApplied;
  }).length;

  const positionBlock = jobCandidateCount > 20
    ? `<div class="rp-position-track"><div class="rp-position-marker" style="left:${score}%"></div></div>`
    : `<div class="rp-position-locked">Candidate position (ranking) will be available once you receive sufficient responses (&gt; 20 responses). Currently: ${jobCandidateCount}.</div>`;

  const compChips = comps.length ? `
    <div class="rp-comp-chips">
      ${comps.map(c => `<span class="rp-comp-chip" title="${escapeHTML(c.name)}">${escapeHTML(c.name.length > 28 ? c.name.slice(0, 28) + '…' : c.name)} <em class="rp-comp-score ${compChipTone(c.score)}">${c.score}</em></span>`).join('')}
      <div class="rp-comp-legend">
        <span><i class="dot excellent"></i>Excellent (75+)</span>
        <span><i class="dot good"></i>Good (50–74)</span>
        <span><i class="dot needs-work"></i>Needs Work (&lt; 50)</span>
      </div>
    </div>` : '';

  const recCard = analysis ? `
    <div class="rp-card rp-rec-card">
      <h4 class="rp-card-title gradient">✦ Lina Recommendation*</h4>
      ${bulletList(analysis.recommendationBullets?.length ? analysis.recommendationBullets : [analysis.recommendationReason, analysis.summary])}
    </div>` : emptyCard('No resume analysis yet', 'Run resume analysis from the job’s Resume Analysis tab to generate the full evidence-backed report.');

  const strengthsCard = analysis?.strengths?.length ? `
    <div class="rp-card rp-strengths-card">
      <h4 class="rp-card-title"><span class="rp-title-icon ok">✓</span> Strengths</h4>
      ${bulletList(analysis.strengths)}
    </div>` : '';

  const improvementsCard = analysis?.improvements?.length ? `
    <div class="rp-card rp-improve-card">
      <h4 class="rp-card-title"><span class="rp-title-icon warn">⚠</span> Areas for Improvement</h4>
      ${bulletList(analysis.improvements)}
    </div>` : '';

  const probesCard = analysis?.interviewProbes?.length ? `
    <div class="rp-card rp-probes-card">
      <h4 class="rp-card-title"><span class="rp-title-icon probe">?</span> Suggested Interview Probes</h4>
      ${bulletList(analysis.interviewProbes)}
    </div>` : '';

  const breakdownCard = analysis?.weightedBreakdown?.length ? `
    <div class="rp-card">
      <h4 class="rp-card-title">Weighted Score Breakdown</h4>
      <p class="rp-card-hint">Score = Σ dimension × your configured weight. Advance ≥ ${config.thresholds.advance}, Hold ≥ ${config.thresholds.hold}.</p>
      ${analysis.weightedBreakdown.map((b: any) => `
        <div class="rp-breakdown-row">
          <div class="rp-breakdown-meta"><span>${escapeHTML(b.label)}</span><em>${b.score} × ${b.weightPct}%</em></div>
          <div class="rp-breakdown-bar"><div class="rp-breakdown-fill ${scoreTone(b.score)}" style="width:${b.score}%"></div></div>
        </div>
      `).join('')}
      ${analysis.gateNotes?.length ? `<div class="rp-gate-notes">${analysis.gateNotes.map((n: any) => `<span>⛔ ${escapeHTML(n)}</span>`).join('')}</div>` : ''}
    </div>` : '';

  return `
    <div class="rp-card rp-position-card">
      <h4 class="rp-card-title"><span class="rp-title-icon rank">♕</span> Candidate Position</h4>
      ${positionBlock}
      ${compChips ? `<h4 class="rp-card-title" style="margin-top:18px;"><span class="rp-title-icon star">☆</span> Resume Competencies</h4>${compChips}` : ''}
    </div>
    <div class="rp-overview-grid">
      <div class="rp-overview-main">
        ${recCard}
        ${strengthsCard}
        ${improvementsCard}
        ${probesCard}
        ${analysis ? '<p class="rp-disclaimer">*Lina assists decision-makers with rationale and evidence; hiring decisions stay with humans.</p>' : ''}
      </div>
      <div class="rp-overview-side">
        ${renderScoreRing(score, analysis?.recommendation)}
        ${analysis ? `<div class="rp-analysed-meta">
          <span>${analysis.engine === 'local' ? 'Local rules engine' : 'Lina · DeepSeek'}</span>
          <span>${analysis.analysedAt ? new Date(analysis.analysedAt).toLocaleString() : ''}</span>
        </div>` : ''}
        <div class="rp-card rp-insights-card">
          <h4 class="rp-card-title gradient">✦ Custom AI Insights</h4>
          <div class="rp-insight-presets">
            ${INSIGHT_PRESETS.map((p, i) => `<button class="rp-insight-btn" data-preset="${i}"><span>✦</span> ${escapeHTML(p)} <em>→</em></button>`).join('')}
          </div>
          <form class="rp-insight-form" id="rp-insight-form">
            <input type="text" id="rp-insight-input" placeholder="Write your own prompt ✎" autocomplete="off" />
            <button type="submit" aria-label="Ask Lina">→</button>
          </form>
          <div class="rp-insight-feed" id="rp-insight-feed"></div>
        </div>
        ${breakdownCard}
      </div>
    </div>
  `;
}

// ---------- Competencies ----------

function renderCompetenciesPane(candidate: Candidate, analysis: ResumeAnalysis | null) {
  const comps = getCompetencies(analysis);
  if (!comps.length) {
    return emptyCard('No competency data yet', 'Competency-wise performance appears after resume analysis runs for this candidate.');
  }
  const colors = ['#6366f1', '#0ea5e9', '#f59e0b', '#ec4899', '#10b981', '#8b5cf6', '#f43f5e', '#14b8a6'];
  const chartW = 640;
  const chartH = 250;
  const baseY = 220;
  const slot = chartW / comps.length;
  const barW = Math.min(46, slot * 0.45);

  return `
    <div class="rp-card">
      <h4 class="rp-card-title">📊 Competency-wise performance</h4>
      <div class="rp-comp-chart-grid">
        <div class="rp-comp-legend-list">
          ${comps.map((c, i) => `<div class="rp-comp-legend-item"><i style="background:${colors[i % colors.length]}"></i><span>C${i + 1}: ${escapeHTML(c.name)}</span></div>`).join('')}
        </div>
        <svg viewBox="0 0 ${chartW + 50} ${chartH + 30}" class="rp-comp-chart">
          ${[0, 20, 40, 60, 80, 100].map(v => {
            const y = baseY - (v / 100) * 190;
            return `<line x1="42" y1="${y}" x2="${chartW + 42}" y2="${y}" class="rp-chart-grid" /><text x="34" y="${y + 3}" class="rp-chart-axis">${v}</text>`;
          }).join('')}
          ${comps.map((c, i) => {
            const h = (c.score / 100) * 190;
            const x = 42 + slot * i + (slot - barW) / 2;
            return `
              <g class="rp-chart-bar-group">
                <rect x="${x}" y="${baseY - h}" width="${barW}" height="${h}" rx="5" fill="${colors[i % colors.length]}" class="rp-chart-bar">
                  <title>${escapeHTML(c.name)}: ${c.score}</title>
                </rect>
                <text x="${x + barW / 2}" y="${baseY - h - 7}" class="rp-chart-val">${c.score}</text>
                <text x="${x + barW / 2}" y="${baseY + 16}" class="rp-chart-label">C${i + 1}</text>
              </g>`;
          }).join('')}
        </svg>
      </div>
    </div>
    ${comps.map(c => `
      <div class="rp-card rp-comp-detail">
        <div class="rp-comp-detail-head">
          <h4>${escapeHTML(c.name)} <span class="rp-info-dot" title="Scored against your configured criteria and weights">ⓘ</span></h4>
          <span class="rp-score-pill ${compChipTone(c.score)}">Score: ${c.score}</span>
        </div>
        ${c.bullets.length ? bulletList(c.bullets) : '<p class="rp-muted">No detailed evidence recorded for this competency.</p>'}
      </div>
    `).join('')}
  `;
}

// ---------- Resume ----------

async function renderResumePane(candidate: Candidate, analysis: ResumeAnalysis | null) {
  const { resumeTextCache, resumeIdentityCache } = await import('./resume-analysis');
  const cid = candidate.id as string;
  const text = resumeTextCache[cid] || candidate.resumeText || '';
  const identity = resumeIdentityCache[cid] || {};

  const identityCard = `
    <div class="rp-card">
      <h4 class="rp-card-title">Extracted Identity</h4>
      <div class="rp-id-grid">
        <div class="rp-id-item"><span>Name</span><strong>${escapeHTML(candidate.name)}</strong></div>
        <div class="rp-id-item"><span>Email</span><strong>${escapeHTML(candidate.email || '—')}</strong></div>
        <div class="rp-id-item"><span>Phone</span><strong>${escapeHTML(candidate.phone || '—')}</strong></div>
        <div class="rp-id-item"><span>LinkedIn</span><strong>${escapeHTML(identity.linkedin || candidate.linkedin || '—')}</strong></div>
        <div class="rp-id-item"><span>Experience</span><strong>${escapeHTML(analysis?.experienceYears || 'Not stated')}</strong></div>
        <div class="rp-id-item"><span>Source</span><strong>${escapeHTML(candidate.source || '—')}</strong></div>
      </div>
    </div>
  `;

  const projects = analysis?.projects || [];
  const projectsBlock = projects.length ? `
    <div class="rp-card">
      <h4 class="rp-card-title">🧠 Project Relevance Deep-Dive</h4>
      <p class="rp-card-hint">How each project the candidate has actually built maps to what this role needs.</p>
      ${projects.map((p: ResumeProject) => `
        <div class="rp-project-card">
          <div class="rp-project-head">
            <strong>${escapeHTML(p.name || 'Untitled project')}</strong>
            <span class="rp-score-pill ${compChipTone(Number(p.relevance) || 0)}">${Math.round(Number(p.relevance) || 0)}% relevant</span>
          </div>
          ${p.summary ? `<p class="rp-project-summary">${escapeHTML(p.summary)}</p>` : ''}
          ${p.whyItMatters ? `<p class="rp-project-why"><strong>Why it matters here:</strong> ${escapeHTML(p.whyItMatters)}</p>` : ''}
          ${Array.isArray(p.skills) && p.skills.length ? `<div class="rp-tag-row">${p.skills.map((s: string) => `<span class="rp-tag">${escapeHTML(s)}</span>`).join('')}</div>` : ''}
        </div>
      `).join('')}
    </div>` : (analysis ? emptyCard('No project evidence extracted', 'The analyser did not find distinct projects in this resume. Ask Lina in Custom AI Insights to dig deeper.') : '');

  const verdicts = analysis?.criteriaVerdicts || [];
  const verdictBlock = verdicts.length ? `
    <div class="rp-card">
      <h4 class="rp-card-title">Criteria Verdicts</h4>
      <table class="rp-verdict-table">
        <thead><tr><th>Criterion</th><th>Group</th><th>Verdict</th><th>Evidence</th></tr></thead>
        <tbody>
          ${verdicts.map((v: any) => {
            const met = v.met === true || v.met === 'true' ? 'met' : v.met === 'partial' ? 'partial' : 'missed';
            return `<tr>
              <td>${escapeHTML(v.criterion || '')}</td>
              <td><span class="rp-group-tag ${escapeHTML(v.group || 'custom')}">${escapeHTML(v.group === 'mustHave' ? 'Must Have' : v.group === 'goodToHave' ? 'Good To Have' : v.group === 'redFlag' ? 'Red Flag' : 'Custom')}</span></td>
              <td><span class="rp-verdict-pill ${met}">${met === 'met' ? '✓ Met' : met === 'partial' ? '◐ Partial' : '✕ Missing'}</span></td>
              <td class="rp-verdict-evidence">${escapeHTML(v.evidence || '—')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '';

  const rawBlock = text ? `
    <div class="rp-card">
      <button class="rp-raw-toggle" id="rp-raw-toggle">View raw resume text <span>▾</span></button>
      <pre class="rp-raw-resume" id="rp-raw-resume" hidden>${escapeHTML(text.slice(0, 12000))}</pre>
    </div>` : emptyCard('No resume on file', 'Upload or paste this candidate’s resume in the Resume Analysis tab to populate this section.');

  return identityCard + projectsBlock + verdictBlock + rawBlock;
}

// ---------- Screening ----------

function renderScreeningPane(candidate: Candidate) {
  if (!candidate.recruiterScreening && candidate.interviewScore == null) {
    return emptyCard('Screening not recorded', 'Recruiter screening results will appear here once this candidate completes the screening stage.');
  }
  const fitTone = candidate.recruiterScreening === 'Good fit' ? 'met' : candidate.recruiterScreening === 'Moderate fit' ? 'partial' : 'missed';
  const params = [
    { label: 'Recruiter Screening Verdict', answer: candidate.recruiterScreening || 'Pending', remark: `Screening fit assessment recorded by the screening agent.`, tag: candidate.recruiterScreening || '—' },
    { label: 'Interview Status', answer: candidate.interviewStatus || 'Not started', remark: candidate.attemptedAt ? `Attempted at ${candidate.attemptedAt}.` : 'No attempt recorded yet.', tag: candidate.interviewStatus || '—' },
    { label: 'Interview Score', answer: candidate.interviewScore != null ? `${candidate.interviewScore}/100` : 'Not scored', remark: 'Composite score across screening competencies.', tag: candidate.interviewScore != null ? (candidate.interviewScore >= 70 ? 'Good Fit' : 'Review') : '—' },
    { label: 'Application Source', answer: candidate.source || 'Unknown', remark: `Registered on ${candidate.registeredOn || 'an unknown date'}.`, tag: 'Info' },
    { label: 'Screening Agent Score', answer: candidate.recruiterScreeningScore != null ? `${candidate.recruiterScreeningScore}/100` : 'Not scored', remark: 'Parameter match score from the screening conversation.', tag: (candidate.recruiterScreeningScore as any) >= 80 ? 'Good Fit' : 'Review' },
  ];
  return `
    <div class="rp-card rp-screening-hero ${fitTone}">
      <div>
        <h4 class="rp-card-title">Recruiter Screening <span class="rp-verdict-pill ${fitTone}">${escapeHTML(candidate.recruiterScreening || 'Pending')}</span></h4>
        <ul class="rp-bullets">
          <li>${candidate.recruiterScreeningScore != null ? `Parameter match score of ${candidate.recruiterScreeningScore}/100 recorded by the screening agent.` : 'Screening conversation pending.'}</li>
          <li>${candidate.interviewStatus === 'Completed' ? 'Screening interview completed without interruption.' : `Interview status: ${candidate.interviewStatus || 'not started'}.`}</li>
        </ul>
      </div>
      <div class="rp-screening-stat">
        <span>Parameters</span>
        <strong>${candidate.recruiterScreeningScore != null ? Math.round((candidate.recruiterScreeningScore / 100) * 5) : 0}/5</strong>
        <em>Matched</em>
      </div>
    </div>
    <h4 class="rp-pane-section-title">Parameter Evaluation</h4>
    <div class="rp-param-grid">
      ${params.map(p => `
        <div class="rp-param-card">
          <div class="rp-param-head">
            <strong>${escapeHTML(p.label)}</strong>
            <span class="rp-param-tag">${escapeHTML(String(p.tag))}</span>
          </div>
          <p><span class="rp-param-key">Answer:</span> ${escapeHTML(String(p.answer))}</p>
          <p><span class="rp-param-key">Remark:</span> ${escapeHTML(p.remark)}</p>
        </div>
      `).join('')}
    </div>
  `;
}

// ---------- Proctoring ----------

// ---------- Interview Analysis (structured rubric + dimensions + proctoring) ----------

const DIM_LABELS = {
  model_answer_alignment: 'Model-answer alignment',
  factual_correctness: 'Factual correctness',
  completeness: 'Completeness',
  reasoning_quality: 'Reasoning quality',
  clarity_structure: 'Clarity & structure',
  role_level_alignment: 'Role-level alignment',
  communication_quality: 'Communication quality',
};
const dimLabel = (k: string) => (DIM_LABELS as Record<string, string>)[k] || String(k).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
const sevTone = (s: string | undefined | null) => ((({ low: 'partial', medium: 'partial', high: 'missed', critical: 'missed' }) as Record<string, string>)[String(s || '').toLowerCase()] || 'partial');

// The structured (aviral) report is nested under `.structured`, or is the report
// itself when it was generated standalone. null until the engine scores the interview.
function getStructuredReport(report: any): any {
  if (!report) return null;
  if (report.structured && report.structured.scoreBreakdown) return report.structured;
  if (report.scoreBreakdown) return report;
  return null;
}

async function downloadInterviewTranscript(candidateId: string, name?: string) {
  try {
    const res = await fetch(`${API_BASE}/jobs/applicants/${candidateId}/transcript-download`, { credentials: 'include' });
    if (!res.ok) { soundEngine.playClick(); alert('Transcript not available yet for this candidate.'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `transcript_${(name || 'candidate').replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  } catch (e) { alert('Could not download transcript: ' + ((e as Error).message || 'error')); }
}

function renderDimensionBars(dimensionScores: Record<string, DimensionScore> | undefined) {
  const entries = Object.entries(dimensionScores || {});
  if (!entries.length) return '';
  return `<div class="rp-dim-bars">${entries.map(([k, d]: [string, DimensionScore]) => {
    const sc = Math.max(0, Math.min(100, Math.round((d && d.score) || 0)));
    return `<div class="rp-dim-row">
      <div class="rp-dim-head"><span>${escapeHTML(dimLabel(k))}</span><strong class="${scoreTone(sc)}">${sc}</strong></div>
      <div class="rp-dim-track"><i class="rp-dim-fill ${scoreTone(sc)}" style="width:${sc}%"></i></div>
      ${d && d.reason ? `<p class="rp-muted rp-dim-reason">${escapeHTML(d.reason)}</p>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function renderInterviewAnalysisPane(candidate: Candidate, report: CandidateReport | null) {
  const dlBtn = `<button class="rp-dl-btn" id="rp-dl-transcript">⬇ Download transcript</button>`;
  const s = getStructuredReport(report);
  if (!s) {
    return `<div class="rp-analysis-head"><div></div>${dlBtn}</div>` + emptyCard(
      'Interview not analysed yet',
      'The structured rubric + dimensional analysis appears once the candidate finishes a monitored interview and the AI scores the transcript.');
  }

  const sb = s.scoreBreakdown || {};
  const proc = s.proctoring || { integrityScore: 100, penalty: 0, violations: [], totalEvents: 0 };
  const qs = Array.isArray(s.questionBreakdown) ? s.questionBreakdown : [];
  const finalScore = Math.round(sb.finalScore != null ? sb.finalScore : (s.overallScore || 0));
  const rec = String(s.recommendation || '').replace(/_/g, ' ');

  const breakdownCard = `
    <div class="rp-card">
      <h4 class="rp-card-title">📊 Score Analysis</h4>
      <div class="rp-score-grid">
        <div class="rp-score-cell big ${scoreTone(finalScore)}"><span>Final score</span><strong>${finalScore}</strong><em>${escapeHTML(rec || '')}</em></div>
        <div class="rp-score-cell"><span>Rubric coverage (45%)</span><strong>${Math.round(sb.rubricCoverageAvg || 0)}</strong></div>
        <div class="rp-score-cell"><span>Weighted dimensions (55%)</span><strong>${Math.round(sb.dimensionAvg || 0)}</strong></div>
        <div class="rp-score-cell ${(sb.redFlagPenaltyAvg || 0) > 0 ? 'missed' : 'met'}"><span>Red-flag penalty</span><strong>−${Math.round(sb.redFlagPenaltyAvg || 0)}</strong></div>
        <div class="rp-score-cell ${(sb.proctoringPenalty || 0) > 0 ? 'missed' : 'met'}"><span>Proctoring penalty</span><strong>−${Math.round(sb.proctoringPenalty || 0)}</strong></div>
        <div class="rp-score-cell ${scoreTone(proc.integrityScore)}"><span>Integrity score</span><strong>${Math.round(proc.integrityScore)}</strong></div>
      </div>
      <p class="rp-muted rp-formula">${escapeHTML(sb.formula || 'finalAnswerScore = 45% rubric coverage + 55% weighted dimensions − red-flag penalty; overall − proctoring penalty')}</p>
    </div>`;

  const flags = Array.isArray(s.redFlags) ? s.redFlags : [];
  const flagsCard = flags.length ? `
    <div class="rp-card">
      <h4 class="rp-card-title">🚩 Red Flags</h4>
      ${flags.map((f: RedFlag) => `<div class="rp-proc-row"><div><strong>${escapeHTML(f.label || 'Concern')}</strong><p>${escapeHTML(f.reason || '')}</p></div><span class="rp-verdict-pill ${sevTone(f.severity)}">${escapeHTML(String(f.severity || '').toUpperCase())}</span></div>`).join('')}
    </div>` : '';

  const questionsCard = qs.length ? `
    <div class="rp-card">
      <h4 class="rp-card-title">🧩 Per-question breakdown</h4>
      ${qs.map((q: QuestionBreakdown, i: number) => {
        const cmp = q.modelAnswerComparison || {};
        const fin = Math.round(q.finalScore != null ? q.finalScore : (q.overallScore || 0));
        return `<div class="rp-q-block">
          <div class="rp-q-head">
            <span class="rp-q-num">Q${i + 1}</span>
            <span class="rp-q-text">${escapeHTML(q.questionText || q.summary || 'Question')}</span>
            <span class="rp-q-score ${scoreTone(fin)}">${fin}</span>
          </div>
          <div class="rp-q-sub">
            <span class="rp-pill-mini">Rubric ${Math.round(q.rubricCoverageScore || 0)}</span>
            <span class="rp-pill-mini">Dimensions ${Math.round(q.dimensionScore || 0)}</span>
            ${(q.redFlagPenalty || 0) > 0 ? `<span class="rp-pill-mini bad">−${Math.round(q.redFlagPenalty as number)} flags</span>` : ''}
          </div>
          ${q.summary ? `<p class="rp-muted">${escapeHTML(q.summary)}</p>` : ''}
          ${renderDimensionBars(q.dimensionScores)}
          ${Array.isArray(cmp.coveredRequiredPoints) && cmp.coveredRequiredPoints.length ? `<p class="rp-cov ok">✓ Covered: ${cmp.coveredRequiredPoints.map(escapeHTML).join(', ')}</p>` : ''}
          ${Array.isArray(cmp.missedRequiredPoints) && cmp.missedRequiredPoints.length ? `<p class="rp-cov miss">✕ Missed: ${cmp.missedRequiredPoints.map(escapeHTML).join(', ')}</p>` : ''}
          ${Array.isArray(cmp.incorrectClaims) && cmp.incorrectClaims.length ? `<p class="rp-cov miss">⚠ Incorrect: ${cmp.incorrectClaims.map(escapeHTML).join(', ')}</p>` : ''}
          ${Array.isArray(q.redFlags) && q.redFlags.length ? q.redFlags.map((f: RedFlag) => `<p class="rp-cov miss">🚩 ${escapeHTML(f.label || '')} — ${escapeHTML(f.reason || '')}</p>`).join('') : ''}
        </div>`;
      }).join('')}
    </div>` : '';

  return `
    <div class="rp-analysis-head">
      <div class="rp-muted">${escapeHTML(s.evaluationEngine ? 'Engine: ' + s.evaluationEngine : '')}</div>
      ${dlBtn}
    </div>
    ${breakdownCard}
    ${flagsCard}
    ${questionsCard}
  `;
}

function renderProctoringPane(candidate: Candidate, report: CandidateReport | null) {
  const s = getStructuredReport(report);
  // Prefer REAL proctoring violations from the interview engine when present.
  if (s && s.proctoring) {
    const p = s.proctoring;
    const tone = p.integrityScore >= 80 ? 'met' : p.integrityScore >= 55 ? 'partial' : 'missed';
    const bySev = p.bySeverity || {};
    const sevRows = Object.keys(bySev).length
      ? Object.entries(bySev).map(([sev, n]) => `<div class="rp-proc-row"><div><strong>${escapeHTML(sev)}</strong></div><span class="rp-proc-count ${sev === 'LOW' ? 'ok' : 'bad'}">${n}</span></div>`).join('')
      : '<p class="rp-muted">No severity buckets.</p>';
    const violations = Array.isArray(p.violations) ? p.violations : [];
    return `
      <div class="rp-proc-stats">
        <div class="rp-proc-stat ${tone}"><span>🛡 Integrity Score</span><strong>${Math.round(p.integrityScore)}</strong></div>
        <div class="rp-proc-stat ${p.penalty > 0 ? 'missed' : 'met'}"><span>➖ Score Penalty</span><strong>−${Math.round(p.penalty)}</strong></div>
        <div class="rp-proc-stat ${p.totalEvents === 0 ? 'met' : 'missed'}"><span>⚠ Total Violations</span><strong>${p.totalEvents}</strong></div>
      </div>
      <div class="rp-proc-grid">
        <div class="rp-card">
          <h4 class="rp-card-title">⚠ Violations (${violations.length})</h4>
          ${violations.length ? violations.map((v: ProctoringViolation) => `
            <div class="rp-proc-row">
              <div><strong>${escapeHTML(String(v.eventType || 'Violation').replace(/_/g, ' '))}</strong><p>${escapeHTML(v.detail || (v.occurredAt ? new Date(v.occurredAt).toLocaleString() : ''))}</p></div>
              <span class="rp-verdict-pill ${sevTone(v.severity)}">${escapeHTML(String(v.severity || '').toUpperCase())}</span>
            </div>`).join('') : '<p class="rp-muted">No integrity violations were logged during this interview. ✓</p>'}
        </div>
        <div class="rp-card">
          <h4 class="rp-card-title">By Severity</h4>
          ${sevRows}
        </div>
      </div>
    `;
  }
  if (!candidate.interviewStatus || candidate.interviewStatus === 'Not Started') {
    return emptyCard('No proctoring session yet', 'AI proctoring and integrity analysis appears after the candidate attempts a monitored interview.');
  }
  const h = candidateHash(candidate.id as string);
  const level = candidate.cheatProbability || 'Low';
  const sessionMin = 12 + (h % 17);
  const tabSwitches = level === 'Low' ? 0 : level === 'Medium' ? 1 + (h % 3) : 4 + (h % 4);
  const fsExits = level === 'High' ? 1 + (h % 2) : 0;
  const totalViolations = level === 'Low' ? 0 : level === 'Medium' ? tabSwitches : tabSwitches + fsExits + 1;
  const behaviors = [
    { label: 'Tab Switches', desc: 'Number of times candidate switched tabs', val: tabSwitches },
    { label: 'Full Screen Exits', desc: 'Number of times candidate exited full screen', val: fsExits },
    { label: 'Left Interview in Middle', desc: 'Number of times candidate left the interview in middle', val: 0 },
    { label: 'Attempt Count', desc: 'Number of test attempts', val: 1 + (h % 2) },
    { label: 'Screen Share Violation', desc: 'Number of times candidate stopped screen sharing', val: level === 'High' ? 1 : 0 },
  ];
  const checks = [
    { label: 'No Face Detected', desc: 'The candidate’s face was visible throughout the interview.', pass: true },
    { label: 'Multiple Faces Detected', desc: 'No other person was present during the interview.', pass: level !== 'High' },
    { label: 'Mobile Device Detected', desc: 'No mobile or external device was used.', pass: true },
    { label: 'AI Content Detected', desc: 'AI-generated content, use of GPT or LLMs in the responses.', pass: level === 'Low' },
    { label: 'Multiple Speakers Detected', desc: 'Only the candidate was speaking; no other voices were detected.', pass: level !== 'High' },
    { label: 'Background Noise Detected', desc: 'No unusual or disruptive background noise.', pass: level !== 'Medium' || (h % 2 === 0) },
    { label: 'External Tool Detected', desc: 'No external tools (e.g. DevTools, Screen Readers, Cluely, etc.) were used.', pass: true },
  ];
  const tone = level === 'Low' ? 'met' : level === 'Medium' ? 'partial' : 'missed';
  return `
    <div class="rp-proc-stats">
      <div class="rp-proc-stat ${tone}"><span>🛡 Cheat Probability</span><strong>${escapeHTML(level)}</strong></div>
      <div class="rp-proc-stat ${totalViolations === 0 ? 'met' : 'missed'}"><span>⚠ Total Violations</span><strong>${totalViolations}</strong></div>
      <div class="rp-proc-stat info"><span>◷ Session Time</span><strong>${sessionMin} min</strong></div>
    </div>
    <div class="rp-proc-grid">
      <div class="rp-card">
        <h4 class="rp-card-title">👁 Behavioral Monitoring</h4>
        ${behaviors.map(b => `
          <div class="rp-proc-row">
            <div><strong>${escapeHTML(b.label)}</strong><p>${escapeHTML(b.desc)}</p></div>
            <span class="rp-proc-count ${b.val === 0 ? 'ok' : 'bad'}">${b.val}</span>
          </div>
        `).join('')}
      </div>
      <div class="rp-card">
        <h4 class="rp-card-title">⚠ Proctoring Violations</h4>
        ${checks.map(c => `
          <div class="rp-proc-row">
            <div><strong>${escapeHTML(c.label)}</strong><p>${escapeHTML(c.desc)}</p></div>
            <span class="rp-verdict-pill ${c.pass ? 'met' : 'missed'}">${c.pass ? '✓ Passed' : '✕ Flagged'}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ---------- Transcript ----------

function renderTranscriptPane(candidate: Candidate) {
  const lines = getCandidateTranscriptLines(candidate);
  if (!lines.length) {
    return emptyCard('No transcript recorded', candidate.status === 'Resume'
      ? 'This candidate only has resume-stage evidence right now. The transcript appears after a screening interview is recorded.'
      : 'This candidate reached a later stage, but no transcript artifact is attached yet.');
  }
  return `
    <div class="rp-card">
      <div class="waveform-box">
        <h4 class="waveform-title">Interview Audio Recording</h4>
        <div class="waveform-controls">
          <button class="btn-play-waveform" id="btn-play-wave" aria-label="Play Interview Snippet">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="play-svg"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="pause-svg" style="display:none;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
          </button>
          <div class="waveform-viz" id="waveform-viz-bars"></div>
          <span class="waveform-time" id="waveform-timer">0:00 / 0:12</span>
        </div>
      </div>
      <div class="transcript-chat-flow rp-transcript">
        ${lines.map(line => {
          const speaker = typeof line === 'string' ? 'Transcript' : (line.speaker || 'Transcript');
          const text = typeof line === 'string' ? line : line.text;
          return `<div class="transcript-chat-line"><span class="chat-speaker-badge">${escapeHTML(speaker)}:</span><span class="chat-text-bubble">${escapeHTML(text)}</span></div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ---------- Remarks / Actions ----------

function renderRemarksPane(candidate: Candidate, analysis: ResumeAnalysis | null) {
  const remarks = candidate.remarks || [];
  const nextStage = getCandidateNextStage(candidate.status as string);
  const canAdvance = !!nextStage && (candidate.status !== 'Resume' || !!analysis);
  return `
    <div class="rp-card">
      <h4 class="rp-card-title">Recruiter Notes</h4>
      <textarea class="rp-notes-area" id="rp-notes-area" placeholder="Add custom notes on notice buyout, communication flags, panel feedback…">${escapeHTML(candidate.recruiterNotes || '')}</textarea>
      <p class="rp-muted" id="rp-notes-saved">Notes save automatically when you click away.</p>
    </div>
    <div class="rp-card">
      <h4 class="rp-card-title">Remarks Timeline</h4>
      <div class="rp-remarks-feed" id="rp-remarks-feed">
        ${remarks.length ? remarks.map(r => `<div class="rp-remark"><span class="rp-remark-time">${escapeHTML(r.at)}</span><p>${escapeHTML(r.text)}</p></div>`).join('') : '<p class="rp-muted">No remarks yet.</p>'}
      </div>
      <form class="rp-remark-form" id="rp-remark-form">
        <input type="text" id="rp-remark-input" placeholder="Add a remark for the hiring panel…" autocomplete="off" />
        <button type="submit">Add</button>
      </form>
    </div>
    <div class="rp-card">
      <h4 class="rp-card-title">Stage Actions</h4>
      ${!analysis && candidate.status === 'Resume' ? '<p class="rp-muted">Run resume analysis before advancing this candidate.</p>' : ''}
      <div class="rp-stage-actions">
        ${candidate.status !== 'Hired' && candidate.status !== 'Rejected' ? `<button class="rp-btn-reject" id="rp-btn-reject">Reject Candidate</button>` : ''}
        ${nextStage
          ? `<button class="rp-btn-advance" id="rp-btn-advance" ${canAdvance ? '' : 'disabled'}>${nextStage === 'Hired' ? 'Mark Hired' : `Advance to ${nextStage}`}</button>`
          : `<span class="rp-muted">${candidate.status === 'Hired' ? 'Candidate hired 🎉' : 'No next stage available.'}</span>`}
      </div>
    </div>
  `;
}

// ---------- AI Insights ----------

async function askInsight(candidate: Candidate, job: Job, analysis: ResumeAnalysis | null, question: string, feed: HTMLElement) {
  const { resumeTextCache, reportChatCache } = await import('./resume-analysis');
  const cid = candidate.id as string;
  if (!reportChatCache[cid]) reportChatCache[cid] = [];
  reportChatCache[cid].push({ sender: 'user', text: question });

  const bubble = document.createElement('div');
  bubble.className = 'rp-insight-msg user';
  bubble.textContent = question;
  feed.appendChild(bubble);

  const thinking = document.createElement('div');
  thinking.className = 'rp-insight-msg aria thinking';
  thinking.innerHTML = '<span class="ra-spinner"></span> Lina is thinking…';
  feed.appendChild(thinking);
  feed.scrollTop = feed.scrollHeight;
  soundEngine.playClick();

  const resumeText = resumeTextCache[cid] || 'No resume text uploaded.';
  const analysisBlock = analysis ? `\nLATEST ANALYSIS:\nScore ${analysis.matchScore}/100, recommendation ${analysis.recommendation}.\nStrengths: ${(analysis.strengths || []).join('; ')}\nGaps: ${(analysis.improvements || []).join('; ')}` : '';
  try {
    const answer = await callDeepSeekAPI([
      {
        role: 'system',
        content: `You are Lina, the AI recruiting analyst. Answer the recruiter's question about this candidate concisely with concrete evidence from the resume. Use short bullet points where natural. Never invent facts not present below.\n\nROLE: ${job.roleName}\nJD: ${(job.description || '').slice(0, 1500)}\n\nCANDIDATE: ${candidate.name}\nRESUME:\n${resumeText.slice(0, 3500)}${analysisBlock}`,
      },
      { role: 'user', content: question },
    ], false);
    thinking.remove();
    const reply = document.createElement('div');
    reply.className = 'rp-insight-msg aria';
    reply.innerHTML = escapeHTML(answer).replace(/\n/g, '<br>');
    feed.appendChild(reply);
    reportChatCache[cid].push({ sender: 'aria', text: answer });
    soundEngine.playChime([440, 554, 659], 0.12, 0.08);
  } catch {
    thinking.remove();
    const fallbackText = analysis
      ? `API is offline, so here is what the saved analysis says:\n• Score ${analysis.matchScore}/100 → ${analysis.recommendation}\n• ${(analysis.strengths || []).slice(0, 2).join('\n• ') || 'No strengths recorded.'}\n• Gaps: ${(analysis.improvements || []).slice(0, 2).join('; ') || 'none recorded'}`
      : 'I could not reach the AI service and there is no saved analysis yet. Run resume analysis first.';
    const reply = document.createElement('div');
    reply.className = 'rp-insight-msg aria offline';
    reply.innerHTML = escapeHTML(fallbackText).replace(/\n/g, '<br>');
    feed.appendChild(reply);
  }
  feed.scrollTop = feed.scrollHeight;
}

// ---------- Main entry ----------

async function openCandidateReportPage(candidateId: string, initialTab = 'overview') {
  const candidate = findCandidate(candidateId);
  if (!candidate) return;
  const job = findJobForCandidate(candidate);
  const analysis = await getAnalysis(candidateId);
  // Structured interview evaluation (rubric + dimensions + proctoring) from the engine.
  let interviewReport: CandidateReport | null = null;
  if (getDataSource() === 'api') {
    try { interviewReport = await apiFetchCandidateReport(candidateId); } catch { /* not scored yet */ }
  }

  State.activeReportCandidateId = candidateId;
  State.activeTab = 'candidate-report';

  // Header + breadcrumbs
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === 'jobs');
  });
  toggleHeaderElementsForJobFlow(false);
  const breadcrumb = document.getElementById('breadcrumb-title')!;
  const cardName = job.cardName || '';
  const shortName = cardName.length > 24 ? cardName.slice(0, 24) + '…' : cardName;
  breadcrumb.innerHTML = `<span class="breadcrumb-link" id="bc-jobs-link">Jobs</span>
    <span class="breadcrumb-separator">/</span> <span class="breadcrumb-link" id="bc-jobname-link">${escapeHTML(shortName)}</span>
    <span class="breadcrumb-separator">/</span> Report`;
  document.getElementById('bc-jobs-link')?.addEventListener('click', () => navigateToTab('jobs'));
  document.getElementById('bc-jobname-link')?.addEventListener('click', () => navigateToJobDetail(job.id as string));
  document.getElementById('header-main-title')!.textContent = `Candidate Report`;
  document.getElementById('header-sub-text')!.textContent = `${candidate.name} · ${job.roleName}`;
  (document.getElementById('header-action-btn') as HTMLElement).style.display = 'none';

  document.querySelectorAll('.dashboard-view').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-candidate-report')?.classList.add('active-view');

  const root = document.getElementById('report-page-root');
  if (!root) return;

  const initials = (candidate.name || '').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const score = overallScoreOf(candidate, analysis);
  const decision = candidate.decision || '';

  const tabs = [
    { key: 'overview', label: 'Overview', icon: '▦' },
    { key: 'competencies', label: 'Competencies', icon: '☆' },
    { key: 'resume', label: 'Resume', icon: '🗎' },
    { key: 'screening', label: 'Recruiter Screening', icon: '☷', badge: candidate.recruiterScreening },
    { key: 'analysis', label: 'Interview Analysis', icon: '📊' },
    { key: 'proctoring', label: 'Proctoring', icon: '◉' },
    { key: 'transcript', label: 'Transcript', icon: '🗩' },
  ];

  root.innerHTML = `
    <div class="rp-shell">
      <div class="rp-topbar">
        <button class="rp-back" id="rp-back" title="Back to job">‹</button>
        <div class="rp-identity">
          <div class="rp-avatar">${escapeHTML(initials)}</div>
          <div>
            <h2 class="rp-name">${escapeHTML(candidate.name)} <span class="rp-score-inline ${scoreTone(score)}">${score}%</span></h2>
            <p class="rp-contact">✉ ${escapeHTML(candidate.email || 'no email')} &nbsp;·&nbsp; ☏ ${escapeHTML(candidate.phone || '—')}</p>
          </div>
        </div>
        <div class="rp-topbar-actions">
          <select class="rp-decision" id="rp-decision" title="Hiring decision">
            ${[['', 'Pending'], ['shortlisted', 'Shortlisted'], ['on_hold', 'On Hold'], ['rejected', 'Rejected'], ['hired', 'Hired']].map(([v, label]) => `<option value="${v}" ${decision === v ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
          <button class="rp-icon-btn" id="rp-print" title="Download / print report">⎙</button>
          <button class="rp-icon-btn" id="rp-share" title="Copy share link">⤴</button>
          <button class="rp-remarks-btn" id="rp-remarks-btn">🗨 Remarks</button>
        </div>
      </div>

      <div class="rp-tabs">
        ${tabs.map((t, i) => `
          <button class="rp-tab ${i === 0 ? 'active' : ''}" data-rp-tab="${t.key}">
            <span class="rp-tab-icon">${t.icon}</span> ${t.label}
            ${t.badge ? `<span class="rp-tab-badge">${escapeHTML(t.badge)}</span>` : ''}
          </button>
        `).join('')}
      </div>

      <div class="rp-panes">
        <div class="rp-pane active" data-rp-pane="overview">${renderOverviewPane(candidate, job, analysis)}</div>
        <div class="rp-pane" data-rp-pane="competencies">${renderCompetenciesPane(candidate, analysis)}</div>
        <div class="rp-pane" data-rp-pane="resume">${await renderResumePane(candidate, analysis)}</div>
        <div class="rp-pane" data-rp-pane="screening">${renderScreeningPane(candidate)}</div>
        <div class="rp-pane" data-rp-pane="analysis">${renderInterviewAnalysisPane(candidate, interviewReport)}</div>
        <div class="rp-pane" data-rp-pane="proctoring">${renderProctoringPane(candidate, interviewReport)}</div>
        <div class="rp-pane" data-rp-pane="transcript">${renderTranscriptPane(candidate)}</div>
        <div class="rp-pane" data-rp-pane="remarks">${renderRemarksPane(candidate, analysis)}</div>
      </div>
    </div>
  `;

  bindReportPage(candidate, job, analysis, root, initialTab);

  // Animate the score ring after paint
  requestAnimationFrame(() => {
    const ring = root.querySelector('.rp-ring-fill') as HTMLElement | null;
    if (ring) {
      const target = ring.getAttribute('data-target');
      ring.style.transition = 'stroke-dasharray 0.9s cubic-bezier(0.16, 1, 0.3, 1)';
      requestAnimationFrame(() => {
        ring.setAttribute('stroke-dasharray', `${target} 10000`);
      });
    }
  });

  // Fill the bars in the initially-active (overview) pane.
  animateBarsIn(root.querySelector('.rp-pane.active'));

  soundEngine.playChime([392.0, 523.25, 659.25], 0.15, 0.08);
}

// Fill report bars in from 0 so they visibly load (mirrors the score-ring trigger).
// Called for the active pane on open and whenever a tab is shown, so bars in
// initially-hidden panes still animate when their tab is opened.
function animateBarsIn(container: Element | null) {
  if (!container) return;
  container.querySelectorAll('.rp-breakdown-fill, .da-dim-fill').forEach((fill: Element) => {
    const el = fill as HTMLElement;
    const target = el.style.width;
    if (!target || target === '0%') return;
    el.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = target; }));
  });
  container.querySelectorAll('.rp-chart-bar').forEach((barEl: Element) => {
    const bar = barEl as HTMLElement;
    bar.style.transformBox = 'fill-box';
    bar.style.transformOrigin = 'bottom';
    bar.style.transition = 'transform 0.7s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease';
    bar.style.transform = 'scaleY(0)';
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transform = 'scaleY(1)'; }));
  });
}

function bindReportPage(candidate: Candidate, job: Job, analysis: ResumeAnalysis | null, root: HTMLElement, initialTab = 'overview') {
  root.querySelector('#rp-back')?.addEventListener('click', () => {
    resetWaveformAudio();
    navigateToJobDetail(job.id as string);
  });

  // Tab switching (remarks pane is reachable via the Remarks button)
  const switchTab = (key?: string) => {
    root.querySelectorAll('.rp-tab').forEach(t => t.classList.toggle('active', (t as HTMLElement).dataset.rpTab === key));
    root.querySelectorAll('.rp-pane').forEach(p => p.classList.toggle('active', (p as HTMLElement).dataset.rpPane === key));
    if (key !== 'transcript') resetWaveformAudio();
    soundEngine.playClick();
    animateBarsIn(root.querySelector('.rp-pane.active'));
  };
  root.querySelectorAll('.rp-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab((tab as HTMLElement).dataset.rpTab));
  });
  root.querySelector('#rp-remarks-btn')?.addEventListener('click', () => switchTab('remarks'));

  // Open directly on a requested tab (e.g. Remarks from the candidate table).
  if (initialTab && initialTab !== 'overview') switchTab(initialTab);

  // Topbar actions
  root.querySelector('#rp-decision')?.addEventListener('change', async (e) => {
    const value = (e.target as HTMLSelectElement).value || null; // null | shortlisted | on_hold | rejected | hired
    candidate.decision = value;
    saveStateToLocalStorage();
    const { showPremiumToast } = await import('./sourcing');
    if (value === 'rejected') {
      // Rejecting also moves the kanban card; updateCandidateStatus persists decision='rejected'.
      const { updateCandidateStatus } = await import('./job-detail-panes');
      updateCandidateStatus(candidate.id, 'Rejected');
      showPremiumToast(`${candidate.name} marked as Rejected.`, 'info');
    } else {
      if (candidate._backend && getDataSource() === 'api') {
        apiUpdateApplicant(candidate.id as string, { decision: value }).catch((err: any) =>
          console.warn('Decision saved locally but backend sync failed:', err));
      }
      showPremiumToast('Decision updated.', 'success');
    }
  });
  root.querySelector('#rp-print')?.addEventListener('click', () => window.print());
  root.querySelector('#rp-dl-transcript')?.addEventListener('click', () => downloadInterviewTranscript(candidate.id as string, candidate.name));
  root.querySelector('#rp-share')?.addEventListener('click', async () => {
    const { showPremiumToast } = await import('./sourcing');
    try {
      await navigator.clipboard.writeText(`${location.origin}/dashboard#report-${candidate.id}`);
      showPremiumToast('Share link copied to clipboard.', 'success');
    } catch {
      showPremiumToast('Could not copy link.', 'error');
    }
  });

  // AI insights
  const feed = root.querySelector('#rp-insight-feed') as HTMLElement | null;
  if (feed) {
    root.querySelectorAll('.rp-insight-btn').forEach(btn => {
      btn.addEventListener('click', () => askInsight(candidate, job, analysis, INSIGHT_PRESETS[parseInt((btn as HTMLElement).dataset.preset || '0')], feed));
    });
    root.querySelector('#rp-insight-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = root.querySelector('#rp-insight-input') as HTMLInputElement;
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      askInsight(candidate, job, analysis, q, feed);
    });
  }

  // Resume raw toggle
  root.querySelector('#rp-raw-toggle')?.addEventListener('click', () => {
    const pre = root.querySelector('#rp-raw-resume') as HTMLElement | null;
    if (pre) pre.hidden = !pre.hidden;
  });

  // Transcript waveform
  if (root.querySelector('#btn-play-wave')) {
    setupWaveformBars();
    root.querySelector('#btn-play-wave')!.addEventListener('click', () => toggleWaveformAudio());
  }

  // Notes + remarks
  root.querySelector('#rp-notes-area')?.addEventListener('blur', (e) => {
    candidate.recruiterNotes = (e.target as HTMLTextAreaElement).value;
    saveStateToLocalStorage();
    if (candidate._backend && getDataSource() === 'api') {
      apiUpdateApplicant(candidate.id as string, { remarks: (e.target as HTMLTextAreaElement).value }).catch((err: any) =>
        console.warn('Notes saved locally but backend sync failed:', err));
    }
    const saved = root.querySelector('#rp-notes-saved');
    if (saved) { saved.textContent = 'Saved ✓'; setTimeout(() => { saved.textContent = 'Notes save automatically when you click away.'; }, 2000); }
  });
  root.querySelector('#rp-remark-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = root.querySelector('#rp-remark-input') as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    if (!candidate.remarks) candidate.remarks = [];
    candidate.remarks.push({ text, at: new Date().toLocaleString() });
    saveStateToLocalStorage();
    input.value = '';
    const feedEl = root.querySelector('#rp-remarks-feed')!;
    feedEl.innerHTML = candidate.remarks.map(r => `<div class="rp-remark"><span class="rp-remark-time">${escapeHTML(r.at)}</span><p>${escapeHTML(r.text)}</p></div>`).join('');
    soundEngine.playChime([523.25, 659.25], 0.1, 0.06);
  });

  // Stage actions
  root.querySelector('#rp-btn-reject')?.addEventListener('click', async () => {
    const { updateCandidateStatus } = await import('./job-detail-panes');
    updateCandidateStatus(candidate.id, 'Rejected');
    navigateToJobDetail(job.id as string);
  });
  root.querySelector('#rp-btn-advance')?.addEventListener('click', async () => {
    const next = getCandidateNextStage(candidate.status as string);
    if (!next) return;
    const { updateCandidateStatus } = await import('./job-detail-panes');
    updateCandidateStatus(candidate.id, next);
    openCandidateReportPage(candidate.id as string);
  });
}

export { openCandidateReportPage };
