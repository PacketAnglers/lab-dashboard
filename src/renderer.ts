import * as vscode from 'vscode';
import * as crypto from 'crypto';
import MarkdownIt from 'markdown-it';

let _md: MarkdownIt | undefined;
function md(): MarkdownIt {
	if (_md) {
		return _md;
	}
	const m = new MarkdownIt({
		// html: true lets init_lab.py's authored markup through unsanitized
		// (<span style=...>, <details>, <kbd>, &nbsp;, ...). The trust
		// posture: LAB-READY.md is machine-written by init_lab.py inside a
		// workspace the user chose to open, and the backstops for a
		// poisoned file are (a) the CSP — script-src is nonce-only, which
		// also blocks inline event handlers and javascript: URIs — and
		// (b) the extension host's command allowlist. Raw HTML here cannot
		// execute; at worst it renders.
		html: true,
		linkify: true,
		breaks: false,
		typographer: false,
	});
	_md = m;
	return m;
}

/**
 * Render the dashboard markdown as a self-contained HTML document suitable for
 * a WebviewPanel. Intercepts clicks on `<a href="command:...">` links and
 * posts them back to the extension host for dispatch.
 *
 * v0.15.0: visual identity ported from PacketAnglers/sandbox-dashboard. The
 * dashboard now reads as a hero card + a stack of action cards rather than
 * as an article. Markdown sources are unchanged — all transformation happens
 * in `wrapDashboardSections()` below. Callers (lab-base-techlib's init_lab.py)
 * do NOT need to update; the existing markdown shape is interpreted as:
 *   - everything before the first <hr> → hero (#lab-overview)
 *   - each subsequent <hr>-separated chunk → an .action-card
 *   - inside an .action-card, runs of "h3 with a link, optional description"
 *     become a compact button grid (.actions-row > a.action-btn)
 */
export function renderDashboardHtml(
	markdown: string,
	webview: vscode.Webview
): string {
	const body = wrapDashboardSections(md().render(markdown));
	const nonce = makeNonce();
	const cspSource = webview.cspSource;

	// Strict CSP: no remote scripts, inline scripts only via nonce, images from
	// anywhere (handy for future lab-specific icons), fonts local/data.
	// style-src 'unsafe-inline' is LOAD-BEARING, not laziness: init_lab.py
	// emits dozens of inline style= attributes (61 at last count) in its
	// hero/status/pill markup, plus our own <style> block below. Tightening
	// to a style nonce would silently strip all of that authored styling.
	const csp = [
		`default-src 'none'`,
		`img-src ${cspSource} data: https:`,
		`style-src ${cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
		`font-src ${cspSource} data:`,
	].join('; ');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<title>Lab Dashboard</title>
	<style>${baseStyles()}</style>
</head>
<body class="vscode-body">
	<article class="markdown-body">${body}</article>
	<script nonce="${nonce}">${clickInterceptor()}</script>
</body>
</html>`;
}

function makeNonce(): string {
	// 16 random bytes → 32 hex chars. crypto-grade instead of the
	// Math.random() loop from VS Code's webview sample — same shape,
	// strictly better source, zero cost on the Node side.
	return crypto.randomBytes(16).toString('hex');
}

/**
 * Post-process markdown-it's HTML output into the sandbox-dashboard visual
 * idiom: a single hero card at the top + one action-card per subsequent
 * section. Buttons inside each card are coalesced into a compact responsive
 * grid; per-button description paragraphs are dropped (per Mitch's design
 * call — match sandbox-dashboard exactly).
 *
 * Algorithm:
 *   1. Split the rendered HTML on `<hr>` markers (markdown `---`). Markdown-it
 *      emits each block element on its own line, which makes line-based
 *      processing safe.
 *   2. The first chunk becomes the hero (#lab-overview) — typically wraps the
 *      h1, subtitle, status line, credentials block, and validated-with /
 *      resources badge rows.
 *   3. Each subsequent chunk becomes an .action-card. Inside each card, runs
 *      of "h3 containing a single <a>, optionally followed by a one-line <p>
 *      description" are coalesced into a <div class="actions-row"> grid of
 *      <a class="action-btn"> elements. The h3 wrapper is dropped (it was
 *      announcing as "heading level 3, link" — the new <a class="action-btn">
 *      is correctly announced as just a link/button to assistive tech). The
 *      description <p> is dropped to match sandbox-dashboard's compact grid.
 *   4. Non-button content inside a card (h2 section header, prose, ssh
 *      pills, details/summary, lists) passes through unchanged — the .action-
 *      card visual container is enough on its own.
 *
 * Input shape examples this targets (post markdown-it):
 *   <h3><a href="command:foo">Label</a></h3>           → button
 *   <h3 id="x"><a href="https://...">Label</a></h3>    → button
 *   <h3><a href="...">Label</a></h3>\n<p>desc</p>      → button (desc dropped)
 *
 * Anything else inside an h3 (e.g. <h3>Plain Heading</h3>) passes through —
 * we only transform h3s whose entire content is a single anchor.
 */
function wrapDashboardSections(html: string): string {
	// Split on each <hr> (markdown `---`). The separators themselves are
	// discarded — cards provide the visual separation. String.split always
	// returns at least one element, so chunks[0] exists even for input
	// with no <hr> at all.
	const chunks = html.split(/<hr\s*\/?>/i);

	const out: string[] = [];

	// First chunk → hero. Wrap unconditionally; if the chunk is empty (e.g.
	// the markdown opens with `---`), we suppress the wrapper to avoid
	// rendering an empty hero card.
	const heroContent = chunks[0].trim();
	if (heroContent.length > 0) {
		out.push(`<div id="lab-overview">${heroContent}</div>`);
	}

	// Subsequent chunks → action cards.
	for (let i = 1; i < chunks.length; i++) {
		const cardContent = transformCardInterior(chunks[i]).trim();
		if (cardContent.length === 0) {
			continue;
		}
		out.push(`<div class="action-card">${cardContent}</div>`);
	}

	return out.join('\n');
}

/**
 * Inside one action-card, find consecutive runs of (h3-with-anchor [+ p])
 * and collapse them into a single <div class="actions-row"> of
 * <a class="action-btn"> elements. Other content passes through.
 *
 * Markdown-it's output is line-oriented: each block element is on its own
 * line. We exploit that: walk the lines, classify each, and coalesce.
 */
const H3_BUTTON_RE = /^<h3\b[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>$/;
// A single-line <p>...</p> with no nested block elements. Used to detect
// description paragraphs that should be dropped when they immediately follow
// an h3-button. We match conservatively (`<p>...</p>` on one line only) so
// multi-line prose blocks pass through untouched.
const PARAGRAPH_LINE_RE = /^<p>[\s\S]*<\/p>$/;

interface Button {
	href: string;
	label: string;
}

function transformCardInterior(rawHtml: string): string {
	const lines = rawHtml.split('\n');
	const out: string[] = [];
	let buttonRun: Button[] = [];

	const flushRun = () => {
		if (buttonRun.length === 0) {
			return;
		}
		// SAFETY INVARIANT — do not "fix" the lack of escaping here:
		// href and label were captured from markdown-it's own output, which
		// is already attribute/HTML-escaped. href matched [^"]+ so it cannot
		// contain a raw quote — attribute breakout is impossible — and label
		// is re-emitted with exactly the escaping it arrived with (it may
		// legitimately contain inline tags like <code>). Escaping AGAIN
		// would double-encode entities and corrupt labels. If a new source
		// of button data is ever added that does NOT come from markdown-it
		// output, that source must be escaped before reaching this point.
		const buttons = buttonRun
			.map((b) => `<a class="action-btn" href="${b.href}">${b.label}</a>`)
			.join('\n');
		out.push(`<div class="actions-row">\n${buttons}\n</div>`);
		buttonRun = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			// Preserve blank lines in passthrough output, but don't break a
			// pending button run — markdown-it sometimes emits blank lines
			// between block elements and we don't want those to interrupt
			// our coalescing.
			if (buttonRun.length === 0) {
				out.push(line);
			}
			continue;
		}

		const m = trimmed.match(H3_BUTTON_RE);
		if (m) {
			buttonRun.push({ href: m[1], label: m[2].trim() });
			// Look ahead and consume a one-line description paragraph if
			// present. Skip blank lines while looking. Stop looking on the
			// first non-blank line — if it's a single-line <p>, drop it; if
			// it's another h3-button, leave it for the next iteration; if
			// it's anything else (h2, div, etc.), leave it.
			let j = i + 1;
			while (j < lines.length && lines[j].trim().length === 0) {
				j++;
			}
			if (j < lines.length) {
				const nextTrimmed = lines[j].trim();
				// (A line starting <p> can never also match H3_BUTTON_RE —
				// the two regexes are mutually exclusive on the first tag.)
				if (PARAGRAPH_LINE_RE.test(nextTrimmed)) {
					// Drop the description paragraph (and the blank lines
					// we walked over to find it). Per Mitch's design call:
					// match sandbox-dashboard's compact grid, no per-button
					// descriptions.
					i = j;
				}
			}
			continue;
		}

		// Not a button — flush any pending run and emit the line as-is.
		flushRun();
		out.push(line);
	}
	flushRun();

	return out.join('\n');
}

function clickInterceptor(): string {
	// Runs inside the webview. Captures clicks on anchor tags with `command:` scheme,
	// prevents default (would silently no-op via openExternal), and posts them back
	// to the extension host where we dispatch via vscode.commands.executeCommand().
	return `
		const vscode = acquireVsCodeApi();
		document.body.addEventListener('click', (ev) => {
			const a = ev.target.closest && ev.target.closest('a[href]');
			if (!a) return;
			const href = a.getAttribute('href');
			if (!href) return;
			if (href.startsWith('command:')) {
				ev.preventDefault();
				vscode.postMessage({ type: 'executeCommandUri', uri: href });
				return;
			}
			if (/^https?:/i.test(href)) {
				ev.preventDefault();
				vscode.postMessage({ type: 'openExternal', uri: href });
				return;
			}
			// file:, relative paths, and anchor links — let the default behavior run
			// (VS Code's webview will handle or ignore as appropriate).
		}, true);
	`;
}

function baseStyles(): string {
	// v0.15.0 visual identity — direct port of sandbox-dashboard's hero +
	// action-card + outline-btn system. The lab-dashboard CSS is now a
	// near-clone of sandbox-dashboard's, with two divergences kept on
	// purpose:
	//   1. SSH pills (.lab-ssh-pill) — preserved from v0.14.x. Arista Blue
	//      hover, $ prefix, lift + shadow on hover. These are the
	//      single brand-colored interaction surface and predate this
	//      refactor; users already love them.
	//   2. Credentials chip row (.lab-credentials) — adapted to live inside
	//      the brand-pinned hero. Background made transparent so the chips
	//      sit on the hero's pale-blue field; the chips themselves keep
	//      their own border + monospace identity.
	return `
		:root {
			color-scheme: light dark;
		}
		body {
			font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif);
			font-size: var(--vscode-font-size, 14px);
			line-height: 1.6;
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			margin: 0;
			padding: 0;
		}
		.markdown-body {
			padding: 1.5rem 2rem 3rem;
			box-sizing: border-box;
			max-width: 920px;
		}

		/* ── Generic typography (used inside cards) ──────────────────── */
		h1, h2, h3, h4, h5, h6 {
			margin-top: 1.2em;
			margin-bottom: 0.4em;
			font-weight: 600;
			line-height: 1.2;
		}
		p { margin: 0.4em 0; }
		a {
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
		}
		a:hover { text-decoration: underline; color: var(--vscode-textLink-activeForeground); }
		code, pre, kbd, samp {
			font-family: var(--vscode-editor-font-family, 'SF Mono', Menlo, Consolas, monospace);
			font-size: 0.92em;
		}
		code {
			padding: 0.1em 0.4em;
			background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.15));
			border-radius: 4px;
		}
		pre {
			padding: 0.8em 1em;
			background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.1));
			border-radius: 6px;
			overflow-x: auto;
		}
		pre code { padding: 0; background: transparent; }
		kbd {
			display: inline-block;
			padding: 0.1em 0.5em;
			font-size: 0.85em;
			line-height: 1;
			color: var(--vscode-foreground);
			background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.15));
			border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,0.3));
			border-radius: 4px;
		}
		table {
			border-collapse: collapse;
			margin: 0.6em 0;
			display: block;
			overflow-x: auto;
			max-width: 100%;
		}
		th, td {
			padding: 0.35em 0.8em;
			border: 1px solid var(--vscode-panel-border);
			font-size: 0.92em;
		}
		th {
			background: var(--vscode-textBlockQuote-background, rgba(128, 128, 128, 0.08));
			font-weight: 600;
			text-align: left;
		}
		tr:nth-child(2n) td {
			background: var(--vscode-textBlockQuote-background, rgba(128, 128, 128, 0.04));
		}
		blockquote {
			margin: 0.6em 0;
			padding: 0.1em 1em;
			color: var(--vscode-textBlockQuote-foreground, var(--vscode-foreground));
			border-left: 4px solid var(--vscode-textBlockQuote-border, var(--vscode-panel-border));
			background: var(--vscode-textBlockQuote-background, transparent);
		}
		ul, ol { padding-left: 1.5em; margin: 0.4em 0; }
		li + li { margin-top: 0.15em; }
		sub, sup { font-size: 0.8em; }
		small { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
		img { max-width: 100%; height: auto; }
		details > summary { cursor: pointer; }

		/* ── Hero card (#lab-overview) ────────────────────────────────────
		   Wraps everything before the first <hr>: lab name, subtitle,
		   status line, credentials, validated-with / resources badges.
		   Brand-pinned palette so every element inside reads consistently
		   regardless of the user's VS Code theme — same reasoning as
		   sandbox-dashboard's #lab-overview hero. */
		#lab-overview {
			margin: 0 0 1.5rem;
			padding: 1rem 1.25rem 1.1rem;
			border-radius: 6px;
			background: #EBF1F8;
			border-left: 4px solid #16325B;
		}
		#lab-overview h1 {
			margin: 0 0 0.3rem;
			font-size: 1.4rem;
			font-weight: 600;
			color: #16325B;
			border-bottom: none;
			padding-bottom: 0;
		}
		#lab-overview p {
			margin: 0.25rem 0;
			color: #1F2937;
		}
		#lab-overview p em {
			color: #1F2937;
			opacity: 0.85;
		}
		#lab-overview a {
			color: #16325B;
			text-decoration: underline;
		}
		#lab-overview a:hover {
			color: #16325B;
			opacity: 0.8;
		}
		#lab-overview hr {
			display: none;
		}

		/* Credentials chip row — adapted from v0.14.x. Background goes
		   transparent inside the hero so the chips float on the pinned
		   palette. The chips themselves retain a white-ish background +
		   border so they read as inset pill values, matching the badge
		   row visual rhythm directly below them. */
		#lab-overview .lab-credentials {
			display: flex;
			align-items: center;
			gap: 0.5em;
			flex-wrap: wrap;
			margin: 0.6em 0;
			padding: 0;
			background: transparent;
			border-left: none;
			border-radius: 0;
			font-size: 1em;
		}
		#lab-overview .lab-credentials-label {
			font-weight: 600;
			color: #58585B;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			font-size: 0.78em;
		}
		#lab-overview .lab-cred {
			padding: 0.2em 0.7em;
			background: #FFFFFF;
			border: 1px solid #C7D5E6;
			border-radius: 4px;
			font-family: var(--vscode-editor-font-family, 'SF Mono', Menlo, Consolas, monospace);
			font-weight: 600;
			font-size: 0.95em;
			color: #16325B;
		}
		#lab-overview .lab-cred-sep {
			color: #58585B;
			font-weight: 600;
		}

		/* Validated-with / Resources badge rows. Two-tone shields.io style
		   using the official Arista palette per
		   https://www.arista.com/assets/data/pdf/Arista-Brand-Guidelines.pdf
		   2025 edition — Dark Gray (#58585B) label half, Arista Blue
		   (#16325B) value half, white text. Solid hex by design: brand
		   colors render identically in both light and dark themes,
		   regardless of the user's VS Code theme. */
		#lab-overview .lab-validated-with {
			display: flex;
			align-items: center;
			gap: 0.4em;
			flex-wrap: wrap;
			margin: 0.55em 0 0;
		}
		/* v0.15.1: hide the inline "Validated with" / "Resources" labels
		   so the badge rows sit flush-left, matching sandbox-dashboard's
		   badge alignment. The labels are still emitted by init_lab.py's
		   _render_badge_row() helper; they just render as zero-width
		   here. Future cleanup: drop the label emission from init_lab.py
		   and remove this rule with the matching .lab-validated-label
		   class altogether. Until then, display: none keeps the markup
		   stable and the visual goal direct. */
		#lab-overview .lab-validated-label {
			display: none;
		}
		#lab-overview .lab-badge {
			display: inline-flex;
			align-items: stretch;
			border-radius: 4px;
			overflow: hidden;
			font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
			font-size: 0.78rem;
			line-height: 1.4;
			border: none;
		}
		#lab-overview .lab-badge-key {
			background: #58585B;
			color: #FFFFFF;
			padding: 0.22rem 0.55rem;
			font-weight: 500;
			text-transform: uppercase;
			letter-spacing: 0.04em;
		}
		#lab-overview .lab-badge-val {
			background: #16325B;
			color: #FFFFFF;
			padding: 0.22rem 0.55rem;
			font-weight: 600;
			font-variant-numeric: tabular-nums;
			font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
		}

		/* ── Action cards (.action-card) ──────────────────────────────────
		   One per <hr>-separated section after the hero. Subtle bg + border
		   + radius — the card itself carries visual weight; buttons inside
		   recede slightly. Section h2 header sits inside the card as a
		   tiny uppercase overline (visually matching what sandbox-dashboard
		   does with its .actions-sub-h class — a class that does NOT exist
		   here; lab-dashboard applies the same treatment to bare h2s since
		   its markdown uses ## for section headers). */
		.action-card {
			background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, #252526));
			border: 1px solid var(--vscode-panel-border, #3a3a3a);
			border-radius: 5px;
			padding: 0.85rem 1.1rem 1rem;
			margin: 0 0 0.7rem;
		}
		.action-card > :first-child {
			margin-top: 0;
		}
		.action-card > :last-child {
			margin-bottom: 0;
		}
		.action-card h2 {
			font-size: 0.78rem;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: var(--vscode-descriptionForeground);
			margin: 0 0 0.7rem;
			padding: 0;
			border-bottom: none;
		}
		.action-card h2 a[href] {
			color: inherit;
			text-decoration: none;
		}
		/* Section description prose (e.g. SSH section's "One click → logged in...")
		   sits between the h2 and the content — slightly muted, scannable. */
		.action-card h2 + p {
			color: var(--vscode-descriptionForeground);
			font-size: 0.92rem;
			margin: 0 0 0.7rem;
		}

		/* ── Action button grid (.actions-row > .action-btn) ──────────────
		   The post-processor coalesces consecutive h3-anchor button blocks
		   into this responsive grid. Buttons inside stretch to fill their
		   grid column — visual rhythm + easy scanning. minmax(220px, 1fr)
		   gives ~2 cols at typical webview widths, adapts to 1 col on
		   narrow panels and up to 3+ on wide ones. Same shape as sandbox-
		   dashboard's .actions-row to a CSS line. */
		.actions-row {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
			gap: 0.4rem;
			margin: 0;
		}
		.action-btn {
			/* Outline aesthetic from sandbox-dashboard v0.11.15. Transparent
			   bg, theme-foreground text, soft border. Hover fills with
			   --vscode-toolbar-hoverBackground (more harmonious than the
			   saturated --vscode-button-hoverBackground). Active state uses
			   transform: scale(0.98) for tactile click feedback without a
			   color shift. */
			display: inline-flex;
			align-items: center;
			justify-content: flex-start;
			gap: 0.4rem;
			text-align: left;
			background: transparent;
			color: var(--vscode-foreground, #cccccc) !important;
			border: 1px solid var(--vscode-input-border, rgba(255, 255, 255, 0.15));
			padding: 0.55rem 0.95rem;
			font-size: 0.95rem;
			font-family: var(--vscode-font-family);
			border-radius: 4px;
			cursor: pointer;
			text-decoration: none;
			transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.05s ease;
		}
		.action-btn:hover {
			background-color: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.06));
			border-color: var(--vscode-input-border, rgba(255, 255, 255, 0.25));
			color: var(--vscode-foreground, #ffffff) !important;
			text-decoration: none;
		}
		.action-btn:active {
			transform: scale(0.98);
		}
		.action-btn:focus {
			outline: 1px solid var(--vscode-focusBorder, #007fd4);
			outline-offset: 2px;
		}

		/* ── SSH-to-node pills (preserved from v0.14.x) ───────────────────
		   These predate the v0.15.0 refactor and users already love them.
		   Arista Blue hover ties them to the brand identity and creates a
		   deliberate hierarchy: action-btns are theme-driven navigational
		   surfaces; SSH pills are the brand-colored node-interaction
		   surface. The two systems are visually related (same lift +
		   shadow family) but distinguishable. */
		.lab-ssh-group {
			margin: 0.6em 0 0.5em;
		}
		.lab-ssh-group + .lab-ssh-group {
			margin-top: 1em;
		}
		.lab-ssh-group-label {
			display: block;
			margin-bottom: 0.4em;
			color: var(--vscode-descriptionForeground);
			font-size: 0.85em;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}
		.lab-ssh-pills {
			display: flex;
			flex-wrap: wrap;
			gap: 0.4em;
		}
		.lab-ssh-pill {
			display: inline-block;
			padding: 0.45em 0.9em;
			border-radius: 4px;
			background: var(--vscode-badge-background, var(--vscode-textBlockQuote-background, rgba(128,128,128,0.15)));
			color: var(--vscode-badge-foreground, var(--vscode-foreground)) !important;
			font-family: var(--vscode-editor-font-family, 'SF Mono', Menlo, Consolas, monospace);
			font-size: 0.95em;
			font-weight: 500;
			text-decoration: none;
			border: 1px solid transparent;
			transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
		}
		.lab-ssh-pill:hover {
			background: #16325b;
			color: #ffffff !important;
			border-color: #16325b;
			transform: translateY(-1px);
			box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
			text-decoration: none;
		}
		.lab-ssh-pill:active {
			transform: translateY(0);
			box-shadow: none;
		}
		.lab-ssh-pill::before {
			content: '$ ';
			opacity: 0.5;
		}
		.lab-ssh-pill:hover::before {
			opacity: 0.85;
		}
	`;
}
