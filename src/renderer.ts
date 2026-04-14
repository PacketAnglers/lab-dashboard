import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const taskLists = require('markdown-it-task-lists');

let _md: MarkdownIt | undefined;
function md(): MarkdownIt {
	if (_md) {
		return _md;
	}
	const m = new MarkdownIt({
		html: true, // allow <sub>, <kbd>, &nbsp;, etc. — we trust content WE write
		linkify: true,
		breaks: false,
		typographer: false,
	});
	m.use(taskLists, { enabled: false, label: true });
	_md = m;
	return m;
}

/**
 * Render the dashboard markdown as a self-contained HTML document suitable for
 * a WebviewPanel. Intercepts clicks on `<a href="command:...">` links and
 * posts them back to the extension host for dispatch.
 */
export function renderDashboardHtml(
	markdown: string,
	webview: vscode.Webview,
	sourceUri: vscode.Uri
): string {
	const body = wrapActionSections(md().render(markdown));
	const nonce = makeNonce();
	const cspSource = webview.cspSource;

	// Strict CSP: no remote scripts, inline scripts only via nonce, images from
	// anywhere (handy for future lab-specific icons), styles inline.
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
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let out = '';
	for (let i = 0; i < 32; i++) {
		out += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return out;
}

/**
 * Group action-style <h2> sections (currently "Quick Actions" and "Lab Operations")
 * into a side-by-side grid. Splits the rendered HTML at <hr> boundaries (which
 * the dashboard markdown uses as section separators), wraps consecutive action
 * sections in <div class="action-grid">, and reassembles. Non-action sections
 * pass through unchanged.
 *
 * Heading-driven detection — no markdown changes required to add new action
 * sections in the future, just add the heading text to ACTION_HEADING_RE.
 */
const ACTION_HEADING_RE = /<h2[^>]*>(?:[^<]*?)(?:Quick Actions|Lab Operations)/i;

function wrapActionSections(html: string): string {
	// Split on <hr> while keeping separators so we can reassemble exactly.
	const parts = html.split(/(<hr\s*\/?>)/i);
	const out: string[] = [];
	let groupBuf: string[] = [];
	// Tracks whether the most recently emitted part was an action section
	// in the current group — used to swallow the HR that separates it from
	// the NEXT action section (since the grid provides its own visual separation).
	let pendingHr: string | null = null;

	const flushGroup = () => {
		if (groupBuf.length === 0) {
			return;
		}
		if (groupBuf.length === 1) {
			out.push(groupBuf[0]);
		} else {
			const sections = groupBuf.map((s) => `<section>${s}</section>`).join('');
			out.push(`<div class="action-grid">${sections}</div>`);
		}
		groupBuf = [];
	};

	for (const part of parts) {
		const isHr = /^<hr/i.test(part);
		const isAction = !isHr && ACTION_HEADING_RE.test(part);

		if (isHr) {
			if (groupBuf.length > 0) {
				// We just collected an action section. Hold this HR — it'll be
				// dropped if the next part is also an action (same group), or
				// emitted if not (group ends).
				pendingHr = part;
			} else {
				out.push(part);
			}
			continue;
		}

		if (isAction) {
			// Same group continues — discard pending HR (grid handles spacing).
			pendingHr = null;
			groupBuf.push(part);
		} else {
			// Non-action content: flush group, then emit any pending HR, then this part.
			flushGroup();
			if (pendingHr !== null) {
				out.push(pendingHr);
				pendingHr = null;
			}
			out.push(part);
		}
	}
	// Trailing edge: flush any final group, then any leftover pendingHr.
	flushGroup();
	if (pendingHr !== null) {
		out.push(pendingHr);
	}
	return out.join('');
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
	// Layout philosophy: dashboard is a launchpad, not an article. Full width,
	// left-aligned, multi-column where it earns its keep. Action buttons are
	// sized to content. Vertical rhythm tightened to fit more above the fold.
	return `
		:root {
			color-scheme: light dark;
		}
		body {
			font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif);
			font-size: var(--vscode-font-size, 14px);
			line-height: 1.5;
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			margin: 0;
			padding: 0;
		}
		.markdown-body {
			padding: 1.25rem 2rem 3rem;
			box-sizing: border-box;
			max-width: none;
		}
		h1, h2, h3, h4, h5, h6 {
			margin-top: 1.2em;
			margin-bottom: 0.4em;
			font-weight: 600;
			line-height: 1.2;
		}
		h1 { font-size: 1.7em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 0.25em; margin-top: 0.1em; }
		h2 { font-size: 1.25em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 0.2em; }
		h3 { font-size: 1em; margin-top: 1em; margin-bottom: 0.4em; font-weight: 500; }
		h4 { font-size: 0.95em; }
		p { margin: 0.35em 0; }
		hr {
			border: 0;
			border-top: 1px solid var(--vscode-panel-border);
			margin: 1em 0;
		}
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

		/* ── Credentials block ─────────────────────────────────────────────
		   Prominent callout with pill-styled values, sized for scanability. */
		.lab-credentials {
			display: flex;
			align-items: center;
			gap: 0.6em;
			flex-wrap: wrap;
			margin: 0.6em 0;
			padding: 0.5em 0.9em;
			background: var(--vscode-textBlockQuote-background, rgba(128, 128, 128, 0.08));
			border-left: 3px solid var(--vscode-textLink-foreground);
			border-radius: 4px;
			font-size: 1.05em;
		}
		.lab-credentials-label {
			font-weight: 600;
			color: var(--vscode-descriptionForeground);
			text-transform: uppercase;
			letter-spacing: 0.05em;
			font-size: 0.8em;
		}
		.lab-cred {
			padding: 0.2em 0.7em;
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			font-family: var(--vscode-editor-font-family, 'SF Mono', Menlo, Consolas, monospace);
			font-weight: 600;
			font-size: 1em;
			color: var(--vscode-foreground);
		}
		.lab-cred-sep {
			color: var(--vscode-descriptionForeground);
			font-weight: 600;
		}

		/* ── Validated-with badge row ───────────────────────────────────── */
		.lab-validated-with {
			display: flex;
			align-items: center;
			gap: 0.5em;
			flex-wrap: wrap;
			margin: 0.6em 0 0.9em;
		}
		.lab-validated-label {
			font-weight: 600;
			color: var(--vscode-descriptionForeground);
			text-transform: uppercase;
			letter-spacing: 0.05em;
			font-size: 0.8em;
			margin-right: 0.2em;
		}
		.lab-badge {
			display: inline-flex;
			align-items: stretch;
			border-radius: 4px;
			overflow: hidden;
			border: 1px solid var(--vscode-panel-border);
			font-size: 0.9em;
			line-height: 1.5;
		}
		.lab-badge-key {
			padding: 0.15em 0.55em;
			background: var(--vscode-badge-background, var(--vscode-textBlockQuote-background, rgba(128,128,128,0.15)));
			color: var(--vscode-badge-foreground, var(--vscode-foreground));
			font-weight: 600;
		}
		.lab-badge-val {
			padding: 0.15em 0.6em;
			background: var(--vscode-editor-background);
			color: var(--vscode-foreground);
			font-family: var(--vscode-editor-font-family, 'SF Mono', Menlo, Consolas, monospace);
			font-weight: 500;
		}

		/* Action sections side-by-side in a responsive grid. The wrapper is
		   injected by the renderer so the dashboard markdown stays portable. */
		.action-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
			gap: 0.5rem 2rem;
			align-items: start;
		}
		.action-grid > section {
			min-width: 0;
		}

		/* Action buttons: sized to content, not full width. Applies to any
		   anchor inside an h3 — covers command: URIs AND external https links
		   (e.g. Tech Library guide buttons). h3 is only used for action
		   buttons in the dashboard, so this selector is safe. */
		h3 a[href] {
			display: inline-block;
			padding: 0.4em 0.9em;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground) !important;
			border-radius: 4px;
			transition: background 0.1s;
			text-decoration: none;
			font-weight: 500;
		}
		h3 a[href]:hover {
			background: var(--vscode-button-hoverBackground);
			text-decoration: none;
		}

		/* Description paragraph immediately after an action button — tighter and muted. */
		h3:has(a[href]) + p {
			margin: 0.2em 0 0.6em;
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
		}

		sub, sup { font-size: 0.8em; }
		small { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
		img { max-width: 100%; height: auto; }
	`;
}
