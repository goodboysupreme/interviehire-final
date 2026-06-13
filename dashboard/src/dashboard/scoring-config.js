import { document } from './runtime.js';
import { saveStateToLocalStorage } from './ai-api.js';
import { soundEngine } from './sound.js';
import { AppState } from './state.js';

// ==========================================
// RESUME SCORING ENGINE CONFIG
// User-editable weights, thresholds, gates and custom criteria.
// Final scores are always computed in code from dimension scores ×
// these weights — the model never does the arithmetic.
// ==========================================

const SCORING_DIMENSIONS = [
  { key: 'mustHave', label: 'Must-Have Criteria', desc: 'How completely the resume satisfies the configured must-have requirements' },
  { key: 'niceToHave', label: 'Nice-To-Have Criteria', desc: 'Coverage of good-to-have skills and bonus qualifications' },
  { key: 'projects', label: 'Project Relevance', desc: 'How directly the candidate’s past projects map to what this role will actually do' },
  { key: 'experience', label: 'Experience Depth', desc: 'Years, seniority and progression measured against the experience band' },
  { key: 'education', label: 'Education & Certifications', desc: 'Degrees, institutes and certifications relevant to the role' },
  { key: 'custom', label: 'Custom Criteria', desc: 'Your own criteria below, scored individually and averaged' },
];

const DEFAULT_SCORING_CONFIG = {
  weights: { mustHave: 35, niceToHave: 10, projects: 25, experience: 15, education: 5, custom: 10 },
  thresholds: { advance: 70, hold: 45 },
  mustHaveGate: true,
  mustHaveCap: 48,
  customCriteria: [],
};

function getScoringConfig(job) {
  const saved = job.scoringConfig || {};
  return {
    weights: { ...DEFAULT_SCORING_CONFIG.weights, ...(saved.weights || {}) },
    thresholds: { ...DEFAULT_SCORING_CONFIG.thresholds, ...(saved.thresholds || {}) },
    mustHaveGate: saved.mustHaveGate !== undefined ? saved.mustHaveGate : DEFAULT_SCORING_CONFIG.mustHaveGate,
    mustHaveCap: saved.mustHaveCap ?? DEFAULT_SCORING_CONFIG.mustHaveCap,
    customCriteria: Array.isArray(saved.customCriteria) ? saved.customCriteria : [],
  };
}

function getActiveWeights(config, criteria) {
  // A dimension only participates if it has signal to score against
  const weights = { ...config.weights };
  if (!criteria.mustHave?.length) weights.mustHave = 0;
  if (!criteria.goodToHave?.length) weights.niceToHave = 0;
  if (!config.customCriteria.length) weights.custom = 0;
  return weights;
}

function computeWeightedScore(dimensions, config, criteria) {
  const weights = getActiveWeights(config, criteria);
  let total = 0;
  let weightSum = 0;
  const breakdown = [];
  SCORING_DIMENSIONS.forEach(dim => {
    const w = Math.max(0, Number(weights[dim.key]) || 0);
    if (w === 0) return;
    const raw = dimensions?.[dim.key]?.score;
    const score = Math.max(0, Math.min(100, Number(raw) || 0));
    total += score * w;
    weightSum += w;
    breakdown.push({ key: dim.key, label: dim.label, score, weight: w });
  });
  const matchScore = weightSum > 0 ? Math.round(total / weightSum) : 0;
  const normalized = breakdown.map(b => ({ ...b, weightPct: Math.round((b.weight / weightSum) * 100) }));
  return { matchScore, breakdown: normalized };
}

function recommendationFromScore(score, config) {
  if (score >= config.thresholds.advance) return 'Advance';
  if (score >= config.thresholds.hold) return 'Hold';
  return 'Reject';
}

// ==========================================
// SCORING EDITOR UI (lives in the Resume Analysis tab)
// ==========================================

function criteriaChipList(items, group) {
  return (items || []).map((item, i) => `
    <span class="sce-chip ${group}" data-group="${group}" data-idx="${i}">
      ${escapeAttr(item)}
      <button class="sce-chip-x" data-group="${group}" data-idx="${i}" title="Remove">×</button>
    </span>
  `).join('');
}

function escapeAttr(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderScoringEditor(job, container) {
  const config = getScoringConfig(job);
  const criteria = job.resumeCriteria || { mustHave: [], redFlags: [], goodToHave: [], goodToHaveMinMatch: 1 };
  const weights = getActiveWeights(config, criteria);
  const weightSum = SCORING_DIMENSIONS.reduce((s, d) => s + (weights[d.key] || 0), 0) || 1;
  const collapsed = container.dataset.expanded !== 'true';

  container.innerHTML = `
    <div class="sce-panel ${collapsed ? 'collapsed' : ''}">
      <button class="sce-header" id="sce-toggle">
        <div class="sce-header-left">
          <span class="sce-header-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </span>
          <div>
            <h3 class="sce-title">Scoring Engine</h3>
            <p class="sce-subtitle">You decide what matters — weights, thresholds, gates and your own criteria drive every score</p>
          </div>
        </div>
        <div class="sce-header-right">
          <span class="sce-summary-pill">${config.thresholds.advance}+ advance</span>
          <span class="sce-summary-pill hold">${config.thresholds.hold}+ hold</span>
          <span class="sce-summary-pill gate ${config.mustHaveGate ? '' : 'off'}">${config.mustHaveGate ? 'Gate on' : 'Gate off'}</span>
          <svg class="sce-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </button>

      <div class="sce-body">
        <div class="sce-grid">
          <div class="sce-col">
            <h4 class="sce-section-title">Dimension Weights</h4>
            <p class="sce-section-hint">Relative importance of each dimension. Dimensions without configured criteria are skipped automatically.</p>
            ${SCORING_DIMENSIONS.map(dim => {
              const active = weights[dim.key] > 0 || config.weights[dim.key] > 0;
              const pct = Math.round(((weights[dim.key] || 0) / weightSum) * 100);
              const skipped = weights[dim.key] === 0 && config.weights[dim.key] > 0;
              return `
                <div class="sce-weight-row ${skipped ? 'skipped' : ''}" data-dim="${dim.key}">
                  <div class="sce-weight-meta">
                    <span class="sce-weight-label">${dim.label}${skipped ? ' <em class="sce-skip-note">— no criteria set, skipped</em>' : ''}</span>
                    <span class="sce-weight-pct" id="sce-pct-${dim.key}">${skipped ? '0' : pct}%</span>
                  </div>
                  <p class="sce-weight-desc">${dim.desc}</p>
                  <input type="range" class="sce-weight-slider" data-dim="${dim.key}" min="0" max="50" value="${config.weights[dim.key]}" ${skipped ? 'disabled' : ''} />
                </div>
              `;
            }).join('')}
          </div>

          <div class="sce-col">
            <h4 class="sce-section-title">Decision Thresholds</h4>
            <p class="sce-section-hint">Weighted score is computed deterministically, then these decide the recommendation.</p>
            <div class="sce-threshold-row">
              <span class="sce-th-badge advance">Advance</span>
              <span>score ≥</span>
              <input type="number" class="sce-num-input" id="sce-th-advance" min="1" max="100" value="${config.thresholds.advance}" />
            </div>
            <div class="sce-threshold-row">
              <span class="sce-th-badge hold">Hold</span>
              <span>score ≥</span>
              <input type="number" class="sce-num-input" id="sce-th-hold" min="0" max="99" value="${config.thresholds.hold}" />
              <span class="sce-th-note">below = Reject</span>
            </div>

            <h4 class="sce-section-title" style="margin-top:18px;">Hard Gates</h4>
            <label class="sce-gate-row">
              <input type="checkbox" id="sce-gate-musthave" ${config.mustHaveGate ? 'checked' : ''} />
              <div>
                <span class="sce-gate-label">Missing must-have caps the score</span>
                <span class="sce-gate-sub">Cap at <input type="number" class="sce-num-input sm" id="sce-gate-cap" min="0" max="69" value="${config.mustHaveCap}" /> and force Reject</span>
              </div>
            </label>
            <div class="sce-gate-row static">
              <span class="sce-gate-flag">⛔</span>
              <div>
                <span class="sce-gate-label">Red flags always reject</span>
                <span class="sce-gate-sub">Any configured red flag found in the resume caps the score at 30</span>
              </div>
            </div>

            <h4 class="sce-section-title" style="margin-top:18px;">Screening Criteria</h4>
            <p class="sce-section-hint">Type and press Enter to add. These feed the Must-Have / Nice-To-Have dimensions.</p>
            <div class="sce-criteria-block">
              <span class="sce-criteria-label must">Must Have</span>
              <div class="sce-chip-wrap" id="sce-chips-mustHave">${criteriaChipList(criteria.mustHave, 'mustHave')}</div>
              <input type="text" class="sce-chip-input" data-group="mustHave" placeholder="Add a must-have requirement…" />
            </div>
            <div class="sce-criteria-block">
              <span class="sce-criteria-label nice">Good To Have</span>
              <div class="sce-chip-wrap" id="sce-chips-goodToHave">${criteriaChipList(criteria.goodToHave, 'goodToHave')}</div>
              <input type="text" class="sce-chip-input" data-group="goodToHave" placeholder="Add a nice-to-have…" />
            </div>
            <div class="sce-criteria-block">
              <span class="sce-criteria-label flag">Red Flags</span>
              <div class="sce-chip-wrap" id="sce-chips-redFlags">${criteriaChipList(criteria.redFlags, 'redFlags')}</div>
              <input type="text" class="sce-chip-input" data-group="redFlags" placeholder="Add a disqualifier…" />
            </div>
          </div>
        </div>

        <div class="sce-custom-section">
          <div class="sce-custom-header">
            <div>
              <h4 class="sce-section-title">Custom Criteria</h4>
              <p class="sce-section-hint">Tell the analyst exactly what to look for and how much it matters. Each is scored 0–100 with evidence, then averaged by importance into the Custom dimension.</p>
            </div>
            <button class="sce-btn-add-custom" id="sce-add-custom">+ Add Criterion</button>
          </div>
          <div class="sce-custom-list" id="sce-custom-list">
            ${config.customCriteria.map((c, i) => `
              <div class="sce-custom-card" data-idx="${i}">
                <div class="sce-custom-row">
                  <input type="text" class="sce-custom-label" value="${escapeAttr(c.label)}" placeholder="Criterion name (e.g. Startup experience)" />
                  <div class="sce-custom-importance">
                    <span>Importance</span>
                    <input type="number" class="sce-num-input sm sce-custom-weight" min="1" max="10" value="${c.weight || 5}" />
                    <span>/10</span>
                  </div>
                  <button class="sce-custom-remove" title="Remove criterion">×</button>
                </div>
                <textarea class="sce-custom-desc" rows="2" placeholder="Describe exactly what the analyst should check for and what counts as strong evidence…">${escapeAttr(c.description || '')}</textarea>
              </div>
            `).join('')}
            ${config.customCriteria.length === 0 ? '<div class="sce-custom-empty">No custom criteria yet — add one to teach the analyst what matters to you.</div>' : ''}
          </div>
        </div>

        <div class="sce-footer">
          <button class="sce-btn-reset" id="sce-reset">Reset to defaults</button>
          <div class="sce-footer-right">
            <span class="sce-dirty-note" id="sce-dirty-note"></span>
            <button class="sce-btn-save" id="sce-save">Save Scoring Config</button>
          </div>
        </div>
      </div>
    </div>
  `;

  bindScoringEditor(job, container);
}

function bindScoringEditor(job, container) {
  const markDirty = () => {
    const note = container.querySelector('#sce-dirty-note');
    if (note) note.textContent = 'Unsaved changes';
  };

  container.querySelector('#sce-toggle')?.addEventListener('click', () => {
    const panel = container.querySelector('.sce-panel');
    panel.classList.toggle('collapsed');
    container.dataset.expanded = panel.classList.contains('collapsed') ? 'false' : 'true';
    soundEngine.playClick();
  });

  // Live % readouts while sliding
  const sliders = [...container.querySelectorAll('.sce-weight-slider')];
  const refreshPcts = () => {
    const vals = {};
    sliders.forEach(s => { vals[s.dataset.dim] = s.disabled ? 0 : (parseInt(s.value) || 0); });
    const sum = Object.values(vals).reduce((a, b) => a + b, 0) || 1;
    sliders.forEach(s => {
      const el = container.querySelector(`#sce-pct-${s.dataset.dim}`);
      if (el) el.textContent = `${Math.round((vals[s.dataset.dim] / sum) * 100)}%`;
    });
  };
  sliders.forEach(s => s.addEventListener('input', () => { refreshPcts(); markDirty(); }));

  container.querySelectorAll('.sce-num-input, #sce-gate-musthave').forEach(el => {
    el.addEventListener('change', markDirty);
  });

  // Criteria chips: remove + add-on-enter
  const criteria = job.resumeCriteria || (job.resumeCriteria = { mustHave: [], redFlags: [], goodToHave: [], goodToHaveMinMatch: 1 });
  container.querySelectorAll('.sce-chip-x').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = btn.dataset.group;
      criteria[group].splice(parseInt(btn.dataset.idx), 1);
      saveStateToLocalStorage();
      renderScoringEditor(job, container);
      soundEngine.playClick();
    });
  });
  container.querySelectorAll('.sce-chip-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      criteria[input.dataset.group].push(val);
      saveStateToLocalStorage();
      container.dataset.expanded = 'true';
      renderScoringEditor(job, container);
      container.querySelector(`.sce-chip-input[data-group="${input.dataset.group}"]`)?.focus();
      soundEngine.playChime([523.25, 659.25], 0.1, 0.06);
    });
  });

  // Custom criteria add/remove
  container.querySelector('#sce-add-custom')?.addEventListener('click', () => {
    const config = getScoringConfig(job);
    config.customCriteria.push({ id: `cc-${Date.now().toString(36)}`, label: '', description: '', weight: 5 });
    job.scoringConfig = config;
    container.dataset.expanded = 'true';
    renderScoringEditor(job, container);
    const cards = container.querySelectorAll('.sce-custom-card');
    cards[cards.length - 1]?.querySelector('.sce-custom-label')?.focus();
  });
  container.querySelectorAll('.sce-custom-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const config = getScoringConfig(job);
      config.customCriteria.splice(parseInt(btn.closest('.sce-custom-card').dataset.idx), 1);
      job.scoringConfig = config;
      saveStateToLocalStorage();
      renderScoringEditor(job, container);
    });
  });
  container.querySelectorAll('.sce-custom-label, .sce-custom-desc, .sce-custom-weight').forEach(el => {
    el.addEventListener('input', markDirty);
  });

  container.querySelector('#sce-reset')?.addEventListener('click', () => {
    job.scoringConfig = JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG));
    saveStateToLocalStorage();
    renderScoringEditor(job, container);
    soundEngine.playClick();
  });

  container.querySelector('#sce-save')?.addEventListener('click', async () => {
    const weights = {};
    container.querySelectorAll('.sce-weight-slider').forEach(s => {
      weights[s.dataset.dim] = parseInt(s.value) || 0;
    });
    const customCriteria = [...container.querySelectorAll('.sce-custom-card')].map(card => ({
      id: card.dataset.id || `cc-${Date.now().toString(36)}-${card.dataset.idx}`,
      label: card.querySelector('.sce-custom-label').value.trim(),
      description: card.querySelector('.sce-custom-desc').value.trim(),
      weight: Math.max(1, Math.min(10, parseInt(card.querySelector('.sce-custom-weight').value) || 5)),
    })).filter(c => c.label);

    const advance = Math.max(1, Math.min(100, parseInt(container.querySelector('#sce-th-advance').value) || 70));
    const hold = Math.max(0, Math.min(advance - 1, parseInt(container.querySelector('#sce-th-hold').value) || 45));

    job.scoringConfig = {
      weights,
      thresholds: { advance, hold },
      mustHaveGate: container.querySelector('#sce-gate-musthave').checked,
      mustHaveCap: Math.max(0, Math.min(69, parseInt(container.querySelector('#sce-gate-cap').value) || 48)),
      customCriteria,
    };
    saveStateToLocalStorage();
    renderScoringEditor(job, container);
    const { showPremiumToast } = await import('./sourcing.js');
    showPremiumToast('Scoring config saved — next analyses will use it.', 'success');
    soundEngine.playChime([523.25, 659.25, 783.99], 0.12, 0.08);
  });
}

export {
  DEFAULT_SCORING_CONFIG,
  SCORING_DIMENSIONS,
  computeWeightedScore,
  getActiveWeights,
  getScoringConfig,
  recommendationFromScore,
  renderScoringEditor,
};
