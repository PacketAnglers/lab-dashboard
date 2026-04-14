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

const openPanels = new Map<string, PanelEntry>();

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Lab Dashboard');
	context.subscriptions.push(output);
	output.appendLine('[labDashboard] activated');

	const pattern = getPattern();

	// Watch for creation/modification/deletion. We deliberately do NOT scan
	// for existing files at activation — a LAB-READY.md left over from a prior
	// session would otherwise auto-open with stale data while the lab is still
	// booting. Trust the file event: lab_start.py deletes the stale file at
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

	// 3. Manual commands.
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
		// Open the topology file AND fire the containerlab TopoViewer command.
		// Needed because:
		//   * `vscode.open` returns a thenable that doesn't resolve until the editor
		//     is the active one; runCommands fires the next command synchronously
		//     so getSelectedLabNode (called by topoViewer) sees no active editor.
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
		})
	);
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
		panel.webview.html = `<pre>Failed to read ${uri.fsPath}: ${String(exc)}</pre>`;
		return;
	}
	panel.title = titleFor(uri);
	panel.webview.html = renderDashboardHtml(markdown, panel.webview);
}

function titleFor(uri: vscode.Uri): string {
	return `Lab Dashboard — ${path.basename(path.dirname(uri.fsPath))}`;
}

/**
 * Parse a `command:<id>?<url-encoded-json>` URI and dispatch via executeCommand.
 *
 * Args convention (matches VS Code's documented format):
 *   - JSON array in the query → spread as positional args to the command
 *   - JSON object in the query → pass as a single argument
 *   - No query                → no args
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
