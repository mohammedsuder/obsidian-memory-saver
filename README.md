# Plugin Memory Monitor

An Obsidian desktop plugin that shows Obsidian's memory and plugin count in the status bar, and lets each device start Obsidian in **Standard**, **Lite** or **Extreme** mode so plugins you don't need never load.

Obsidian plugins use memory as soon as they load, and a plugin that has loaded keeps most of that memory until Obsidian restarts. Switching plugins off during a session therefore saves very little. Not loading them at start-up does.

| Start mode | What loads at start-up |
|---|---|
| 🧩 Standard | Every plugin switched on in Settings → Community plugins. Normal Obsidian. |
| 🪶 Lite | Only the plugins you tick for Lite (shared across your devices), and only if they are switched on. |
| ⛔ Extreme | No community plugins except this one. |

Only community plugins are affected. Obsidian's core plugins (Daily notes, Search and so on) load as set in Settings → Core plugins in every mode.

## Using it

- **Status bar:** mode icon and name (how this session started), `🧩 running / switched on`, and the memory used by the Obsidian window where plugins run. Task Manager shows a higher total because it also counts Obsidian's other processes.
- **Click the status bar** for the popup: what was skipped at start-up, the start-mode switch (hover each mode for what it does), **Restart in …** and **Plugin list**. The help icon explains everything in the app.
- **Choosing a start mode changes nothing until Obsidian restarts.** The popup shows "Next start: …" until then. The choice is stored on this device only.
- **Plugin list:** what is running now, a 🧩 Standard tick (the same switch as Settings → Community plugins, so it applies on every device; unticking asks first), a 🪶 Lite tick, and **Load now** / **Unload now** for the current session only.
- Commands: Restart Obsidian in Standard / Lite / Extreme mode (this device), Open plugin list, Move to the top of the plugin list.

## How a Lite or Extreme start works

- Obsidian loads community plugins one at a time, in the order of `.obsidian/community-plugins.json` (verified in Obsidian 1.14.4). Placed first in that list, this plugin wraps Obsidian's plugin loader during start-up and skips plugins outside the start mode.
- Only Obsidian's start-up loading is intercepted. Switching a plugin on in Settings is never blocked, and interception ends once start-up has finished.
- Choosing Lite or Extreme moves this plugin to the top of the list automatically; only the order changes. A plugin installed from the community directory is added at the end of that list, so this step matters. If it is not first, the popup warns and offers **Move to top**.
- Skipped plugins stay switched on, so a Standard start loads them all again.
- Fail-safe: if this plugin is removed, switched off or not first in the list, Obsidian loads plugins as normal. If you switch it off after a Lite start, it loads what it skipped.

### Measured example (Obsidian 1.14.4, about 35 community plugins)

| | Window memory | JavaScript heap |
|---|---|---|
| Standard start | 446 MB | 177 MB |
| Lite start (8 plugins) | 295 MB | 90 MB |
| Switching from Standard to Extreme during a session | 1009 MB → 976 MB | |

## Storage

| Where | What | Shared across devices? |
|---|---|---|
| Plugin settings (`data.json`) | Lite plugins, refresh interval | Yes, if your vault syncs |
| Local storage (per device, per vault) | Start mode, a copy of the Lite list for start-up, how this session started | No |

## Notes

- The plugin id is `plugin-monitor` (the original name); the display name is Plugin Memory Monitor.
- Desktop only. It relies on Obsidian internals that are not part of the public API (`app.plugins`, the order of `community-plugins.json`), so an Obsidian update could change its behaviour. If that happens, the fail-safe above applies.

## Install

Requires Obsidian 1.8.7 or later on desktop. Tested on Obsidian 1.14.4.

- **From a release:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/mohammedsuder/obsidian-plugin-memory-monitor/releases/latest), put them in `<your vault>/.obsidian/plugins/plugin-monitor/`, then switch the plugin on in Settings → Community plugins.
- **With BRAT:** add `mohammedsuder/obsidian-plugin-memory-monitor` as a beta plugin.
- **From source:** build it (below) and copy the same three files.

## Build, test, install into a vault

```
npm install
npm test               # unit tests for the start-mode logic (node:test)
npm run build          # type-check (tsc) and bundle main.js (esbuild)
npm run install-vault  # copy the build into a vault (set OBSIDIAN_VAULT, or put the vault path in a .vault-path file)
npm run dev            # rebuild on change
```

Built with Obsidian API 1.14.4, TypeScript 7.0.2, esbuild 0.28.2, Node 24.

## Author

Mohammed Suder · [github.com/mohammedsuder](https://github.com/mohammedsuder)

## Licence

MIT, see [LICENSE](LICENSE).
