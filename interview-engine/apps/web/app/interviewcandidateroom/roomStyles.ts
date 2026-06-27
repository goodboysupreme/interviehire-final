// Styles for the AI Interview Room. Ported verbatim from mockups/interview-page.html
// and extended with the permission gate, live-integrity pill, and live candidate webcam.
export const roomStyles = `
  .room, .room * { box-sizing: border-box; }

  .room {
    --bg: #08090d;
    --panel: #11131a;
    --line: rgba(255, 255, 255, .1);
    --muted: #94a3b8;
    --lime: #d4ff00;
    --orange: #f95738;
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #fff;
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    background:
      radial-gradient(circle at 0 0, rgba(249, 87, 56, .20), transparent 28%),
      radial-gradient(circle at 100% 45%, rgba(212, 255, 0, .08), transparent 26%),
      #08090d;
  }

  .room button { font: inherit; }

  .topbar {
    position: relative;
    z-index: 10;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 24px;
    height: 104px;
    padding: 0 38px;
  }

  .brand, .connection, .job-pill, .identity, .status-pill, .you-pill {
    display: flex;
    align-items: center;
  }

  .brand { gap: 14px; }

  .logo {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border-radius: 999px;
    background: linear-gradient(135deg, #f95738, #8b1d13);
    box-shadow: 0 0 40px rgba(249, 87, 56, .28);
    font: 900 18px Manrope, sans-serif;
  }

  .brand-name { font: 800 22px Manrope, sans-serif; letter-spacing: -.03em; }
  .brand-name span { color: var(--orange); }

  .room-label {
    margin-left: 24px;
    color: #8ba0c7;
    font: 600 12px Manrope, sans-serif;
    letter-spacing: .35em;
    text-transform: uppercase;
  }

  .job-pill {
    gap: 14px;
    min-width: 418px;
    justify-content: center;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(255, 255, 255, .045);
    padding: 10px 20px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .03);
  }

  .live-dot {
    width: 8px; height: 8px; border-radius: 999px;
    background: var(--lime);
    box-shadow: 0 0 18px rgba(212, 255, 0, .85);
  }

  .job-pill strong { font: 700 17px Manrope, sans-serif; }
  .job-pill span { color: #74829b; font-size: 12px; letter-spacing: .28em; text-transform: uppercase; }

  .connection { justify-content: flex-end; gap: 18px; }

  .integrity {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border-radius: 999px;
    padding: 7px 13px;
    font: 700 12px Manrope, sans-serif;
    letter-spacing: .04em;
    text-transform: capitalize;
    border: 1px solid transparent;
  }
  .integrity.ok { color: var(--lime); border-color: rgba(212,255,0,.3); background: rgba(212,255,0,.08); }
  .integrity.warn { color: #fbbf24; border-color: rgba(251,191,36,.35); background: rgba(251,191,36,.1); }
  .integrity.alert { color: var(--orange); border-color: rgba(249,87,56,.45); background: rgba(249,87,56,.14); }

  .bars {
    display: inline-grid;
    grid-template-columns: repeat(4, 3px);
    align-items: end;
    gap: 3px;
    height: 17px;
  }
  .bars i { display: block; width: 3px; border-radius: 999px; background: var(--lime); }
  .bars i:nth-child(1) { height: 5px; }
  .bars i:nth-child(2) { height: 8px; }
  .bars i:nth-child(3) { height: 12px; }
  .bars i:nth-child(4) { height: 16px; }

  .connection-text { color: #cbd5e1; font-size: 14px; }

  .timer {
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(255, 255, 255, .04);
    padding: 10px 14px;
    font: 700 14px Manrope, sans-serif;
  }

  .content {
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template-columns: minmax(0, 1.9fr) minmax(420px, 1fr);
    gap: 30px;
    padding: 12px 30px 30px;
  }

  .avatar-panel, .candidate-panel, .question-card {
    border: 1px solid var(--line);
    background: var(--panel);
    box-shadow: 0 24px 90px rgba(0, 0, 0, .28);
  }

  .avatar-panel { position: relative; min-height: 0; overflow: hidden; border-radius: 30px; }

  .pixel-frame {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    border: 0; background: #020617;
  }

  .avatar-overlay {
    pointer-events: none;
    position: absolute; inset: 0; z-index: 2;
    background: linear-gradient(to top, rgba(0, 0, 0, .72), transparent 38%, rgba(0, 0, 0, .20));
  }

  .identity { position: absolute; z-index: 3; top: 30px; left: 30px; gap: 14px; }

  .identity-icon {
    display: grid; width: 50px; height: 50px; place-items: center;
    border: 1px solid rgba(255, 255, 255, .13);
    border-radius: 999px;
    background: rgba(255, 255, 255, .08);
    color: var(--orange);
    font: 900 20px Manrope, sans-serif;
    backdrop-filter: blur(18px);
  }

  .identity strong { display: block; font: 700 18px Manrope, sans-serif; }
  .identity span { display: block; color: #cbd5e1; font-size: 12px; letter-spacing: .28em; text-transform: uppercase; }

  .status-pill {
    position: absolute; z-index: 3; top: 30px; right: 30px; gap: 10px;
    border: 1px solid rgba(255, 255, 255, .1);
    border-radius: 999px;
    background: rgba(0, 0, 0, .46);
    padding: 10px 14px;
    color: rgba(255, 255, 255, .82);
    font-size: 12px; letter-spacing: .25em; text-transform: uppercase;
    backdrop-filter: blur(18px);
  }

  .red-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--orange); }

  .listen-card {
    position: absolute; z-index: 3; right: 30px; bottom: 30px; left: 30px;
    display: flex; align-items: center; justify-content: space-between; gap: 18px;
    border: 1px solid rgba(255, 255, 255, .1);
    border-radius: 18px;
    background: rgba(0, 0, 0, .58);
    padding: 18px 28px;
    backdrop-filter: blur(24px);
  }

  .wave { display: flex; align-items: center; gap: 4px; }
  .wave i { width: 4px; height: 4px; border-radius: 999px; background: var(--orange); animation: pulse 1s infinite ease-in-out; }
  .wave i:nth-child(2) { animation-delay: .08s; }
  .wave i:nth-child(3) { animation-delay: .16s; }
  .wave i:nth-child(4) { animation-delay: .24s; }
  .wave i:nth-child(5) { animation-delay: .32s; }
  .wave i:nth-child(6) { animation-delay: .40s; }

  @keyframes pulse { 50% { height: 14px; } }

  .listen-copy strong { display: block; font: 700 15px Manrope, sans-serif; }
  .listen-copy span, .hd-audio { color: #94a3b8; font-size: 12px; }
  .listen-copy span { display: block; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .hd-audio { display: flex; flex: 0 0 auto; align-items: center; gap: 10px; letter-spacing: .28em; text-transform: uppercase; }
  .hd-audio i { width: 7px; height: 7px; border-radius: 999px; background: var(--lime); }

  .right-stack { display: grid; min-height: 0; grid-template-rows: auto minmax(0, 1fr); gap: 30px; }

  .candidate-panel {
    position: relative; min-height: 340px; overflow: hidden; border-radius: 20px;
    background: #020617;
  }

  /* Candidate self-view as a Google-Meet-style mini window pinned to the
     bottom-right of Lina's avatar panel. */
  .candidate-panel.candidate-pip {
    position: absolute; z-index: 4;
    right: 24px; bottom: 24px;
    width: clamp(200px, 20vw, 280px);
    height: auto; min-height: 0; aspect-ratio: 16 / 10;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, .18);
    box-shadow: 0 18px 50px rgba(0, 0, 0, .55);
  }
  .candidate-pip .you-pill { top: 10px; left: 10px; padding: 5px 11px; font-size: 11px; }
  .candidate-pip .candidate-footer { padding: 12px; }
  .candidate-pip .mini-bars { height: 20px; }
  .candidate-pip .mini-bars i:nth-child(1) { height: 9px; }
  .candidate-pip .mini-bars i:nth-child(2) { height: 15px; }
  .candidate-pip .mini-bars i:nth-child(3) { height: 19px; }
  .candidate-pip .mini-bars i:nth-child(4) { height: 12px; }
  .candidate-pip .mini-bars i:nth-child(5) { height: 16px; }
  .candidate-pip .mic { width: 30px; height: 30px; font-size: 13px; }

  /* Right panel: live feed of only Lina's questions (interviewer transcript). */
  .lina-transcript {
    display: flex; flex-direction: column; min-height: 0; overflow: hidden;
    border: 1px solid var(--line); border-radius: 20px;
    background: var(--panel); box-shadow: 0 24px 90px rgba(0, 0, 0, .28);
  }
  .lina-transcript-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    padding: 18px 24px; border-bottom: 1px solid rgba(255, 255, 255, .07);
  }
  .lina-transcript-title { font: 800 16px Manrope, sans-serif; letter-spacing: -.02em; }
  .lina-transcript-sub { color: #778195; font-size: 11px; letter-spacing: .24em; text-transform: uppercase; }
  .lina-transcript-body { display: flex; flex-direction: column; gap: 14px; padding: 18px 24px; overflow-y: auto; }
  .lina-transcript-empty { margin: 0; color: #64748b; font-size: 13px; line-height: 1.6; }
  .lina-line { display: grid; gap: 7px; }
  .lina-line-badge {
    justify-self: start;
    border: 1px solid rgba(249, 87, 56, .4); border-radius: 999px; color: var(--orange);
    padding: 3px 10px; font-size: 10px; font-weight: 800; letter-spacing: .22em; text-transform: uppercase;
  }
  .lina-line p { margin: 0; color: #dbe4f3; font-size: 14px; line-height: 1.55; }

  .candidate-video {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; transform: scaleX(-1);
    transition: opacity .25s ease;
  }

  .cam-off {
    position: absolute; inset: 0; z-index: 2; display: grid; place-items: center;
    color: #64748b; font: 600 13px Manrope, sans-serif; letter-spacing: .2em; text-transform: uppercase;
  }

  .you-pill {
    position: absolute; z-index: 3; top: 16px; left: 16px; gap: 9px;
    border-radius: 999px; background: rgba(0, 0, 0, .48); padding: 7px 14px;
    color: #e5e7eb; font-size: 12px; letter-spacing: .22em; text-transform: uppercase;
  }
  .you-pill i { width: 8px; height: 8px; border-radius: 999px; background: var(--lime); }

  .candidate-footer {
    position: absolute; right: 0; bottom: 0; left: 0; z-index: 3;
    display: flex; align-items: end; justify-content: space-between; padding: 18px;
    background: linear-gradient(to top, rgba(0, 0, 0, .58), transparent);
  }

  .mini-bars { display: grid; grid-template-columns: repeat(5, 3px); align-items: end; gap: 4px; height: 30px; }
  .mini-bars i { width: 3px; background: #cbd5e1; }
  .mini-bars i:nth-child(1) { height: 13px; }
  .mini-bars i:nth-child(2) { height: 22px; }
  .mini-bars i:nth-child(3) { height: 28px; }
  .mini-bars i:nth-child(4) { height: 18px; }
  .mini-bars i:nth-child(5) { height: 24px; }

  .mic { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 999px; background: rgba(0, 0, 0, .55); }

  .question-card { border-radius: 20px; padding: 24px 34px; }
  .question-top { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
  .question-card h2 { margin: 0; font: 800 clamp(22px, 2vw, 29px) Manrope, sans-serif; line-height: 1.3; letter-spacing: -.04em; }
  .question-meta { color: #778195; font-size: 12px; letter-spacing: .28em; text-transform: uppercase; margin-top: 10px; }

  .tag {
    border: 1px solid rgba(249, 87, 56, .4); border-radius: 999px; color: var(--orange);
    padding: 7px 13px; font-size: 12px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase;
    white-space: nowrap;
  }

  .question-card p { margin: 20px 0 0; border-top: 1px solid rgba(255, 255, 255, .07); padding-top: 18px; color: #94a3b8; font-size: 15px; }
  .question-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px; }

  .circle-btn, .next-btn { border: 1px solid rgba(255, 255, 255, .08); color: #fff; cursor: pointer; }
  .circle-btn { width: 46px; height: 46px; border-radius: 999px; background: rgba(255, 255, 255, .03); }
  .circle-btn:disabled { opacity: .35; cursor: not-allowed; }
  .next-btn { border-color: rgba(249, 87, 56, .42); border-radius: 999px; background: rgba(249, 87, 56, .18); padding: 0 24px; color: var(--orange); font-weight: 800; letter-spacing: .08em; }

  .controlbar {
    display: flex; height: 78px; align-items: center; justify-content: space-between;
    border-top: 1px solid rgba(255, 255, 255, .05);
    background: rgba(0, 0, 0, .38);
    padding: 0 180px 0 32px;
    backdrop-filter: blur(18px);
  }

  .control-time { display: flex; align-items: center; gap: 12px; color: #fff; font: 700 14px Manrope, sans-serif; }
  .elapsed-label { color: #64748b; font-size: 11px; letter-spacing: .24em; text-transform: uppercase; }

  .control-actions { display: flex; align-items: center; gap: 12px; }
  .control-actions button {
    width: 50px; height: 50px; border: 1px solid rgba(255, 255, 255, .14); border-radius: 999px;
    background: rgba(255, 255, 255, .06); color: #fff; cursor: pointer; font-size: 18px;
  }
  .control-actions button.muted { background: rgba(249, 87, 56, .14); border-color: rgba(249,87,56,.4); color: var(--orange); }
  .control-actions .end { width: 58px; background: rgba(249, 87, 56, .2); color: var(--orange); }

  /* ===== Pre-interview permission gate ===== */
  .gate {
    position: fixed; inset: 0; z-index: 9999;
    display: grid; place-items: center;
    background: #0a0f1a; padding: 24px;
    color: #e2e8f0; font-family: "IBM Plex Sans", system-ui, sans-serif;
  }
  .gate-card { width: 100%; max-width: 560px; }
  .gate-eyebrow { margin: 0; color: #67e8f9; font-size: 12px; letter-spacing: .35em; text-transform: uppercase; text-align: center; }
  .gate-title { margin: 18px 0 0; font: 900 30px Manrope, sans-serif; text-align: center; }
  .gate-sub { margin: 12px 0 0; color: #94a3b8; font-size: 14px; line-height: 1.6; text-align: center; }
  .gate-checks { margin-top: 28px; display: grid; gap: 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 18px; background: rgba(255,255,255,.04); padding: 16px; }
  .gate-check { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-radius: 14px; background: rgba(2,6,23,.7); padding: 14px 16px; }
  .gate-check-l { display: flex; align-items: center; gap: 12px; }
  .gate-check-label { margin: 0; font-size: 14px; font-weight: 600; }
  .gate-check-detail { margin: 2px 0 0; font-size: 12px; color: #94a3b8; }
  .ok-ico { color: #6ee7b7; }
  .wait-ico { color: #67e8f9; }
  .gate-dot { width: 10px; height: 10px; border-radius: 999px; }
  .gate-dot.is-ok { background: #34d399; }
  .gate-dot.is-wait { background: #fbbf24; }
  .gate-btn {
    margin-top: 24px; width: 100%;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: 0; border-radius: 14px; background: #67e8f9; color: #020617;
    padding: 14px; font: 800 14px Manrope, sans-serif; cursor: pointer;
    box-shadow: 0 0 40px rgba(103,232,249,.18);
  }
  .gate-error { margin-top: 16px; text-align: center; font-size: 14px; color: #fecdd3; }

  /* ===== Proctoring debug overlay ===== */
  .debug-toggle {
    margin-left: 14px;
    border: 1px solid rgba(255,255,255,.16);
    border-radius: 999px;
    background: rgba(255,255,255,.05);
    color: #cbd5e1;
    padding: 5px 12px;
    font: 700 11px Manrope, sans-serif;
    letter-spacing: .08em;
    cursor: pointer;
  }
  .debug-toggle:hover { background: rgba(255,255,255,.1); color: #fff; }

  .debug-panel {
    position: fixed;
    top: 16px;
    right: 16px;
    bottom: 16px;
    z-index: 9998;
    width: 380px;
    max-width: calc(100vw - 32px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid rgba(212,255,0,.25);
    border-radius: 18px;
    background: rgba(8,9,13,.94);
    box-shadow: 0 30px 90px rgba(0,0,0,.6);
    padding: 16px;
    overflow: auto;
    backdrop-filter: blur(20px);
    font-family: "IBM Plex Sans", system-ui, sans-serif;
  }
  .debug-head { display: flex; align-items: center; justify-content: space-between; }
  .debug-head strong { font: 800 14px Manrope, sans-serif; color: #d4ff00; letter-spacing: .04em; }
  .debug-head button { border: 0; background: rgba(255,255,255,.08); color: #fff; width: 26px; height: 26px; border-radius: 8px; cursor: pointer; }
  .debug-section-title { margin-top: 6px; color: #74829b; font: 700 10px Manrope, sans-serif; letter-spacing: .26em; text-transform: uppercase; }
  .debug-grid { display: grid; gap: 4px; }
  .debug-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-radius: 8px; background: rgba(255,255,255,.03); padding: 6px 10px; }
  .debug-row-k { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #cbd5e1; }
  .debug-row-v { font: 600 11px "IBM Plex Sans", monospace; color: #fff; text-align: right; word-break: break-word; max-width: 200px; }
  .debug-dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; }
  .debug-dot.is-ok { background: #34d399; }
  .debug-dot.is-bad { background: #f95738; }
  .debug-events { display: grid; gap: 6px; }
  .debug-event { border-radius: 8px; border-left: 3px solid #64748b; background: rgba(255,255,255,.03); padding: 7px 10px; }
  .debug-event.sev-high, .debug-event.sev-critical { border-left-color: #f95738; }
  .debug-event.sev-medium { border-left-color: #fbbf24; }
  .debug-event.sev-low { border-left-color: #34d399; }
  .debug-event-type { display: inline-block; font: 700 11px Manrope, sans-serif; color: #fff; }
  .debug-event-sev { float: right; font-size: 10px; color: #94a3b8; letter-spacing: .1em; }
  .debug-event-meta { margin: 4px 0 0; font-size: 10px; color: #64748b; white-space: pre-wrap; word-break: break-word; }
  .debug-empty { color: #64748b; font-size: 12px; margin: 4px 0; }
  .debug-foot { margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.08); color: #64748b; font-size: 11px; }

  @media (max-width: 1100px) {
    .room { position: absolute; height: auto; min-height: 100vh; overflow: visible; }
    .topbar, .content { grid-template-columns: 1fr; }
    .connection { justify-content: flex-start; flex-wrap: wrap; }
    .avatar-panel { min-height: 620px; }
    .controlbar { padding-right: 32px; }
  }
`;
