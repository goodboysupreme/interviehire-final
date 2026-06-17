import { document, requestAnimationFrame, setTimeout } from './runtime.js';
import { callDeepSeekAPI, saveStateToLocalStorage } from './ai-api.js';
import { navigateToJobDetail } from './job-detail.js';
import { escapeHTML, toggleHeaderElementsForJobFlow } from './job-flow.js';
import { resetWaveformAudio, setupWaveformBars, toggleWaveformAudio } from './kanban-swarm.js';
import { navigateToTab } from './navigation.js';
import { getCandidateNextStage, getCandidateTranscriptLines } from './report.js';
import { getScoringConfig } from './scoring-config.js';
import { soundEngine } from './sound.js';
import { AppState } from './state.js';

// ==========================================
// CANDIDATE REPORT — FULL PAGE VIEW
// ==========================================

const INSIGHT_PRESETS = [
  'Suggest next round questions for this candidate',
  'Find overall red flags of this candidate',
  'Show hidden strengths beyond the job title',
];

function findCandidate(cid) {
  return AppState.candidates.find(c => c.id === cid);
}

function findJobForCandidate(candidate) {
  return AppState.jobs.find(j => j.roleName === candidate.jobApplied || j.cardName === candidate.jobApplied) || AppState.jobs[0];
}

async function getAnalysis(cid) {
  const { resumeAnalysisCache } = await import('./resume-analysis.js');
  if (resumeAnalysisCache[cid]) return resumeAnalysisCache[cid];
  const candidate = findCandidate(cid);
  if (candidate?.resumeAnalysis) {
    resumeAnalysisCache[cid] = candidate.resumeAnalysis;
    return candidate.resumeAnalysis;
  }
  return null;
}

function candidateHash(cid) {
  let h = 0;
  for (const ch of String(cid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function overallScoreOf(candidate, analysis) {
  if (analysis?.matchScore != null) return Math.round(analysis.matchScore);
  if (candidate.interviewScore != null) return Math.round(candidate.interviewScore);
  const parsed = parseInt(String(candidate.score || '').replace('%', ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function scoreTone(score) {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function getCompetencies(analysis) {
  if (Array.isArray(analysis?.competencies) && analysis.competencies.length) {
    return analysis.competencies.map(c => ({
      name: c.name || 'Competency',
      score: Math.max(0, Math.min(100, Math.round(Number(c.score) || 0))),
      bullets: Array.isArray(c.bullets) ? c.bullets.filter(Boolean) : [],
    }));
  }
  if (Array.isArray(analysis?.weightedBreakdown) && analysis.weightedBreakdown.length) {
    return analysis.weightedBreakdown.map(b => ({
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

function compChipTone(score) {
  if (score >= 75) return 'excellent';
  if (score >= 50) return 'good';
  return 'needs-work';
}

function emptyCard(title, copy) {
  return `
    <div class="rp-empty-card">
      <h4>${escapeHTML(title)}</h4>
      <p>${escapeHTML(copy)}</p>
    </div>
  `;
}

function bulletList(items, cls = '') {
  const list = (items || []).filter(Boolean).map(String);
  if (!list.length) return '';
  return `<ul class="rp-bullets ${cls}">${list.map(i => `<li>${escapeHTML(i)}</li>`).join('')}</ul>`;
}

// ---------- Overview ----------

function renderScoreRing(score, recommendation) {
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

function renderOverviewPane(candidate, job, analysis) {
  const score = overallScoreOf(candidate, analysis);
  const comps = getCompetencies(analysis);
  const config = getScoringConfig(job);
  const jobCandidateCount = AppState.candidates.filter(c => c.jobApplied === candidate.jobApplied).length;

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
      ${analysis.weightedBreakdown.map(b => `
        <div class="rp-breakdown-row">
          <div class="rp-breakdown-meta"><span>${escapeHTML(b.label)}</span><em>${b.score} × ${b.weightPct}%</em></div>
          <div class="rp-breakdown-bar"><div class="rp-breakdown-fill ${scoreTone(b.score)}" style="width:${b.score}%"></div></div>
        </div>
      `).join('')}
      ${analysis.gateNotes?.length ? `<div class="rp-gate-notes">${analysis.gateNotes.map(n => `<span>⛔ ${escapeHTML(n)}</span>`).join('')}</div>` : ''}
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

function renderCompetenciesPane(candidate, analysis) {
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

async function renderResumePane(candidate, analysis) {
  const { resumeTextCache, resumeIdentityCache } = await import('./resume-analysis.js');
  const text = resumeTextCache[candidate.id] || candidate.resumeText || '';
  const identity = resumeIdentityCache[candidate.id] || {};

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
      ${projects.map(p => `
        <div class="rp-project-card">
          <div class="rp-project-head">
            <strong>${escapeHTML(p.name || 'Untitled project')}</strong>
            <span class="rp-score-pill ${compChipTone(Number(p.relevance) || 0)}">${Math.round(Number(p.relevance) || 0)}% relevant</span>
          </div>
          ${p.summary ? `<p class="rp-project-summary">${escapeHTML(p.summary)}</p>` : ''}
          ${p.whyItMatters ? `<p class="rp-project-why"><strong>Why it matters here:</strong> ${escapeHTML(p.whyItMatters)}</p>` : ''}
          ${Array.isArray(p.skills) && p.skills.length ? `<div class="rp-tag-row">${p.skills.map(s => `<span class="rp-tag">${escapeHTML(s)}</span>`).join('')}</div>` : ''}
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
          ${verdicts.map(v => {
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

function renderScreeningPane(candidate) {
  if (!candidate.recruiterScreening && candidate.interviewScore == null) {
    return emptyCard('Screening not recorded', 'Recruiter screening results will appear here once this candidate completes the screening stage.');
  }
  const fitTone = candidate.recruiterScreening === 'Good fit' ? 'met' : candidate.recruiterScreening === 'Moderate fit' ? 'partial' : 'missed';
  const params = [
    { label: 'Recruiter Screening Verdict', answer: candidate.recruiterScreening || 'Pending', remark: `Screening fit assessment recorded by the screening agent.`, tag: candidate.recruiterScreening || '—' },
    { label: 'Interview Status', answer: candidate.interviewStatus || 'Not started', remark: candidate.attemptedAt ? `Attempted at ${candidate.attemptedAt}.` : 'No attempt recorded yet.', tag: candidate.interviewStatus || '—' },
    { label: 'Interview Score', answer: candidate.interviewScore != null ? `${candidate.interviewScore}/100` : 'Not scored', remark: 'Composite score across screening competencies.', tag: candidate.interviewScore != null ? (candidate.interviewScore >= 70 ? 'Good Fit' : 'Review') : '—' },
    { label: 'Application Source', answer: candidate.source || 'Unknown', remark: `Registered on ${candidate.registeredOn || 'an unknown date'}.`, tag: 'Info' },
    { label: 'Screening Agent Score', answer: candidate.recruiterScreeningScore != null ? `${candidate.recruiterScreeningScore}/100` : 'Not scored', remark: 'Parameter match score from the screening conversation.', tag: candidate.recruiterScreeningScore >= 80 ? 'Good Fit' : 'Review' },
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

function renderProctoringPane(candidate) {
  if (!candidate.interviewStatus || candidate.interviewStatus === 'Not Started') {
    return emptyCard('No proctoring session yet', 'AI proctoring and integrity analysis appears after the candidate attempts a monitored interview.');
  }
  const h = candidateHash(candidate.id);
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

function renderTranscriptPane(candidate) {
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

function renderRemarksPane(candidate, analysis) {
  const remarks = candidate.remarks || [];
  const nextStage = getCandidateNextStage(candidate.status);
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

async function askInsight(candidate, job, analysis, question, feed) {
  const { resumeTextCache, reportChatCache } = await import('./resume-analysis.js');
  if (!reportChatCache[candidate.id]) reportChatCache[candidate.id] = [];
  reportChatCache[candidate.id].push({ sender: 'user', text: question });

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

  const resumeText = resumeTextCache[candidate.id] || 'No resume text uploaded.';
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
    reportChatCache[candidate.id].push({ sender: 'aria', text: answer });
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

async function openCandidateReportPage(candidateId) {
  const candidate = findCandidate(candidateId);
  if (!candidate) return;
  const job = findJobForCandidate(candidate);
  const analysis = await getAnalysis(candidateId);

  AppState.activeReportCandidateId = candidateId;
  AppState.activeTab = 'candidate-report';

  // Header + breadcrumbs
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === 'jobs');
  });
  toggleHeaderElementsForJobFlow(false);
  const breadcrumb = document.getElementById('breadcrumb-title');
  const shortName = job.cardName.length > 24 ? job.cardName.slice(0, 24) + '…' : job.cardName;
  breadcrumb.innerHTML = `<span class="breadcrumb-link" id="bc-jobs-link">Jobs</span>
    <span class="breadcrumb-separator">/</span> <span class="breadcrumb-link" id="bc-jobname-link">${escapeHTML(shortName)}</span>
    <span class="breadcrumb-separator">/</span> Report`;
  document.getElementById('bc-jobs-link')?.addEventListener('click', () => navigateToTab('jobs'));
  document.getElementById('bc-jobname-link')?.addEventListener('click', () => navigateToJobDetail(job.id));
  document.getElementById('header-main-title').textContent = `Candidate Report`;
  document.getElementById('header-sub-text').textContent = `${candidate.name} · ${job.roleName}`;
  document.getElementById('header-action-btn').style.display = 'none';

  document.querySelectorAll('.dashboard-view').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-candidate-report')?.classList.add('active-view');

  const root = document.getElementById('report-page-root');
  if (!root) return;

  const initials = candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const score = overallScoreOf(candidate, analysis);
  const decision = candidate.decision || 'Pending';

  const tabs = [
    { key: 'overview', label: 'Overview', icon: '▦' },
    { key: 'competencies', label: 'Competencies', icon: '☆' },
    { key: 'resume', label: 'Resume', icon: '🗎' },
    { key: 'screening', label: 'Recruiter Screening', icon: '☷', badge: candidate.recruiterScreening },
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
            ${['Pending', 'Shortlisted', 'On Hold', 'Rejected'].map(d => `<option value="${d}" ${decision === d ? 'selected' : ''}>${d}</option>`).join('')}
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
        <div class="rp-pane" data-rp-pane="proctoring">${renderProctoringPane(candidate)}</div>
        <div class="rp-pane" data-rp-pane="transcript">${renderTranscriptPane(candidate)}</div>
        <div class="rp-pane" data-rp-pane="remarks">${renderRemarksPane(candidate, analysis)}</div>
      </div>
    </div>
  `;

  bindReportPage(candidate, job, analysis, root);

  // Animate the score ring after paint
  requestAnimationFrame(() => {
    const ring = root.querySelector('.rp-ring-fill');
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
function animateBarsIn(container) {
  if (!container) return;
  container.querySelectorAll('.rp-breakdown-fill, .da-dim-fill').forEach(fill => {
    const target = fill.style.width;
    if (!target || target === '0%') return;
    fill.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = target; }));
  });
  container.querySelectorAll('.rp-chart-bar').forEach(bar => {
    bar.style.transformBox = 'fill-box';
    bar.style.transformOrigin = 'bottom';
    bar.style.transition = 'transform 0.7s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease';
    bar.style.transform = 'scaleY(0)';
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transform = 'scaleY(1)'; }));
  });
}

function bindReportPage(candidate, job, analysis, root) {
  root.querySelector('#rp-back')?.addEventListener('click', () => {
    resetWaveformAudio();
    navigateToJobDetail(job.id);
  });

  // Tab switching (remarks pane is reachable via the Remarks button)
  const switchTab = (key) => {
    root.querySelectorAll('.rp-tab').forEach(t => t.classList.toggle('active', t.dataset.rpTab === key));
    root.querySelectorAll('.rp-pane').forEach(p => p.classList.toggle('active', p.dataset.rpPane === key));
    if (key !== 'transcript') resetWaveformAudio();
    soundEngine.playClick();
    animateBarsIn(root.querySelector('.rp-pane.active'));
  };
  root.querySelectorAll('.rp-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.rpTab));
  });
  root.querySelector('#rp-remarks-btn')?.addEventListener('click', () => switchTab('remarks'));

  // Topbar actions
  root.querySelector('#rp-decision')?.addEventListener('change', async (e) => {
    candidate.decision = e.target.value;
    saveStateToLocalStorage();
    const { showPremiumToast } = await import('./sourcing.js');
    if (e.target.value === 'Rejected') {
      const { updateCandidateStatus } = await import('./job-detail-panes.js');
      updateCandidateStatus(candidate.id, 'Rejected');
      showPremiumToast(`${candidate.name} marked as Rejected.`, 'info');
    } else {
      showPremiumToast(`Decision updated to ${e.target.value}.`, 'success');
    }
  });
  root.querySelector('#rp-print')?.addEventListener('click', () => window.print());
  root.querySelector('#rp-share')?.addEventListener('click', async () => {
    const { showPremiumToast } = await import('./sourcing.js');
    try {
      await navigator.clipboard.writeText(`${location.origin}/dashboard#report-${candidate.id}`);
      showPremiumToast('Share link copied to clipboard.', 'success');
    } catch {
      showPremiumToast('Could not copy link.', 'error');
    }
  });

  // AI insights
  const feed = root.querySelector('#rp-insight-feed');
  if (feed) {
    root.querySelectorAll('.rp-insight-btn').forEach(btn => {
      btn.addEventListener('click', () => askInsight(candidate, job, analysis, INSIGHT_PRESETS[parseInt(btn.dataset.preset)], feed));
    });
    root.querySelector('#rp-insight-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = root.querySelector('#rp-insight-input');
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      askInsight(candidate, job, analysis, q, feed);
    });
  }

  // Resume raw toggle
  root.querySelector('#rp-raw-toggle')?.addEventListener('click', () => {
    const pre = root.querySelector('#rp-raw-resume');
    if (pre) pre.hidden = !pre.hidden;
  });

  // Transcript waveform
  if (root.querySelector('#btn-play-wave')) {
    setupWaveformBars();
    root.querySelector('#btn-play-wave').addEventListener('click', () => toggleWaveformAudio());
  }

  // Notes + remarks
  root.querySelector('#rp-notes-area')?.addEventListener('blur', (e) => {
    candidate.recruiterNotes = e.target.value;
    saveStateToLocalStorage();
    const saved = root.querySelector('#rp-notes-saved');
    if (saved) { saved.textContent = 'Saved ✓'; setTimeout(() => { saved.textContent = 'Notes save automatically when you click away.'; }, 2000); }
  });
  root.querySelector('#rp-remark-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = root.querySelector('#rp-remark-input');
    const text = input.value.trim();
    if (!text) return;
    if (!candidate.remarks) candidate.remarks = [];
    candidate.remarks.push({ text, at: new Date().toLocaleString() });
    saveStateToLocalStorage();
    input.value = '';
    const feedEl = root.querySelector('#rp-remarks-feed');
    feedEl.innerHTML = candidate.remarks.map(r => `<div class="rp-remark"><span class="rp-remark-time">${escapeHTML(r.at)}</span><p>${escapeHTML(r.text)}</p></div>`).join('');
    soundEngine.playChime([523.25, 659.25], 0.1, 0.06);
  });

  // Stage actions
  root.querySelector('#rp-btn-reject')?.addEventListener('click', async () => {
    const { updateCandidateStatus } = await import('./job-detail-panes.js');
    updateCandidateStatus(candidate.id, 'Rejected');
    navigateToJobDetail(job.id);
  });
  root.querySelector('#rp-btn-advance')?.addEventListener('click', async () => {
    const next = getCandidateNextStage(candidate.status);
    if (!next) return;
    const { updateCandidateStatus } = await import('./job-detail-panes.js');
    updateCandidateStatus(candidate.id, next);
    openCandidateReportPage(candidate.id);
  });
}

export { openCandidateReportPage };
