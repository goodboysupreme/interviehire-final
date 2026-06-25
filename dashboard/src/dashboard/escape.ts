// Shared HTML-escaping helper. Every module that interpolates user-supplied or
// AI-generated text into an innerHTML template literal MUST run it through this
// first — resume/CSV content and LLM output are untrusted and persist in
// localStorage, so an unescaped value is stored XSS.
export function escapeHTML(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Friendly labels for the pipeline "Source" column — how a candidate entered the
// pipeline (the backend `entry_method`, reusing ApplicantSource tokens). Stage-routing
// values (`scheduled` / `functional`) and `null` are intentionally NOT keys, so they
// fall through to "—" rather than leaking an internal routing value into the UI.
export const SOURCE_LABELS: Record<string, string> = {
  bulk_upload: 'Bulk Upload',
  ats: 'ATS',
  direct_link: 'Direct',
  career_page: 'Career Page',
};

// Map an entry-method token to its display label; anything unknown/empty → "—".
export function sourceLabel(method: any) {
  return SOURCE_LABELS[method] || '—';
}
