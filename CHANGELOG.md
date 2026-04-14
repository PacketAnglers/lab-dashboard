# Changelog

All notable changes to the Lab Dashboard extension are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
