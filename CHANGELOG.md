# Changelog

All notable changes to the Lab Dashboard extension are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.0] - 2026-04-21

### Added
- **Container-bundled `init_lab.py` support.** The extension now checks
  `/bin/init_lab.py` first when auto-launching the lab init script, falling
  back to `<workspace>/assets/init_lab.py` if the bundled path is not
  present. This enables lab-base-techlib (and any future lab-base variant)
  to ship a single versioned `init_lab.py` that every lab uses by default,
  while preserving the workspace-local path as a per-lab override escape
  hatch. If neither exists, the extension silently does nothing — same
  behavior as before.

### Changed
- Output channel logging for init_lab discovery now distinguishes between
  the bundled path and the workspace fallback, making it easier to debug
  which source the extension resolved to.

## [0.7.0] - 2026-04-14

### Added
- **Open VSX Registry publishing.** Extension is now published to
  [open-vsx.org](https://open-vsx.org) automatically on tag push, enabling
  one-command install via marketplace ID:
  ```bash
  code-server --install-extension packetanglers.lab-dashboard --force
  ```
  No more curl-then-install dance for code-server users.
- CI workflow step that gracefully skips Open VSX publishing when
  `OPEN_VSX_TOKEN` is not configured (e.g., on forks or PRs), so the
  release pipeline doesn't break for contributors without publish credentials.

### Changed
- Install documentation in README updated to show marketplace ID install
  as the primary path, with curl+install as a fallback for air-gapped or
  offline environments.

## [0.6.1] - 2026-04-14

### Changed
- Code hygiene pass — no behavior change.
- Consolidated `path` module imports (top-level `import * as path from 'path'`
  instead of two scattered `require('path')` calls).
- Dropped unused `sourceUri` parameter from `renderDashboardHtml`.

### Documentation
- Fixed broken install example in README — `code-server --install-extension`
  treats bare URLs as relative filesystem paths, so the correct pattern is
  `curl` first, then install from the downloaded local path.
- Added a "Dashboard authoring" section documenting the CSS styling hooks
  (`.lab-credentials`, `.lab-badge`, action-grid auto-wrapping, etc.) as
  part of the extension's public contract for dashboard generators.
- Bumped version references in install/release examples to current.

## [0.6.0] - 2026-04-14

### Changed
- Action button styling now applies to any anchor inside an h3
  (`h3 a[href]`), not just `command:` URIs. External https links
  (e.g. documentation buttons) now render as proper buttons too.

## [0.5.0] - 2026-04-14

### Added
- Styling hooks for a prominent credentials block: `.lab-credentials`,
  `.lab-credentials-label`, `.lab-cred`, `.lab-cred-sep`. Credentials now
  render as a callout with border-left accent, pill-styled values, and
  `SMALL CAPS` label for scanability.
- Styling hooks for a validated-with badge row: `.lab-validated-with`,
  `.lab-validated-label`, `.lab-badge`, `.lab-badge-key`, `.lab-badge-val`.
  Each entry renders as a two-tone pill (key on themed background,
  value in monospace on editor background) — GitHub-shields-style.

### Changed
- Credentials no longer share the status line; they're their own block.
- Validated-with entries promoted from `<sub>` to proper badge pills.

## [0.4.0] - 2026-04-13

### Changed
- Dashboard layout redesigned as a left-aligned, full-width launchpad instead of
  a centered article column.
- Quick Actions and Lab Operations sections now render side-by-side in a
  responsive CSS grid (`auto-fit, minmax(360px, 1fr)`), collapsing to a single
  column on narrow viewports.
- Action buttons sized to content instead of stretching full-width.
- Tightened vertical rhythm throughout (margins, line-height, padding) so more
  fits above the fold.
- Description paragraphs following action buttons use `descriptionForeground`
  color and smaller font size for clearer visual hierarchy.

### Added
- HR-aware section wrapping: HRs between consecutive action sections are
  suppressed inside the grid; HRs at group boundaries are preserved.
- Heading-driven section detection (`Quick Actions` / `Lab Operations`) via
  `ACTION_HEADING_RE` — extensible to future action sections by adding heading
  text to the regex.

## [0.3.0] - 2026-04-13

### Changed
- Removed startup file scan to prevent stale dashboards from opening before
  the lab is actually ready. Extension now exclusively reacts to file
  creation/change events from the watcher.

### Fixed
- Race condition where a `LAB-READY.md` left over from a prior session would
  auto-open with stale data while the lab was still booting.

## [0.2.0] - 2026-04-13

### Added
- `labDashboard.openTopology` command — opens topology file then fires
  `containerlab.lab.graph.topoViewer`, with an internal await sequence that
  avoids the active-editor race that broke naive `runCommands` chains.
- `labDashboard.openFile` command — wraps absolute paths in `vscode.Uri.file()`
  before dispatching to `vscode.open`.
- `labDashboard.runInTerminal` command — uses VS Code's Terminal API directly
  (`createTerminal` + `sendText`) rather than the timing-sensitive
  `workbench.action.terminal.sendSequence`.

### Fixed
- "No lab node or topology file selected" error when clicking Open Topology
  View — caused by `runCommands` firing the next command before
  `vscode.open`'s editor activation completed.
- "Invalid argument 'uriOrString'" errors on Open README / Open Topology File
  — `vscode.open` requires a `Uri` object or `file://` URI, not a bare path.

## [0.1.0] - 2026-04-13

### Added
- Initial release.
- `onStartupFinished` activation with a workspace file watcher for
  `**/LAB-READY.md` (configurable via `labDashboard.filePattern`).
- Custom `WebviewPanel` that renders markdown via `markdown-it` with GFM task
  lists and HTML passthrough (for `<kbd>`, `<sub>`, `&nbsp;`, etc.).
- Webview-side click interception of `<a href="command:...">` anchors, posted
  to the extension host and dispatched via `vscode.commands.executeCommand()`.
  Sidesteps the `isTrusted` gate that blocks `command:` URIs in VS Code's
  built-in markdown preview.
- Strict Content Security Policy with per-render nonce for the inline
  click-handler script.
- Theme-aware CSS using VS Code webview CSS variables.
- Settings: `labDashboard.filePattern`, `labDashboard.autoOpen`.
- Manual commands: `labDashboard.open`, `labDashboard.refresh`.
