import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { renderDashboardHtml } from './renderer';

/**
 * Lab Dashboard extension
 *
 * Watches the workspace for a dashboard markdown file (default: LAB-READY.md)
 * and opens it in a custom webview preview that honors `command:` URIs.
 *
 * The built-in VS Code markdown preview only fires `command:` URIs when the
 * source `MarkdownString` has `isTrusted = true`, which is an extension-only
 * API gate. Since we render in our OWN webview and dispatch command URIs
 * from the extension host directly, we're fully inside the trust boundary —
 * no gate to satisfy.
 */

interface PanelEntry {
	panel: vscode.WebviewPanel;
	uri: vscode.Uri;
}

interface SshToNodeArgs {
	node: string;
	user?: string;
}

const openPanels = new Map<string, PanelEntry>();

// Per-node SSH terminal registry. Keyed by node name; values are the most
// recent terminal we created for that node. Reused on subsequent clicks
// instead of spawning duplicates. Entries are cleaned up by the
// onDidCloseTerminal listener registered in activate().
const sshTerminals = new Map<string, vscode.Terminal>();

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Lab Dashboard');
	context.subscriptions.push(output);
	output.appendLine('[labDashboard] activated');

	const pattern = getPattern();

	// ── Status bar button ──────────────────────────────────────────────────
	// Permanent "📋 Lab Dashboard" button in the bottom status bar. One click
	// reopens the dashboard webview regardless of whether the user closed the
	// tab, never opened it, or just can't find it. Zero discovery friction —
	// always visible, always works.
	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		100, // priority — higher values place the item further left
	);
	statusBarItem.text = '$(preview) Lab Dashboard';
	statusBarItem.tooltip = 'Open the Lab Dashboard';
	statusBarItem.command = 'labDashboard.open';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// Clean up the sshTerminals registry when a tracked terminal closes.
	// Without this, a closed-then-reopened SSH session would briefly hit
	// the "stillAlive" check on a stale reference before falling through
	// to recreate. Cheap to maintain explicitly, and keeps the registry
	// honest for any future code that wants to enumerate active sessions.
	context.subscriptions.push(
		vscode.window.onDidCloseTerminal((closed) => {
			for (const [node, term] of sshTerminals) {
				if (term === closed) {
					sshTerminals.delete(node);
					output.appendLine(`[labDashboard] sshToNode: terminal closed for ${node}`);
					break;
				}
			}
		})
	);

	// Watch for creation/modification/deletion. We deliberately do NOT scan
	// for existing files at activation — a LAB-READY.md left over from a prior
	// session would otherwise auto-open with stale data while the lab is still
	// booting. Trust the file event: init_lab.py deletes the stale file at
	// startup and writes a fresh one only when the lab is actually ready.
	const watcher = vscode.workspace.createFileSystemWatcher(pattern);
	watcher.onDidCreate((uri) => {
		output.appendLine(`[labDashboard] created: ${uri.fsPath}`);
		if (getAutoOpen()) {
			openDashboard(context, uri, output);
		}
	});
	watcher.onDidChange((uri) => {
		output.appendLine(`[labDashboard] changed: ${uri.fsPath}`);
		// If the panel is already open, refresh in place. If not, treat the
		// change like a create — covers the case where the file was modified
		// while the user wasn't running a lab task (rare but possible).
		if (openPanels.has(uri.fsPath)) {
			refreshDashboard(uri, output);
		} else if (getAutoOpen()) {
			openDashboard(context, uri, output);
		}
	});
	watcher.onDidDelete((uri) => {
		output.appendLine(`[labDashboard] deleted: ${uri.fsPath}`);
		const entry = openPanels.get(uri.fsPath);
		if (entry) {
			entry.panel.dispose();
		}
	});
	context.subscriptions.push(watcher);

	// ── Manual commands ────────────────────────────────────────────────────
	context.subscriptions.push(
		vscode.commands.registerCommand('labDashboard.open', async () => {
			const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 20);
			if (uris.length === 0) {
				vscode.window.showInformationMessage(`No dashboard file found matching ${pattern}.`);
				return;
			}
			for (const uri of uris) {
				openDashboard(context, uri, output);
			}
		}),
		vscode.commands.registerCommand('labDashboard.refresh', () => {
			for (const entry of openPanels.values()) {
				refreshDashboard(entry.uri, output);
			}
		}),
		// Open the topology file AND fire the containerlab TopoViewer command,
		// then close the topology file tab automatically — it was only opened
		// to satisfy TopoViewer's `activeTextEditor` requirement, and once
		// the viewer is up the file editor is just visual clutter.
		//
		// Needed because:
		//   * `vscode.open` returns a thenable that doesn't resolve until the
		//     editor is the active one; runCommands fires the next command
		//     synchronously so getSelectedLabNode (called by topoViewer) sees
		//     no active editor.
		//   * Awaiting both here, in our extension, sidesteps the race entirely.
		vscode.commands.registerCommand('labDashboard.openTopology', async (topologyPath: string) => {
			if (!topologyPath || typeof topologyPath !== 'string') {
				vscode.window.showErrorMessage('labDashboard.openTopology: missing topology path argument');
				return;
			}
			const uri = vscode.Uri.file(topologyPath);
			output.appendLine(`[labDashboard] openTopology: ${uri.fsPath}`);
			try {
				await vscode.commands.executeCommand('vscode.open', uri);
				// Tiny yield — lets VS Code finish wiring the editor as "active"
				// before the containerlab extension queries activeTextEditor.
				await new Promise((r) => setTimeout(r, 150));
				await vscode.commands.executeCommand('containerlab.lab.graph.topoViewer');

				// Close the topology file tab. TopoViewer has already read what
				// it needs from activeTextEditor by this point, so the file
				// editor is no longer serving a purpose. Use the Tab API to
				// target this specific tab regardless of which tab is currently
				// active — that way we don't accidentally close the TopoViewer
				// webview itself.
				const allTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
				const topologyTab = allTabs.find((t) =>
					t.input instanceof vscode.TabInputText &&
					t.input.uri.fsPath === uri.fsPath
				);
				if (topologyTab) {
					await vscode.window.tabGroups.close(topologyTab);
				}
			} catch (exc) {
				output.appendLine(`[labDashboard] openTopology failed: ${exc}`);
				vscode.window.showErrorMessage(`Open Topology failed: ${String(exc)}`);
			}
		}),
		// Open a file at an absolute path. Convenience wrapper so dashboard
		// authors don't have to hand-craft `file://` URIs in command args.
		vscode.commands.registerCommand('labDashboard.openFile', async (filePath: string) => {
			if (!filePath || typeof filePath !== 'string') {
				vscode.window.showErrorMessage('labDashboard.openFile: missing path argument');
				return;
			}
			const uri = vscode.Uri.file(filePath);
			output.appendLine(`[labDashboard] openFile: ${uri.fsPath}`);
			try {
				await vscode.commands.executeCommand('vscode.open', uri);
			} catch (exc) {
				output.appendLine(`[labDashboard] openFile failed: ${exc}`);
				vscode.window.showErrorMessage(`Open File failed: ${String(exc)}`);
			}
		}),
		// Open a new terminal and type a shell command into it. Convenience
		// wrapper for "▶ make build"-style buttons on the dashboard.
		vscode.commands.registerCommand('labDashboard.runInTerminal', async (cmd: string) => {
			if (!cmd || typeof cmd !== 'string') {
				vscode.window.showErrorMessage('labDashboard.runInTerminal: missing command argument');
				return;
			}
			output.appendLine(`[labDashboard] runInTerminal: ${cmd}`);
			const term = vscode.window.createTerminal({ name: cmd.split(/\s+/)[0] || 'lab' });
			term.show();
			term.sendText(cmd, true);
		}),
		// Open a fresh terminal in the bottom panel. The global setting
		// terminal.integrated.defaultLocation is typically "editor" so SSH
		// sessions open as tabs — but users also need a traditional panel
		// terminal for shell commands (make build, make deploy, etc.).
		// This command explicitly targets TerminalLocation.Panel so users
		// get the "terminal at the bottom of the screen" experience they
		// expect, without changing the global setting.
		vscode.commands.registerCommand('labDashboard.openTerminal', () => {
			output.appendLine('[labDashboard] openTerminal: panel');
			const term = vscode.window.createTerminal({
				name: 'Terminal',
				location: vscode.TerminalLocation.Panel,
			});
			term.show();
		}),
		// SSH to a lab node by hostname/alias (typically the entries written
		// to ~/.ssh/config by init_lab.py's populate_ssh_config). Per-node
		// terminal reuse: clicking the same node twice surfaces the existing
		// terminal instead of spawning a duplicate.
		//
		// Args: { node: string, user?: string }
		//   node — required; the SSH target (matches a Host alias in ssh config)
		//   user — optional; defaults to "admin", which is the lab convention
		//
		// Behavior: opens (or focuses) a terminal named after the node,
		// types `ssh <user>@<node>`, and presses Enter. One click → logged in.
		vscode.commands.registerCommand('labDashboard.sshToNode', async (args: SshToNodeArgs) => {
			const node = args?.node;
			const user = args?.user || 'admin';

			if (!node || typeof node !== 'string') {
				vscode.window.showErrorMessage(
					'labDashboard.sshToNode: missing or invalid "node" argument'
				);
				return;
			}

			// Both values are interpolated into a shell command via sendText
			// below, and both originate from command URIs in the dashboard
			// markdown. A poisoned LAB-READY.md gains nothing new here —
			// runInTerminal is allowlisted arbitrary-shell by design — but
			// there's no reason to pass unvalidated text into a shell when
			// the legitimate value space is this narrow: SSH host aliases
			// written by init_lab.py and lab usernames are strictly
			// [A-Za-z0-9._-]. Rejecting everything else is simultaneously
			// input hardening and a correctness guard (a node name with a
			// space would silently produce a broken ssh command).
			const SAFE_TOKEN_RE = /^[A-Za-z0-9._-]+$/;
			if (!SAFE_TOKEN_RE.test(node) || !SAFE_TOKEN_RE.test(user)) {
				vscode.window.showErrorMessage(
					`labDashboard.sshToNode: refusing unsafe node/user value (allowed: letters, digits, . _ -)`
				);
				output.appendLine(
					`[labDashboard] sshToNode: rejected node=${JSON.stringify(node)} user=${JSON.stringify(user)}`
				);
				return;
			}

			// Check our registry for an existing terminal for this node.
			// We track by node name rather than by terminal reference so we
			// can detect terminals the user closed (which removes them from
			// vscode.window.terminals). If our cached reference is stale,
			// we recreate.
			const existing = sshTerminals.get(node);
			const stillAlive = existing && vscode.window.terminals.includes(existing);

			if (stillAlive) {
				output.appendLine(`[labDashboard] sshToNode: reusing terminal for ${node}`);
				existing.show(false); // false = take focus
				return;
			}

			output.appendLine(`[labDashboard] sshToNode: opening terminal for ${user}@${node}`);
			const term = vscode.window.createTerminal({ name: node });
			sshTerminals.set(node, term);
			term.show(false); // false = take focus
			// true = include trailing newline → command runs immediately
			term.sendText(`ssh ${user}@${node}`, true);
		})
	);

	// ── Auto-launch init_lab.py ─────────────────────────────────────────────
	//
	// If the workspace contains assets/init_lab.py, launch it in an editor-
	// area terminal tab. We wait for the IDE's startup layout to settle
	// (i.e., for the first editor to become active — typically README.md via
	// code-server's workbench.startupEditor setting) before creating the
	// terminal. This guarantees init_lab opens AFTER README.md, so its tab
	// takes focus and the user sees the boot TUI immediately. README.md
	// becomes a background tab that's one click away.
	//
	// Fallback: if no editor opens within 5 seconds (e.g., no README in the
	// lab, or startupEditor is "none"), we launch init_lab anyway.
	//
	// This replaces the tasks.json "runOn: folderOpen" approach, which
	// couldn't guarantee tab ordering relative to README.md.
	if (vscode.workspace.workspaceFolders?.length) {
		let initScript: string | undefined;
		let initCwd: vscode.Uri | undefined;

		// Resolution order:
		//   1. /bin/init_lab.py  — bundled by lab-base-techlib (preferred)
		//   2. <workspace>/assets/init_lab.py  — per-lab override / legacy labs
		//   3. neither           — silently do nothing
		//
		// The bundled path wins because it gives us single-source-of-truth
		// versioning tied to the container image tag. Workspace-local remains
		// as an escape hatch for labs that need a custom init without waiting
		// for a new lab-base-techlib release.
		const bundled = '/bin/init_lab.py';
		if (fs.existsSync(bundled)) {
			initScript = bundled;
			initCwd = vscode.workspace.workspaceFolders[0].uri;
			output.appendLine(`[labDashboard] using bundled init_lab: ${bundled}`);
		} else {
			for (const folder of vscode.workspace.workspaceFolders) {
				const candidate = path.join(folder.uri.fsPath, 'assets', 'init_lab.py');
				if (fs.existsSync(candidate)) {
					initScript = candidate;
					initCwd = folder.uri;
					output.appendLine(`[labDashboard] using workspace init_lab: ${candidate}`);
					break;
				}
			}
		}

		if (initScript) {
			const doLaunch = () => {
				const term = vscode.window.createTerminal({
					name: 'init_lab',
					cwd: initCwd,
				});
				term.show(false); // false = take focus so user sees the TUI
				// Quoted: the bundled path is constant, but the workspace-
				// fallback path is wherever the user's folder lives — spaces
				// in that path would otherwise split the argument.
				term.sendText(`python3 "${initScript}"`, true);
				output.appendLine('[labDashboard] init_lab launched');
			};

			// Focus-race avoidance is only needed when the IDE is configured
			// to auto-open README on startup — in that case, README opens
			// after our activation and competes with the init_lab terminal
			// for focus. We deterministically order by waiting for the
			// README's editor event before creating the terminal.
			//
			// When startupEditor is anything else ("none", "welcomePage",
			// "newUntitledFile", etc.), no README auto-opens, no race
			// exists, and we launch immediately — no dead air.
			const startupEditor = vscode.workspace
				.getConfiguration('workbench')
				.get<string>('startupEditor', 'welcomePage');
			const mayOpenReadme = startupEditor === 'readme';

			if (vscode.window.activeTextEditor || !mayOpenReadme) {
				// Either an editor is already active (IDE layout settled),
				// or no README is expected to open — launch immediately.
				doLaunch();
			} else {
				// Wait for the first editor to become active (README opening),
				// then launch so our terminal tab takes focus over README.
				let launched = false;
				const editorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
					if (editor && !launched) {
						launched = true;
						editorListener.dispose();
						doLaunch();
					}
				});
				context.subscriptions.push(editorListener);

				// Fallback: if no editor opens within 5 seconds, launch anyway.
				// Covers the edge case of startupEditor="readme" in a workspace
				// that has no README.md — the event never fires, so we must
				// still proceed eventually.
				setTimeout(() => {
					if (!launched) {
						launched = true;
						editorListener.dispose();
						output.appendLine('[labDashboard] init_lab fallback launch (no editor opened)');
						doLaunch();
					}
				}, 5000);
			}
		}
	}
}

export function deactivate() {
	for (const entry of openPanels.values()) {
		entry.panel.dispose();
	}
	openPanels.clear();
}

function getPattern(): string {
	return vscode.workspace.getConfiguration('labDashboard').get<string>('filePattern', '**/LAB-READY.md');
}

function getAutoOpen(): boolean {
	return vscode.workspace.getConfiguration('labDashboard').get<boolean>('autoOpen', true);
}

function openDashboard(
	context: vscode.ExtensionContext,
	uri: vscode.Uri,
	output: vscode.OutputChannel
): void {
	// If a panel for this file already exists, just reveal it.
	const existing = openPanels.get(uri.fsPath);
	if (existing) {
		existing.panel.reveal(vscode.ViewColumn.Active, true);
		refreshDashboard(uri, output);
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'labDashboard',
		'Lab Dashboard',
		{ viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [context.extensionUri, vscode.Uri.file(path.dirname(uri.fsPath))],
		}
	);

	const entry: PanelEntry = { panel, uri };
	openPanels.set(uri.fsPath, entry);

	// Dispatch command URIs posted from the webview.
	panel.webview.onDidReceiveMessage(async (msg) => {
		if (!msg || typeof msg !== 'object') {
			return;
		}
		if (msg.type === 'executeCommandUri' && typeof msg.uri === 'string') {
			await executeCommandUri(msg.uri, output);
		} else if (msg.type === 'openExternal' && typeof msg.uri === 'string') {
			// The webview's click interceptor only forwards http(s) links,
			// and CSP means only our nonce'd script can postMessage — but
			// the host side shouldn't have to trust that. Re-check the
			// scheme here so a future interceptor change (or any webview
			// compromise) can't turn this handler into an arbitrary
			// protocol launcher (file:, vscode:, ssh:, ...).
			if (!/^https?:/i.test(msg.uri)) {
				output.appendLine(`[labDashboard] refusing non-http(s) openExternal: ${msg.uri}`);
				return;
			}
			try {
				await vscode.env.openExternal(vscode.Uri.parse(msg.uri));
			} catch (exc) {
				output.appendLine(`[labDashboard] openExternal failed: ${exc}`);
			}
		} else if (msg.type === 'log' && typeof msg.message === 'string') {
			output.appendLine(`[labDashboard:webview] ${msg.message}`);
		}
	});

	panel.onDidDispose(() => {
		openPanels.delete(uri.fsPath);
	});

	renderIntoPanel(panel, uri, output);
}

function refreshDashboard(uri: vscode.Uri, output: vscode.OutputChannel): void {
	const entry = openPanels.get(uri.fsPath);
	if (!entry) {
		return;
	}
	renderIntoPanel(entry.panel, uri, output);
}

function renderIntoPanel(
	panel: vscode.WebviewPanel,
	uri: vscode.Uri,
	output: vscode.OutputChannel
): void {
	let markdown: string;
	try {
		markdown = fs.readFileSync(uri.fsPath, 'utf-8');
	} catch (exc) {
		output.appendLine(`[labDashboard] read failed: ${exc}`);
		// HTML-escape both interpolations: uri.fsPath can contain user-
		// provided chars (the workspace path is fully user-controlled),
		// and exc.toString() can contain whatever Node's error formatter
		// includes — safest to assume neither is HTML-clean. CSP would
		// already block any script execution this could enable, but
		// hygiene is worth getting right at the source.
		panel.webview.html = `<pre>Failed to read ${escapeHtml(uri.fsPath)}: ${escapeHtml(String(exc))}</pre>`;
		return;
	}
	panel.title = titleFor(uri);
	panel.webview.html = renderDashboardHtml(markdown, panel.webview);
}

/**
 * Minimal HTML escaper for safe interpolation into error-state webview
 * content. Not exported — only used in the read-failure fallback above.
 * The main render path doesn't need this because renderDashboardHtml()
 * goes through markdown-it (which handles escaping) and the post-
 * processor only inserts class names and known-safe wrapper markup.
 */
function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function titleFor(uri: vscode.Uri): string {
	return `Lab Dashboard — ${path.basename(path.dirname(uri.fsPath))}`;
}

/**
 * The set of `command:` URIs that the dashboard webview is allowed to
 * dispatch. Matches the seven commands this extension actually
 * registers in activate() (six declared in package.json's
 * contributes.commands plus labDashboard.sshToNode which is registered
 * in code).
 *
 * Scoping the dispatcher to this allowlist closes a post-compromise
 * privilege-escalation door: a poisoned LAB-READY.md (planted by an
 * attacker who already has workspace write access) can no longer
 * trigger arbitrary VS Code commands like `workbench.action.terminal.
 * sendSequence` or anything else from VS Code's broad command surface.
 *
 * If a new command is added to activate(), add it here too — the
 * dispatcher will silently refuse anything that isn't on this list.
 */
const ALLOWED_COMMAND_IDS: ReadonlySet<string> = new Set([
	'labDashboard.open',
	'labDashboard.refresh',
	'labDashboard.openTopology',
	'labDashboard.openFile',
	'labDashboard.runInTerminal',
	'labDashboard.openTerminal',
	'labDashboard.sshToNode',
]);

/**
 * Parse a `command:<id>?<url-encoded-json>` URI and dispatch via executeCommand.
 *
 * Args convention (matches VS Code's documented format):
 *   - JSON array in the query → spread as positional args to the command
 *   - JSON object in the query → pass as a single argument
 *   - No query                → no args
 *
 * The command ID is checked against ALLOWED_COMMAND_IDS before dispatch.
 * Anything else is logged and rejected — see the allowlist's docstring
 * for the threat model this protects against.
 */
async function executeCommandUri(rawUri: string, output: vscode.OutputChannel): Promise<void> {
	let uri: vscode.Uri;
	try {
		uri = vscode.Uri.parse(rawUri, true);
	} catch (exc) {
		output.appendLine(`[labDashboard] bad URI ${rawUri}: ${exc}`);
		return;
	}
	if (uri.scheme !== 'command') {
		output.appendLine(`[labDashboard] refusing non-command URI: ${rawUri}`);
		return;
	}
	const commandId = uri.path;
	if (!ALLOWED_COMMAND_IDS.has(commandId)) {
		output.appendLine(`[labDashboard] refusing non-allowlisted command: ${commandId}`);
		return;
	}
	let args: unknown[] = [];
	if (uri.query) {
		try {
			const parsed = JSON.parse(decodeURIComponent(uri.query));
			args = Array.isArray(parsed) ? parsed : [parsed];
		} catch (exc) {
			output.appendLine(`[labDashboard] failed to parse args for ${commandId}: ${exc}`);
			return;
		}
	}
	output.appendLine(`[labDashboard] executeCommand(${commandId}, ${args.length} args)`);
	try {
		await vscode.commands.executeCommand(commandId, ...args);
	} catch (exc) {
		output.appendLine(`[labDashboard] ${commandId} threw: ${exc}`);
		vscode.window.showErrorMessage(`Command ${commandId} failed: ${String(exc)}`);
	}
}
