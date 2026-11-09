/** The screen's own styles, inside its shadow root: the app's CSS cannot break it and it cannot break the app's.
 * Change the look with CSS variables on any parent, for example `:root { --rivium-accent: #e11d48 }`. */
export const STYLES = `
:host {
  all: initial; display: block;
  --accent: var(--rivium-accent, #1f6feb);
  --on-accent: var(--rivium-on-accent, #fff);
  --bg: var(--rivium-bg, #fff);
  --fg: var(--rivium-fg, #1b1f24);
  --muted: var(--rivium-muted, #57606a);
  --line: var(--rivium-line, #d0d7de);
  --error-bg: var(--rivium-error-bg, #ffebe9);
  --error-fg: var(--rivium-error-fg, #82071e);
  --radius: var(--rivium-radius, 8px);
}
.rivium {
  font: 15px/1.5 var(--rivium-font, system-ui, -apple-system, "Segoe UI", Tahoma, Arial, sans-serif);
  color: var(--fg); background: var(--bg);
  box-sizing: border-box; width: 100%; max-width: 400px; margin: 0 auto; padding: 24px;
}
@media (prefers-color-scheme: dark) {
  :host(:not([data-theme="light"])) {
    --bg: var(--rivium-bg, #161b22); --fg: var(--rivium-fg, #e6edf3); --muted: var(--rivium-muted, #8b949e);
    --line: var(--rivium-line, #30363d); --error-bg: var(--rivium-error-bg, #3d1214); --error-fg: var(--rivium-error-fg, #ffa198);
  }
}
.rivium * { box-sizing: border-box; font: inherit; }
.head { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 20px; position: relative; }
.back { position: absolute; inset-inline-start: 0; top: 0; border: 0; background: none; color: var(--fg); cursor: pointer; font-size: 20px; padding: 4px 8px; border-radius: var(--radius); }
.logo { max-height: 48px; max-width: 160px; }
.title { margin: 0; font-size: 22px; font-weight: 600; text-align: center; padding: 0 32px; }
form { display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.label { font-size: 13px; color: var(--muted); }
input { width: 100%; height: 44px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius); background: transparent; color: var(--fg); }
input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
input[aria-invalid="true"] { border-color: var(--error-fg); }
.field-error { font-size: 13px; color: var(--error-fg); }
.error { background: var(--error-bg); color: var(--error-fg); padding: 10px 12px; border-radius: var(--radius); margin-bottom: 12px; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: .6; }
.primary { height: 46px; border: 0; border-radius: var(--radius); background: var(--accent); color: var(--on-accent); font-weight: 600; display: flex; align-items: center; justify-content: center; }
.link { border: 0; background: none; color: var(--accent); padding: 6px 0; }
.end { display: flex; justify-content: flex-end; margin-top: -6px; }
.methods { display: flex; flex-direction: column; gap: 10px; }
.method { height: 46px; border: 1px solid var(--line); border-radius: var(--radius); background: transparent; color: var(--fg); display: flex; align-items: center; justify-content: center; gap: 10px; }
.icon { font-weight: 700; min-width: 1em; text-align: center; }
.or { display: flex; align-items: center; gap: 12px; color: var(--muted); margin: 16px 0; }
.or::before, .or::after { content: ""; flex: 1; border-top: 1px solid var(--line); }
.center { text-align: center; }
a { color: var(--accent); word-break: break-all; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.loading { display: flex; justify-content: center; padding: 40px 0; }
.spinner { width: 18px; height: 18px; border: 2px solid currentColor; border-inline-end-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
.spinner.big { width: 32px; height: 32px; color: var(--accent); }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }
dialog { border: 0; padding: 0; border-radius: 12px; width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 32px); background: transparent; overflow: auto; }
dialog::backdrop { background: rgba(0, 0, 0, .45); }
.dialog-inner { color: var(--fg); position: relative; background: var(--bg); border-radius: 12px; }
.close { position: absolute; inset-inline-end: 8px; top: 8px; z-index: 1; border: 0; background: none; color: var(--fg); font-size: 20px; padding: 4px 10px; border-radius: var(--radius); }
@media (max-width: 599px) {
  dialog { width: 100vw; height: 100dvh; max-width: none; max-height: none; border-radius: 0; margin: 0; }
  .dialog-inner { min-height: 100dvh; border-radius: 0; padding-top: 32px; }
}
`;
