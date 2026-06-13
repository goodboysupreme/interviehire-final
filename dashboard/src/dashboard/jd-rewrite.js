import { document, requestAnimationFrame, setTimeout } from './runtime.js';
import { escapeHTML } from './escape.js';

// Reusable "review an AI rewrite before it replaces your text" modal.
// AI suggests, the human disposes: the suggestion is editable and must be
// explicitly accepted; discarding leaves the original untouched. Replaces the
// previous silent-overwrite behaviour of Optimize / Enhance. Resolves to the
// accepted text, or null if discarded or dismissed.
export function reviewJdRewrite({ title = 'AI Suggestion', original = '', suggested = '' }) {
  injectStyles();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'jd-rw-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.innerHTML = `
      <div class="jd-rw-modal" role="document">
        <div class="jd-rw-head">
          <h3 class="jd-rw-title">${escapeHTML(title)}</h3>
          <span class="jd-rw-pill">✦ AI suggested</span>
          <button type="button" class="jd-rw-x" aria-label="Discard suggestion">×</button>
        </div>
        <p class="jd-rw-hint">Review the rewrite — edit it if you like, then Accept. Your original stays untouched until you do.</p>
        <div class="jd-rw-grid">
          <div class="jd-rw-col">
            <span class="jd-rw-col-label">Current</span>
            <div class="jd-rw-current">${escapeHTML(original) || '<em style="opacity:.5">(empty)</em>'}</div>
          </div>
          <div class="jd-rw-col">
            <span class="jd-rw-col-label jd-rw-col-label--ai">AI suggestion</span>
            <textarea class="jd-rw-suggestion" spellcheck="false">${escapeHTML(suggested)}</textarea>
          </div>
        </div>
        <div class="jd-rw-actions">
          <button type="button" class="jd-rw-discard">Discard</button>
          <button type="button" class="jd-rw-accept">Accept suggestion</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const modal = overlay.querySelector('.jd-rw-modal');
    const suggestionInput = overlay.querySelector('.jd-rw-suggestion');
    const focusables = () => Array.from(modal.querySelectorAll('button, textarea')).filter(el => !el.disabled);

    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 200);
      resolve(value);
    };

    overlay.querySelector('.jd-rw-accept').addEventListener('click', () => close(suggestionInput.value.trim()));
    overlay.querySelector('.jd-rw-discard').addEventListener('click', () => close(null));
    overlay.querySelector('.jd-rw-x').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

    // Esc to dismiss + focus trap (the enhance/modal a11y gap flagged in review).
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); return; }
      if (e.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    requestAnimationFrame(() => {
      overlay.classList.add('open');
      suggestionInput.focus();
      suggestionInput.setSelectionRange(0, 0);
    });
  });
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'jd-rw-styles';
  style.textContent = `
    .jd-rw-overlay {
      position: fixed; inset: 0; z-index: 2000;
      display: flex; align-items: center; justify-content: center; padding: 24px;
      background: rgba(2, 6, 23, 0.62); backdrop-filter: blur(6px);
      opacity: 0; transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .jd-rw-overlay.open { opacity: 1; }
    .jd-rw-modal {
      width: min(960px, 100%); max-height: 86vh; display: flex; flex-direction: column;
      background: var(--glass-bg, rgba(17, 24, 39, 0.92));
      border: 1px solid var(--glass-border, rgba(148, 163, 184, 0.18));
      border-radius: 16px; padding: 22px 24px; box-shadow: 0 24px 60px rgba(0,0,0,0.5);
      transform: translateY(8px) scale(0.99); transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .jd-rw-overlay.open .jd-rw-modal { transform: none; }
    .jd-rw-head { display: flex; align-items: center; gap: 10px; }
    .jd-rw-title { margin: 0; font-size: 1.05rem; font-weight: 650; color: var(--color-text-primary, #f1f5f9); }
    .jd-rw-pill {
      font-size: 0.6rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
      padding: 3px 8px; border-radius: 6px; color: #2dd4bf;
      background: rgba(45, 212, 191, 0.12); border: 1px solid rgba(45, 212, 191, 0.32);
    }
    .jd-rw-x {
      margin-left: auto; width: 30px; height: 30px; border-radius: 8px; cursor: pointer;
      background: transparent; border: 1px solid var(--glass-border, rgba(148,163,184,0.2));
      color: var(--color-text-faint, #94a3b8); font-size: 1.1rem; line-height: 1;
      transition: background 150ms, color 150ms;
    }
    .jd-rw-x:hover { background: rgba(239, 68, 68, 0.12); color: #f87171; border-color: rgba(239,68,68,0.3); }
    .jd-rw-hint { margin: 8px 0 14px; font-size: 0.8rem; color: var(--color-text-faint, #94a3b8); }
    .jd-rw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; min-height: 0; flex: 1; }
    .jd-rw-col { display: flex; flex-direction: column; min-height: 0; }
    .jd-rw-col-label {
      font-size: 0.65rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
      color: var(--color-text-faint, #94a3b8); margin-bottom: 6px;
    }
    .jd-rw-col-label--ai { color: #2dd4bf; }
    .jd-rw-current, .jd-rw-suggestion {
      flex: 1; overflow: auto; border-radius: 10px; padding: 12px 14px; font-size: 0.86rem;
      line-height: 1.6; white-space: pre-wrap; color: var(--color-text-primary, #e2e8f0);
      background: rgba(148, 163, 184, 0.06); border: 1px solid var(--glass-border, rgba(148,163,184,0.16));
    }
    .jd-rw-current { opacity: 0.78; }
    .jd-rw-suggestion {
      resize: none; font-family: inherit;
      border-color: rgba(45, 212, 191, 0.4); box-shadow: 0 0 0 1px rgba(45, 212, 191, 0.12) inset;
    }
    .jd-rw-suggestion:focus { outline: none; border-color: rgba(45, 212, 191, 0.7); }
    .jd-rw-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
    .jd-rw-discard, .jd-rw-accept {
      padding: 9px 18px; border-radius: 9px; font-size: 0.82rem; font-weight: 600; cursor: pointer;
      transition: transform 120ms, background 150ms, border-color 150ms;
    }
    .jd-rw-discard {
      background: transparent; color: var(--color-text-faint, #94a3b8);
      border: 1px solid var(--glass-border, rgba(148,163,184,0.22));
    }
    .jd-rw-discard:hover { color: var(--color-text-primary, #e2e8f0); border-color: rgba(148,163,184,0.4); }
    .jd-rw-accept {
      background: rgba(45, 212, 191, 0.16); color: #5eead4; border: 1px solid rgba(45, 212, 191, 0.4);
    }
    .jd-rw-accept:hover { background: rgba(45, 212, 191, 0.26); transform: translateY(-1px); }
    @media (max-width: 720px) { .jd-rw-grid { grid-template-columns: 1fr; } }
    @media (prefers-reduced-motion: reduce) {
      .jd-rw-overlay, .jd-rw-modal, .jd-rw-accept { transition: none; }
    }
  `;
  document.head.appendChild(style);
}
