# Lab Dashboard

A VS Code / code-server extension that auto-opens a markdown dashboard file
(default: `LAB-READY.md`) in a custom webview, with **clickable `command:`
URIs** — something VS Code's built-in markdown preview only allows for
markdown authored inside extensions (gated by the `isTrusted` API flag).

Originally built for [aclabs](https://github.com/aristanetworks/aclabs) /
Arista Containerized Labs, where it turns a generated `LAB-READY.md` into a
one-click launchpad for the ContainerLab topology viewer, `make` targets,
and any other VS Code command.

## Why this exists

The built-in markdown preview silently no-ops `command:` URIs in user-authored
markdown. The only documented workaround — setting `MarkdownString.isTrusted =
true` — is an extension-only API and cannot be triggered from a `.md` file
on disk. This extension works around that by rendering markdown in its own
webview and dispatching `command:` clicks directly via
`vscode.commands.executeCommand()` from the extension host — inside the trust
boundary, no gate to satisfy.

## How it works

1. Extension activates on `onStartupFinished`.
2. Workspace file watcher fires on create/change of files matching
   `labDashboard.filePattern` (default: `**/LAB-READY.md`).
3. On match, opens a `WebviewPanel` rendering the markdown with
   `markdown-it` + GFM task lists + HTML passthrough.
4. Webview JS intercepts clicks on `<a href="command:…">`, posts them to
   the extension host.
5. Extension host parses `command:<id>?<url-encoded-json>`, dispatches via
   `executeCommand()`. JSON array → spread as positional args; JSON object
   → passed as a single argument.

## Installation

### From Open VSX Registry (recommended)

The extension is published to the [Open VSX Registry](https://open-vsx.org/extension/packetanglers/lab-dashboard),
which is the default registry for `code-server` and VS Code forks like
VSCodium and Gitpod. Install with a single command:

```bash
code-server --install-extension packetanglers.lab-dashboard --force
```

To pin a specific version:

```bash
code-server --install-extension packetanglers.lab-dashboard@0.7.0 --force
```

Desktop VS Code users can also use this marketplace ID form, or install
from the [GitHub Releases](https://github.com/PacketAnglers/lab-dashboard/releases)
page.

### From GitHub Releases (fallback)

For air-gapped environments or when Open VSX is unreachable, download the
`.vsix` directly and install from the local path. (Note: `code-server`
treats bare URLs passed to `--install-extension` as relative filesystem
paths, so the download step is required.)

```bash
VERSION=0.7.0
curl -fsSL -o /tmp/lab-dashboard.vsix \
  "https://github.com/PacketAnglers/lab-dashboard/releases/download/v${VERSION}/lab-dashboard-${VERSION}.vsix"
code-server --install-extension /tmp/lab-dashboard.vsix --force
```

### From Dockerfile (baking into a base image)

Simplest form, using Open VSX:

```dockerfile
RUN code-server --install-extension packetanglers.lab-dashboard --force
```

Or pin the version for reproducible image builds:

```dockerfile
ARG LAB_DASHBOARD_VERSION=0.7.0
RUN code-server --install-extension "packetanglers.lab-dashboard@${LAB_DASHBOARD_VERSION}" --force
```

Bump `LAB_DASHBOARD_VERSION` to roll out a new extension version to every
lab on the next image rebuild.

## Settings

| Setting | Default | Description |
|---|---|---|
| `labDashboard.filePattern` | `**/LAB-READY.md` | Glob for dashboard files to watch. |
| `labDashboard.autoOpen`    | `true`            | Auto-open matching files on detection. |

## Contributed commands

- `labDashboard.open` — find and open any dashboard file in the workspace.
- `labDashboard.refresh` — re-render all open dashboards.
- `labDashboard.openTopology` — open a topology file then fire the ContainerLab
  topology viewer (awaits editor activation between the two).
- `labDashboard.openFile` — open a file at an absolute path.
- `labDashboard.runInTerminal` — create a new terminal and run a shell command.

## Supported URI schemes in dashboard links

- `command:<id>?<url-encoded-json>` — dispatched via `executeCommand`.
- `https://…` / `http://…` — opened via `vscode.env.openExternal`.
- `file://…`, relative paths, anchor links — default webview behavior.

## Dashboard authoring

The webview ships with styling hooks that dashboard generators can target
for richer UI than plain markdown. These are part of the extension's
public contract — they won't change without a version bump.

### Action buttons

Any `<a>` inside an `<h3>` is styled as a button (works for both `command:`
and `https:` URIs). Example markdown:

```markdown
### [🔭 &nbsp; Open Topology View](command:labDashboard.openTopology?%5B%22/path/to/topology.clab.yml%22%5D)

Launch the interactive ContainerLab topology graph in a new editor tab.
```

The paragraph immediately following an action h3 is rendered as a muted
description (smaller, `descriptionForeground` color).

### Credentials block

Prominent callout with a blue left-border accent and pill-styled values:

```html
<div class="lab-credentials">
  <span class="lab-credentials-label">Credentials</span>
  <code class="lab-cred">admin</code>
  <span class="lab-cred-sep">/</span>
  <code class="lab-cred">admin</code>
</div>
```

### Badge rows

Two-tone GitHub-shields-style badges for version info, resource specs,
or any key/value pairs. The container can have any label:

```html
<div class="lab-validated-with">
  <span class="lab-validated-label">Validated with</span>
  <span class="lab-badge">
    <span class="lab-badge-key">cEOS</span>
    <span class="lab-badge-val">4.35.2F</span>
  </span>
  <!-- more badges... -->
</div>
```

### Action grid (automatic)

Consecutive `## Quick Actions` and `## Lab Operations` sections are
automatically wrapped into a responsive two-column grid. Heading-driven
detection — see `ACTION_HEADING_RE` in `src/renderer.ts` to extend.

## Developing

```bash
npm install
npm run bundle      # build with esbuild
npm run package     # build + produce .vsix
```

Press `F5` in VS Code to launch an Extension Development Host with the
extension loaded for interactive testing.

## Releasing

1. Bump the `version` field in `package.json`.
2. Update `CHANGELOG.md`.
3. Commit, tag, and push:
   ```bash
   git tag v0.7.0
   git push origin main v0.7.0
   ```
4. GitHub Actions automatically builds the `.vsix` and attaches it to a
   new GitHub Release for that tag.

## Security

Dashboard content is assumed to be trusted (typically generated by a
lab-setup script from local data). The webview uses a strict CSP with a
per-render nonce for inline scripts; no remote scripts or `eval`.

## License

MIT — see [LICENSE](./LICENSE).
