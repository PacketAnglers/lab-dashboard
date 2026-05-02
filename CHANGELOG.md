# Changelog

All notable changes to the Lab Dashboard extension are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-05-02

### Changed
- **Visual identity ported from `sandbox-dashboard`.** Users loved the
  hero-card + action-card + outline-button system from
  `PacketAnglers/sandbox-dashboard`; this release brings the same
  language to `lab-dashboard`. The dashboard now reads as a hero card
  at the top followed by a stack of action cards, rather than as a
  long article. No markdown source changes are required — the
  existing `LAB-READY.md` shape (header → `---` → sections) is
  interpreted directly by the new post-processor.
- **Hero card (`#lab-overview`).** The header block — lab name,
  subtitle, status line, credentials, and the `Validated with` /
  `Resources` badge rows — is now wrapped in a brand-pinned hero card
  with a pale-blue background (`#EBF1F8`) and a 4px Arista Blue
  (`#16325B`) left-border accent. Text colors inside the hero are
  pinned to read consistently in both light and dark VS Code themes.
- **Action cards.** Each `<hr>`-separated section after the hero
  (Quick Actions, SSH to Nodes, Node Inventory, Tips, etc.) is now
  wrapped in a subtle `.action-card` container — soft background, 1px
  border, rounded corners. Section `<h2>` headers inside the card
  render as a tiny uppercase letterspaced overline rather than the
  prior border-bottomed heading. The card carries the visual weight;
  the heading recedes.
- **Quick Action buttons → outline grid.** Action buttons adopt
  `sandbox-dashboard`'s outline aesthetic: transparent background,
  theme-foreground text, soft 1px border, hover fills with
  `--vscode-toolbar-hoverBackground`, `transform: scale(0.98)` on
  click for tactile feedback. Buttons inside an action card lay out
  as a responsive CSS grid (`repeat(auto-fit, minmax(220px, 1fr))`)
  — typically 2 columns at standard webview widths, gracefully
  collapsing to 1 on narrow panels and expanding to 3+ on wide ones.
- **Per-button descriptions removed.** The descriptive paragraph
  under each Quick Action button (e.g., "Inspect or edit the
  `topology.clab.yml` source.") is dropped at render time to match
  `sandbox-dashboard`'s compact grid. The button label + emoji
  carries the meaning. Section-level descriptions (the prose that
  appears between an `<h2>` and its content, e.g., the SSH section's
  "One click → logged in.") are preserved.
- **Two-tone Arista badge palette.** `Validated with` and `Resources`
  badges now use the official Arista palette per the 2025 brand
  guidelines: Arista Dark Gray (`#58585B`) label half, Arista Blue
  (`#16325B`) value half, white text on both. Pinned hex on purpose
  — brand colors must render identically in both light and dark
  themes.
- **SSH pills preserved unchanged.** The `.lab-ssh-pill` styling
  introduced in v0.14.x — Arista Blue hover, `$ ` prefix, lift +
  shadow on hover — is kept exactly as-is. SSH pills remain the
  single brand-colored interaction surface, which is what lets the
  brand color *mean* something rather than becoming the default
  hover color for everything.

### Compatibility
- **No markdown source changes required.** Lab authors and the
  `init_lab.py` generator (in `lab-base-techlib`) emit the same
  markdown as before. The new post-processor (`wrapDashboardSections`
  in `renderer.ts`) interprets the existing structure into the new
  visual shape.
- **No new commands, no behavior changes, no breaking changes.** Same
  buttons, same number of buttons, same click targets. Pure
  visual + DOM-shape refactor.
- Safe in-place upgrade from 0.14.x.



### Changed
- **Quick Action buttons are larger and more substantial.** Padding
  bumped from `0.4em 0.9em` to `0.6em 1.2em` and font-size set
  explicitly to `1em` (was inheriting a smaller size from context,
  which made buttons look thin per user feedback). Buttons now feel
  like confident click targets rather than links wearing a costume.
- **Shape parity with SSH pills.** Quick Actions and SSH pills now
  share the same lift + shadow family on hover and the same `:active`
  press-feedback reset. They feel like members of the same control
  family.
- **Deliberate hierarchy preserved.** Quick Actions keep the VS Code
  theme-driven hover color (not Arista Blue). SSH pills remain the
  single branded interaction on the dashboard — that distinction is
  what lets the brand color *mean* something rather than becoming
  "what happens when you hover on anything."

### Compatibility
- Pure CSS polish; no behavior changes, no new commands, no breaking
  changes. Safe in-place upgrade from 0.14.1.

## [0.14.1] - 2026-04-22

### Changed
- **SSH pills are larger and more legible.** Padding bumped from
  `0.3em 0.7em` to `0.45em 0.9em`; font-size from `0.85em` to `0.95em`.
  Still compact enough to fit many per row, but readable at a glance
  without squinting.
- **SSH pill hover adopts Arista Blue (`#16325b`) with white text.**
  Ties the pills to the PacketAnglers / Arista visual identity and
  creates a clear hierarchy — SSH pills are the brand-colored node
  interaction, Quick Action buttons remain VS Code theme-driven.
- **Quick Action buttons get a more pronounced hover effect.** Added
  a 1px lift via `transform: translateY(-1px)` plus a soft drop
  shadow. Transition bumped from 0.1s to 0.15s so the interaction
  feels intentional rather than snappy. Both button systems now
  share the lift + shadow, differing only in their hover color —
  cohesive but distinguishable.
- Added `:active` states on both button systems that reset the lift,
  giving visual feedback at the moment of the click.
- The `$` prefix on SSH pills becomes slightly more opaque on hover
  (0.5 → 0.85), reinforcing the active state.

### Compatibility
- Pure CSS polish; no behavior changes, no new commands, no breaking
  changes. Safe in-place upgrade from 0.14.0.

## [0.14.0] - 2026-04-22

### Added
- **`labDashboard.sshToNode` command.** Opens a terminal pre-typed with
  `ssh <user>@<node>` and runs it immediately — one click goes from
  dashboard to logged-in shell. Supports per-node terminal reuse:
  clicking the same node twice surfaces the existing terminal instead
  of spawning a duplicate.

  Args: `{ node: string, user?: string }`. The `user` argument defaults
  to `"admin"` (the lab convention). Stale terminals (closed by the
  user, then re-clicked) are detected and replaced cleanly via the
  `onDidCloseTerminal` listener.

- **SSH pill grid CSS.** New `.lab-ssh-group`, `.lab-ssh-group-label`,
  `.lab-ssh-pills`, and `.lab-ssh-pill` classes for compact, flex-wrap
  pill layouts that scale from 4 to 30+ nodes without dominating the
  dashboard. Pills use the editor's monospace font, a subtle `$` prefix
  to telegraph terminal action, and a hover state that adopts the
  primary button color.

### Pairs with
- lab-base-techlib 1.0.4+ which extends `init_lab.py` to render an
  "SSH to Nodes" section in `LAB-READY.md` using the new command.

## [0.13.0] - 2026-04-22

### Changed
- **Conditional init_lab launch delay.** The 5-second wait for an editor
  event before launching `init_lab.py` was introduced in 0.11.x to
  deterministically order the terminal tab relative to an auto-opening
  README. It now fires only when `workbench.startupEditor` is actually
  set to `readme`. When the setting is `none`, `welcomePage`, or any
  other value, no README auto-opens and no race exists, so `init_lab`
  launches immediately — eliminating the dead air users saw between
  code-server boot and the init TUI appearing.
- The 5-second fallback remains in place for the `startupEditor=readme`
  path, in case the workspace is configured to open README but no
  README.md file exists.

### Compatibility
- Works with any value of `workbench.startupEditor`. Pairs particularly
  well with lab-base-techlib 1.0.2+ which removes the `startupEditor`
  setting entirely for a zero-delay boot experience.

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
