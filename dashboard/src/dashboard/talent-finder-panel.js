// Talent Finder — in-dashboard job-role panel (compliant AI sourcing).
// Renders into #jd-pane-talent, auto-extracts the brief from the job's JD +
// blueprint, and reuses the dashboard's authed fetch + theme.
import { request, API_BASE } from '../auth-client.js';
import { escapeHTML } from './escape.js';

let _styleInjected = false;
let CSV_ROWS = [];
let LAST_RESULTS = [];
let LAST_BRIEF = {};
let CURRENT_JOB = null;

function injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  // Matches the dashboard's gold + crimson glass theme (uses its CSS variables).
  const css = `
  #jd-pane-talent{--tf-gold:var(--accent-cyan,#d4af37);--tf-gold2:var(--accent-purple,#ffc72c);--tf-red:var(--accent-indigo,#ff0d3f);
    --tf-text:var(--color-text,var(--text-primary,#e8e8e8));--tf-muted:var(--color-text-muted,var(--text-muted,#9a9a9a));
    --tf-surface:var(--glass-bg,rgba(255,255,255,.04));--tf-line:var(--glass-border,rgba(255,255,255,.08));
    --tf-grad:var(--grad-primary,linear-gradient(135deg,#d4af37 0%,#ff0d3f 50%,#ffc72c 100%))}
  .tf-wrap{display:grid;grid-template-columns:320px 1fr;gap:16px;color:var(--tf-text)}
  @media(max-width:980px){.tf-wrap{grid-template-columns:1fr}}
  .tf-card{background:var(--tf-surface);border:1px solid var(--tf-line);border-radius:14px;padding:16px;margin-bottom:14px}
  .tf-card h4{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--tf-muted)}
  .tf-lbl{display:block;font-size:11px;color:var(--tf-muted);margin:9px 0 4px}
  .tf-in{width:100%;background:var(--color-surface-2,rgba(255,255,255,.03));border:1px solid var(--tf-line);border-radius:9px;color:var(--tf-text);padding:8px 10px;font:inherit;outline:none}
  .tf-in:focus{border-color:var(--color-gold-border,rgba(212,175,55,.4))}
  textarea.tf-in{resize:vertical;min-height:54px}
  .tf-row{display:flex;gap:8px}.tf-row>*{flex:1}
  .tf-btn{cursor:pointer;border:none;border-radius:10px;padding:10px 14px;font-weight:700;font-size:13px;background:var(--tf-grad);color:#1a1205}
  .tf-btn:disabled{opacity:.5;cursor:not-allowed}
  .tf-btn.ghost{background:var(--tf-surface);color:var(--tf-text);border:1px solid var(--tf-line)}
  .tf-btn.ghost:hover{border-color:var(--color-gold-border,rgba(212,175,55,.4))}
  .tf-btn.sm{padding:6px 10px;font-size:12px}
  .tf-src{display:flex;align-items:center;gap:8px;padding:7px 0;font-size:13px;border-bottom:1px dashed var(--tf-line)}
  .tf-src .meta{margin-left:auto;font-size:10px}
  .tf-pill{font-size:10px;font-weight:700;border-radius:999px;padding:2px 8px}
  .tf-pill.ok{background:rgba(212,175,55,.16);color:var(--tf-gold)}.tf-pill.no{background:rgba(255,13,63,.14);color:var(--tf-red)}
  .tf-table{width:100%;border-collapse:collapse;font-size:13px}
  .tf-table th,.tf-table td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--tf-line);vertical-align:top}
  .tf-table th{font-size:10px;text-transform:uppercase;color:var(--tf-muted)}
  .tf-table tr.row{cursor:pointer}.tf-table tr.row:hover{background:var(--glass-bg-hover,rgba(255,255,255,.06))}
  .tf-score{font-weight:800}.tf-strong{color:var(--tf-gold2)}.tf-good{color:var(--tf-gold)}.tf-mid{color:var(--text-secondary,#a3a39e)}.tf-weak{color:var(--tf-muted)}
  .tf-tag{display:inline-block;background:rgba(212,175,55,.12);color:var(--tf-gold);border-radius:6px;padding:1px 7px;margin:1px;font-size:11px}
  .tf-tag.miss{background:rgba(255,13,63,.12);color:var(--tf-red)}
  .tf-steps{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--tf-muted);margin-bottom:6px}
  .tf-step{padding:4px 10px;border-radius:999px;border:1px solid var(--tf-line)}.tf-step.done{color:var(--tf-gold);border-color:var(--color-gold-border,rgba(212,175,55,.4))}
  .tf-note{font-size:12px;color:var(--tf-muted);background:var(--color-surface-2,rgba(255,255,255,.03));border:1px solid var(--tf-line);border-radius:9px;padding:9px;margin-top:8px}
  .tf-drawer{position:fixed;top:0;right:0;height:100%;width:min(540px,96vw);background:var(--bg-dark,#07070a);border-left:1px solid var(--color-gold-border,rgba(212,175,55,.25));box-shadow:-20px 0 60px rgba(0,0,0,.6);padding:22px;overflow:auto;transform:translateX(110%);transition:transform .25s;z-index:9999;color:var(--tf-text)}
  .tf-drawer.open{transform:none}
  .tf-drawer .x{float:right;cursor:pointer;color:var(--tf-muted);font-size:20px}
  .tf-drawer h3{background:var(--grad-text,linear-gradient(135deg,#fff 30%,#ffd700));-webkit-background-clip:text;background-clip:text;color:transparent}
  .tf-kv{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed var(--tf-line);font-size:13px}
  .tf-bar{height:7px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:3px}.tf-bar>i{display:block;height:100%;background:var(--tf-grad)}
  .tf-flag{color:var(--tf-red);font-size:11px}.tf-muted{color:var(--tf-muted)}.tf-err{color:var(--tf-red)}
  .tf-stat{font-size:10px;font-weight:700;border-radius:999px;padding:2px 8px;white-space:nowrap;text-transform:capitalize}
  .tf-stat.new{background:rgba(255,255,255,.07);color:var(--tf-muted)}
  .tf-stat.shortlisted{background:rgba(212,175,55,.18);color:var(--tf-gold)}
  .tf-stat.rejected{background:rgba(255,13,63,.16);color:var(--tf-red)}
  .tf-stat.invited{background:rgba(99,102,241,.18);color:#8b8bff}
  tr.row.is-rejected{opacity:.45}
  .tf-toast-wrap{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:10001;display:flex;flex-direction:column;gap:8px;align-items:center}
  .tf-toast{background:var(--bg-dark,#0c0c12);border:1px solid var(--tf-line);border-left:3px solid var(--tf-gold);border-radius:10px;padding:11px 16px;font-size:13px;color:var(--tf-text);box-shadow:0 12px 40px rgba(0,0,0,.5);animation:tfslide .25s;max-width:420px}
  .tf-toast.ok{border-left-color:var(--tf-gold)}.tf-toast.err{border-left-color:var(--tf-red)}.tf-toast.info{border-left-color:#8b8bff}
  @keyframes tfslide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`;
  const el = document.createElement('style');
  el.id = 'tf-style';
  el.textContent = css;
  document.head.appendChild(el);
}

const list = (s) => (s || '').split(/[,\n;]/).map((x) => x.trim()).filter(Boolean);
const esc = (s) => escapeHTML(String(s == null ? '' : s));
const $ = (id) => document.getElementById(id);

function toast(msg, kind = 'ok') {
  let wrap = document.getElementById('tf-toasts');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'tf-toasts'; wrap.className = 'tf-toast-wrap'; document.body.appendChild(wrap); }
  const el = document.createElement('div');
  el.className = `tf-toast ${kind}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, 2600);
}

const statusPill = (s) => `<span class="tf-stat ${s || 'new'}">${esc(s || 'new')}</span>`;

// Reflect a candidate's recruiter status into LAST_RESULTS + the results row live.
function setStatus(i, status) {
  if (LAST_RESULTS[i]) LAST_RESULTS[i].result_status = status;
  const cell = $('tf-status-' + i);
  if (cell) cell.innerHTML = statusPill(status);
  const tr = document.querySelector(`#tf-results tr.row[data-i="${i}"]`);
  if (tr) tr.classList.toggle('is-rejected', status === 'rejected');
}

async function tfCsvUpload(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API_BASE}/talent-finder/import/csv`, { method: 'POST', credentials: 'include', body: fd });
  if (!res.ok) throw new Error('CSV import failed (' + res.status + ')');
  return res.json();
}

export async function renderTalentFinderPane(job) {
  injectStyle();
  CURRENT_JOB = job;
  const pane = $('jd-pane-talent');
  if (!pane) return;
  // Only build the shell once per job render.
  pane.innerHTML = `
    <div class="tf-wrap">
      <div>
        <div class="tf-card">
          <h4>Search brief <span class="tf-muted" id="tf-autofill" style="font-weight:400;text-transform:none;font-size:11px">· auto-filled from JD</span></h4>
          <label class="tf-lbl">Job title</label><input class="tf-in" id="tf-title"/>
          <label class="tf-lbl">Location (blank = any)</label><input class="tf-in" id="tf-location"/>
          <div class="tf-row"><div><label class="tf-lbl">Exp min</label><input class="tf-in" id="tf-expMin" type="number" min="0"/></div>
            <div><label class="tf-lbl">Exp max</label><input class="tf-in" id="tf-expMax" type="number" min="0"/></div></div>
          <label class="tf-lbl">Must-have skills</label><input class="tf-in" id="tf-must"/>
          <label class="tf-lbl">Good-to-have skills</label><input class="tf-in" id="tf-good"/>
          <label class="tf-lbl">Exclude keywords</label><input class="tf-in" id="tf-exclude"/>
          <div style="margin-top:12px;border-top:1px solid var(--tf-line);padding-top:10px">
            <label class="tf-lbl" style="margin-top:0;display:flex;align-items:center;gap:7px;cursor:pointer">
              <input type="checkbox" id="tf-intl"/> 🌍 Include international candidates
            </label>
            <div id="tf-intl-wrap" style="display:none">
              <label class="tf-lbl">Target countries (blank = top global markets)</label>
              <input class="tf-in" id="tf-countries" placeholder="United States, Canada, Germany, India"/>
            </div>
            <label class="tf-lbl" style="display:flex;align-items:center;gap:7px;cursor:pointer">
              <input type="checkbox" id="tf-student"/> 🎓 Students / recent grads focus
            </label>
          </div>
        </div>
        <div class="tf-card">
          <h4>Sources</h4>
          <div id="tf-sources" class="tf-muted">Loading…</div>
          <label class="tf-lbl" style="margin-top:10px">Manual paste (name or profile URL per line)</label>
          <textarea class="tf-in" id="tf-manual" placeholder="Asha Rao&#10;https://example.com/p/jdoe"></textarea>
          <label class="tf-lbl">Import CSV (recruiter export)</label>
          <input class="tf-in" id="tf-csv" type="file" accept=".csv"/>
          <div id="tf-csvnote" class="tf-note" style="display:none"></div>
          <button class="tf-btn" style="width:100%;margin-top:12px" id="tf-run">🔎 Find candidates</button>
        </div>
      </div>
      <div>
        <div class="tf-card" id="tf-progress" style="display:none"><h4>Progress</h4><div class="tf-steps" id="tf-steps"></div><div class="tf-note" id="tf-searchnote" style="display:none"></div></div>
        <div class="tf-card">
          <h4 style="display:flex;align-items:center">Results <span id="tf-rcount" class="tf-muted" style="margin-left:8px;font-weight:400;font-size:11px"></span>
            <button class="tf-btn ghost sm" id="tf-export" style="margin-left:auto;text-transform:none">⬇ Export CSV</button></h4>
          <div id="tf-results" class="tf-muted">Auto-filling the brief from this role's JD… then click “Find candidates”.</div>
        </div>
      </div>
    </div>
    <div class="tf-drawer" id="tf-drawer"><span class="x" id="tf-drawer-x">✕</span><div id="tf-drawer-body"></div></div>`;

  // events
  $('tf-run').onclick = runSearch;
  $('tf-export').onclick = exportCsv;
  $('tf-drawer-x').onclick = () => $('tf-drawer').classList.remove('open');
  $('tf-intl').onchange = (e) => { $('tf-intl-wrap').style.display = e.target.checked ? 'block' : 'none'; };
  $('tf-csv').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = await tfCsvUpload(f); CSV_ROWS = d.rows || [];
      const n = $('tf-csvnote'); n.style.display = 'block';
      n.textContent = `Imported ${d.imported} rows (${d.skipped} skipped) — included as “Uploaded CSV”.`;
    } catch (err) { const n = $('tf-csvnote'); n.style.display = 'block'; n.className = 'tf-note tf-err'; n.textContent = err.message; }
  };

  await Promise.all([loadSources(), autoFill(job)]);
}

async function autoFill(job) {
  try {
    const d = await request('/talent-finder/extract-brief', { method: 'POST', body: { jobRoleId: job && job.id } });
    const b = d.brief || {};
    $('tf-title').value = b.title || (job && (job.roleName || job.cardName)) || '';
    $('tf-location').value = b.location || (job && job.location) || '';
    if (b.experienceMin != null) $('tf-expMin').value = b.experienceMin;
    if (b.experienceMax != null) $('tf-expMax').value = b.experienceMax;
    $('tf-must').value = (b.mustHaveSkills || []).join(', ');
    $('tf-good').value = (b.goodToHaveSkills || []).join(', ');
    LAST_BRIEF._jd = b.jdText || '';
    $('tf-autofill').textContent = `· auto-filled (${(b.mustHaveSkills || []).length} must-have, ${(b.goodToHaveSkills || []).length} good-to-have skills)`;
    $('tf-results').textContent = 'Brief ready. Review/adjust, then click “Find candidates”.';
  } catch (e) {
    $('tf-autofill').textContent = '· (auto-fill unavailable — fill manually)';
  }
}

async function loadSources() {
  try {
    const d = await request('/talent-finder/sources');
    const def = ['internal_db', 'resume_db', 'manual_import', 'uploaded_csv', 'github', 'hackernews', 'web_search'];
    window._tfSources = d.sources || [];
    $('tf-sources').innerHTML = window._tfSources.map((s) => `
      <div class="tf-src">
        <input type="checkbox" id="tf-src-${s.source_type}" ${s.available ? '' : 'disabled'} ${(s.available && def.includes(s.source_type)) ? 'checked' : ''}/>
        <label for="tf-src-${s.source_type}" style="margin:0;color:${s.available ? 'inherit' : '#6b7a99'}">${esc(s.source_name)}</label>
        <span class="meta">${s.is_enabled ? '<span class="tf-pill ok">enabled</span>' : '<span class="tf-pill no">needs permission</span>'}</span>
      </div>`).join('');
  } catch (e) {
    $('tf-sources').innerHTML = '<span class="tf-err">Sign in to the dashboard first. ' + esc(e.message) + '</span>';
  }
}

function selectedSources() {
  return (window._tfSources || []).filter((s) => { const c = $('tf-src-' + s.source_type); return c && c.checked; }).map((s) => s.source_type);
}
function setSteps(active) {
  const order = ['searching', 'deduping', 'ranking', 'done'];
  const labels = { searching: 'Searching sources', deduping: 'Removing duplicates', ranking: 'Ranking', done: 'Done' };
  $('tf-steps').innerHTML = order.map((k) => `<span class="tf-step ${order.indexOf(k) <= order.indexOf(active) ? 'done' : ''}">${labels[k]}</span>`).join('');
}
function scoreClass(s) { return s >= 75 ? 'tf-strong' : s >= 55 ? 'tf-good' : s >= 40 ? 'tf-mid' : 'tf-weak'; }

async function runSearch() {
  const btn = $('tf-run'); btn.disabled = true;
  $('tf-progress').style.display = 'block'; setSteps('searching');
  const body = {
    jobRoleId: CURRENT_JOB && CURRENT_JOB.id, title: $('tf-title').value, location: $('tf-location').value,
    experienceRange: { min: parseFloat($('tf-expMin').value) || undefined, max: parseFloat($('tf-expMax').value) || undefined },
    mustHaveSkills: list($('tf-must').value), goodToHaveSkills: list($('tf-good').value),
    excludeKeywords: list($('tf-exclude').value), jdText: LAST_BRIEF._jd || '',
    sources: selectedSources(), maxCandidates: 50,
    csvRows: CSV_ROWS, manualProfiles: list($('tf-manual').value),
    includeInternational: $('tf-intl').checked, studentFocus: $('tf-student').checked,
    targetCountries: list($('tf-countries').value),
  };
  try {
    const r = await request('/talent-finder/search', { method: 'POST', body });
    setSteps('done');
    const note = $('tf-searchnote');
    const notes = Object.entries(r.source_notes || {}).filter(([, v]) => v && v !== 'ok');
    if (r.no_results_hint || notes.length) {
      note.style.display = 'block';
      note.innerHTML = (r.no_results_hint ? '<b>' + esc(r.no_results_hint) + '</b><br>' : '') + notes.map(([k, v]) => `<div class="tf-muted">• ${esc(k)}: ${esc(v)}</div>`).join('');
    } else note.style.display = 'none';
    await loadResults(r.searchId);
  } catch (e) {
    $('tf-results').innerHTML = '<span class="tf-err">Search failed: ' + esc(e.message) + '</span>'; setSteps('searching');
  }
  btn.disabled = false;
}

async function loadResults(searchId) {
  const d = await request('/talent-finder/search/' + searchId + '/results');
  LAST_RESULTS = d.results || []; LAST_BRIEF = Object.assign({}, d.brief, { _jd: LAST_BRIEF._jd });
  $('tf-rcount').textContent = '(' + d.count + ')';
  if (!LAST_RESULTS.length) { $('tf-results').innerHTML = '<span class="tf-muted">No candidates. Broaden location, reduce must-haves, or import a list.</span>'; return; }
  $('tf-results').innerHTML = `<table class="tf-table"><thead><tr>
    <th>Candidate</th><th>Role</th><th>Location</th><th>Exp</th><th>Source</th><th>Fit</th><th>Must</th><th>Risk</th><th>Status</th></tr></thead>
    <tbody>${LAST_RESULTS.map((c, i) => { const fb = c.fit_breakdown || {}; const mh = (fb.matchedMustHaves || []).length, mt = mh + (fb.missingMustHaves || []).length;
      return `<tr class="row ${c.result_status === 'rejected' ? 'is-rejected' : ''}" data-i="${i}">
        <td><b>${esc(c.full_name)}</b></td><td>${esc(c.current_title || '—')}</td><td>${esc(c.location || '—')}</td>
        <td>${c.years_of_experience == null ? '—' : c.years_of_experience}</td><td><span class="tf-tag">${esc(c.source_type || '')}</span></td>
        <td class="tf-score ${scoreClass(c.fit_score)}">${c.fit_score == null ? '—' : c.fit_score}</td>
        <td>${mh}/${mt || 0}</td><td class="tf-flag">${(c.risk_flags || []).length ? '⚠ ' + c.risk_flags.length : ''}</td>
        <td id="tf-status-${i}">${statusPill(c.result_status)}</td></tr>`; }).join('')}
    </tbody></table>`;
  $('tf-results').querySelectorAll('tr.row').forEach((tr) => tr.onclick = () => openDrawer(parseInt(tr.getAttribute('data-i'))));
}

function openDrawer(i) {
  const c = LAST_RESULTS[i]; const fb = c.fit_breakdown || {};
  const bars = [['Must-have', fb.mustHaveScore], ['Experience', fb.experienceScore], ['Title/semantic', fb.semanticScore], ['Location', fb.locationScore], ['Good-to-have', fb.goodToHaveScore]];
  $('tf-drawer-body').innerHTML = `
    <div class="tf-muted">Candidate</div><h3 style="margin:2px 0">${esc(c.full_name)}</h3>
    <div class="tf-muted">${esc(c.current_title || '')} ${c.current_company ? '· ' + esc(c.current_company) : ''} · ${esc(c.location || '')}</div>
    <div class="tf-kv"><span>Fit score</span><b class="${scoreClass(c.fit_score)}">${c.fit_score} (${esc(fb.recommendation || '')})</b></div>
    <div class="tf-card" style="margin-top:12px"><h4>Fit breakdown</h4>
      ${bars.map(([l, v]) => `<div style="margin:6px 0"><div class="tf-kv" style="border:0;padding:2px 0"><span>${l}</span><span>${v == null ? 0 : v}</span></div><div class="tf-bar"><i style="width:${Math.max(0, Math.min(100, v || 0))}%"></i></div></div>`).join('')}
      <div class="tf-kv"><span>Risk penalty</span><span class="tf-flag">-${fb.riskPenalty || 0}</span></div></div>
    <div class="tf-card"><h4>Skills</h4><div>
      ${(fb.matchedMustHaves || []).map((s) => `<span class="tf-tag">✓ ${esc(s)}</span>`).join('')}
      ${(fb.matchedGoodToHaves || []).map((s) => `<span class="tf-tag">+ ${esc(s)}</span>`).join('')}
      ${(fb.missingMustHaves || []).map((s) => `<span class="tf-tag miss">✕ ${esc(s)}</span>`).join('')}</div></div>
    ${(c.risk_flags || []).length ? `<div class="tf-note tf-flag">⚠ ${c.risk_flags.map(esc).join('<br>⚠ ')}</div>` : ''}
    <div class="tf-card"><h4>AI recommendation</h4><div>${esc(c.fit_reasoning || '')}</div></div>
    <div class="tf-card"><h4>Sources (transparency)</h4>${(c.sources || []).map((s) => `<div class="tf-kv"><span>${esc(s.source_name || s.source_type)}</span><span class="tf-pill ${s.source_permission_status === 'requires_permission' ? 'no' : 'ok'}">${esc(s.source_permission_status || '')}</span></div>`).join('') || '<span class="tf-muted">—</span>'}</div>
    <div class="tf-card"><h4>Outreach (draft — you approve before sending)</h4>
      <textarea class="tf-in" id="tf-out" placeholder="Click Generate…">${esc(c._outreach || '')}</textarea>
      <div class="tf-row" style="margin-top:8px"><button class="tf-btn sm" id="tf-gen">✨ Generate</button><button class="tf-btn ghost sm" id="tf-optout">Opt-out</button></div></div>
    <div class="tf-row" style="margin-top:6px">
      <button class="tf-btn sm" id="tf-short">★ Shortlist</button>
      <button class="tf-btn ghost sm" id="tf-reject">Reject</button>
      <button class="tf-btn ghost sm" id="tf-move">→ AI interview</button></div>`;
  $('tf-gen').onclick = (e) => {
    const b = e.currentTarget; b.disabled = true; const old = b.textContent; b.textContent = '✨ Generating…';
    act('/candidates/' + c.id + '/generate-outreach', { method: 'POST', body: { brief: LAST_BRIEF } },
      (d) => { $('tf-out').value = d.message; c._outreach = d.message; toast('Outreach draft generated — review before sending.'); },
      'Could not generate outreach')
      .finally(() => { b.disabled = false; b.textContent = old; });
  };
  $('tf-optout').onclick = () => act('/candidates/' + c.id + '/opt-out', { method: 'POST' },
    () => toast('Candidate opted out — they won\'t be contacted.', 'info'), 'Opt-out failed');
  $('tf-short').onclick = (e) => {
    const b = e.currentTarget; b.disabled = true;
    act('/candidates/' + c.id + '/shortlist', { method: 'POST' }, () => {
      setStatus(i, 'shortlisted'); b.textContent = '★ Shortlisted ✓';
      toast(`Shortlisted ${c.full_name}.`);
    }, 'Shortlist failed').then((ok) => { if (!ok) b.disabled = false; });
  };
  $('tf-reject').onclick = (e) => {
    const b = e.currentTarget; b.disabled = true;
    act('/candidates/' + c.id + '/reject', { method: 'POST' }, () => {
      setStatus(i, 'rejected'); toast(`Rejected ${c.full_name}.`, 'info');
      $('tf-drawer').classList.remove('open');
    }, 'Reject failed').then((ok) => { if (!ok) b.disabled = false; });
  };
  $('tf-move').onclick = (e) => {
    const jobId = CURRENT_JOB && CURRENT_JOB.id;
    if (!jobId) { toast('Open Talent Finder from a specific job to move candidates into its interview pipeline.', 'info'); return; }
    if (!c.email) { toast('This candidate has no email (public source). Import a permissioned profile or add contact details first.', 'err'); return; }
    const b = e.currentTarget; b.disabled = true;
    act('/candidates/' + c.id + '/move-to-pipeline', { method: 'POST', body: { jobId } }, () => {
      setStatus(i, 'invited'); b.textContent = '→ Moved ✓';
      toast(`${c.full_name} added to the interview pipeline.`);
    }, 'Could not move to pipeline').then((ok) => { if (!ok) b.disabled = false; });
  };
  $('tf-drawer').classList.add('open');
}

// Returns true on success, false on failure. Surfaces errors as toasts.
async function act(path, opts, after, errMsg) {
  try {
    const d = await request('/talent-finder' + path, opts);
    if (after) after(d);
    return true;
  } catch (e) {
    toast((errMsg ? errMsg + ': ' : '') + (e.message || 'Request failed'), 'err');
    return false;
  }
}

function exportCsv() {
  if (!LAST_RESULTS.length) return;
  const cols = ['full_name', 'current_title', 'current_company', 'location', 'years_of_experience', 'email', 'source_type', 'fit_score', 'source_permission_status'];
  const rows = [cols.join(',')].concat(LAST_RESULTS.map((c) => cols.map((k) => JSON.stringify(c[k] == null ? '' : c[k])).join(',')));
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'talent-finder.csv'; a.click();
}
