# Memory Saver

<a href="https://ko-fi.com/mohsu"><img src="docs/images/support-me-on-kofi.webp" alt="Support me on Ko-fi" height="36"></a>

**Save memory in Obsidian on resource-constrained machines.** Older laptops, low-RAM PCs and shared or virtual desktops feel the cost of every Obsidian plugin. Memory Saver lets each device start Obsidian with only the plugins it needs, so the rest never load and never use memory. It also shows Obsidian's memory and plugin count in the status bar, so you can see the effect.

| 🧩 Standard start | 🪶 Lite start | ⛔ Extreme start |
|:---:|:---:|:---:|
| <img src="docs/images/popup-standard.png" width="240" alt="Status bar popup after a Standard start: 34 of 35 plugins running, 842 MB window memory, 191 MB JavaScript heap"> | <img src="docs/images/popup-lite.png" width="240" alt="Status bar popup after a Lite start: 9 of 35 plugins running, 26 not loaded, 350 MB window memory, 94 MB JavaScript heap"> | <img src="docs/images/popup-extreme.png" width="240" alt="Status bar popup after an Extreme start: 1 of 35 plugins running, 34 not loaded, 288 MB window memory, 43 MB JavaScript heap"> |
| 34 of 35 plugins running · **842 MB** | 9 of 35 plugins running · **350 MB** | 1 of 35 plugins running · **288 MB** |

*The status bar popup on the same machine and vault, each read after memory had settled. Click the status bar to open it.*

| Start mode | What loads at start-up | Memory |
|---|---|---|
| 🧩 Standard | Every plugin switched on in Settings → Community plugins. Normal Obsidian. | Most |
| 🪶 Lite | Only the plugins you tick for Lite (shared across your devices), and only if they are switched on. | Less |
| ⛔ Extreme | No community plugins except this one. | Least |

Each device keeps its own start mode: a low-RAM laptop can start in Lite every day while your main PC, syncing the same vault, starts in Standard.

## Why start-up matters

Obsidian runs on Electron (Chromium). A community plugin uses memory as soon as it loads, and once loaded it keeps most of that memory until Obsidian restarts: switching a plugin off during a session hands very little back to the system. In one test, unloading every community plugin except Memory Saver from a running session took the window from 1009 MB to 976 MB, about 3%, even after forcing garbage collection. The only reliable way to save that memory is not to load the plugin in the first place, which is what the start modes do.

## How much can it save?

It depends on which plugins you use and what you have open. These are the readings shown in the screenshots above: one Windows PC, Obsidian 1.14.4, a vault with 35 community plugins switched on, each read 2 to 3 minutes after start-up once memory had settled.

| Start mode | Plugins running | Window memory | JavaScript heap |
|---|---|---|---|
| 🧩 Standard | 34 of 35 (one fails to load in this vault) | 842 MB | 191 MB |
| 🪶 Lite | 9 of 35 (the 8 ticked for Lite, plus Memory Saver) | 350 MB, **58% less** | 94 MB, **51% less** |
| ⛔ Extreme | 1 of 35 (Memory Saver) | 288 MB, **66% less** | 43 MB, **77% less** |

Readings differ between restarts in the same mode (Extreme has read between 229 and 288 MB on this machine), so treat them as an example of the difference, not a guarantee.

## Tips for saving the most memory

- Start in **Lite** day to day, and tick only the plugins you rely on every day.
- Leave the heaviest plugins out of Lite. Plugins that index your whole vault or run AI models in the background tend to use the most memory.
- Need a plugin briefly? Use **Load now** in the plugin list. It lasts until the next restart.
- To get memory back, **restart** in a lighter mode. Unloading a plugin mid-session frees little.
- Read the status bar a few minutes after start-up: plugins that index your vault push memory up at first.
- Use **Extreme** for the lowest footprint, for example quick note-taking on a very constrained machine.

Only community plugins are affected. Obsidian's core plugins (Daily notes, Search and so on) load as set in Settings → Core plugins in every mode.

## Using it

- **Status bar:** mode icon and name (how this session started), `🧩 running / switched on`, and the memory used by the Obsidian window where plugins run. Task Manager shows a higher total because it also counts Obsidian's other processes.
- **Click the status bar** for the popup: the **Start-up mode** switch at the top (hover each mode for what it does) with **Restart in …**, then this session (how it started, plugins running, what was not loaded), memory, and **Manage plugin list**. The help icon explains everything in the app.
- **Choosing a start mode changes nothing until Obsidian restarts.** Until then the popup shows the mode that applies from the next start. The choice is stored on this device only.
- **Plugin list:** what is running now, a 🧩 Standard tick (the same switch as Settings → Community plugins, so it applies on every device; unticking asks first), a 🪶 Lite tick, and **Load now** / **Unload now** for the current session only.
- **Settings → Memory Saver:** start-up mode, how often memory is read, **Reset to suggested** for Lite and a shortcut to **Manage plugin list**, where Lite choices are made. Start-up mode and the refresh interval show up in Obsidian's settings search.
- Commands: Restart Obsidian in Standard / Lite / Extreme mode (this device), Open plugin list, Move to the top of the plugin list.

## How a Lite or Extreme start works

- Obsidian loads community plugins one at a time, in the order of `.obsidian/community-plugins.json` (verified in Obsidian 1.14.4). Placed first in that list, this plugin wraps Obsidian's plugin loader during start-up and skips plugins outside the start mode.
- Only Obsidian's start-up loading is intercepted. Switching a plugin on in Settings is never blocked, and interception ends once start-up has finished.
- Choosing Lite or Extreme moves this plugin to the top of the list automatically; only the order changes. A plugin installed from the community directory is added at the end of that list, so this step matters. If it is not first, the popup warns and offers **Move to top**.
- Skipped plugins stay switched on, so a Standard start loads them all again.
- Fail-safe: if this plugin is removed, switched off or not first in the list, Obsidian loads plugins as normal. If you switch it off after a Lite start, it loads what it skipped.

## Storage

| Where | What | Shared across devices? |
|---|---|---|
| Plugin settings (`data.json`) | Lite plugins, refresh interval | Yes, if your vault syncs |
| Local storage (per device, per vault) | Start mode, a copy of the Lite list for start-up, how this session started | No |

## Notes

- The plugin id is `memory-saver`. Versions up to 0.3.1 were called Plugin Memory Monitor, with the id `plugin-monitor`.
- This repository was called `obsidian-plugin-memory-monitor` up to 0.4.0. Old links and BRAT entries redirect here.
- Desktop only. It relies on Obsidian internals that are not part of the public API (`app.plugins`, the order of `community-plugins.json`), so an Obsidian update could change its behaviour. If that happens, the fail-safe above applies.

## Install

### Upgrading from 0.3.x (Plugin Memory Monitor)

The plugin was renamed and its id changed in 0.4.0, so Obsidian treats it as a new plugin. Install 0.4.0 into `.obsidian/plugins/memory-saver/`, switch on **Memory Saver**, then switch off and delete Plugin Memory Monitor. Your start-up mode and Lite choices carry over on each device. Choosing Lite or Extreme again moves Memory Saver to the top of your plugin list.

Requires Obsidian 1.13.0 or later on desktop (0.4.1 is the last version for older Obsidian). Tested on Obsidian 1.14.4.

- **From Obsidian (recommended):** Settings → Community plugins → Browse, search for **Memory Saver**, then Install and Enable. It is listed in the [Obsidian community directory](https://community.obsidian.md/plugins/memory-saver).
- **From a release:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/mohammedsuder/obsidian-memory-saver/releases/latest), put them in `<your vault>/.obsidian/plugins/memory-saver/`, then switch the plugin on in Settings → Community plugins.
- **With BRAT:** add `mohammedsuder/obsidian-memory-saver` as a beta plugin.
- **From source:** build it (below) and copy the same three files.

## Build, test, install into a vault

```
npm install
npm run lint           # the Obsidian community directory's lint rules (eslint-plugin-obsidianmd)
npm test               # unit tests for the start-mode logic (node:test)
npm run build          # type-check (tsc) and bundle main.js (esbuild)
npm run install-vault  # copy the build into a vault (set OBSIDIAN_VAULT, or put the vault path in a .vault-path file)
npm run dev            # rebuild on change
```

Built with Obsidian API 1.14.4, TypeScript 6.0.3, esbuild 0.28.2, Node 24. Linted with eslint-plugin-obsidianmd 0.4.2 on ESLint 9 and typescript-eslint 8, which do not support TypeScript 7 yet.

## Author

Mohammed Ilyas Suder · [github.com/mohammedsuder](https://github.com/mohammedsuder)

I love building creative, practical software. If Memory Saver saves you memory, you can support it on [Ko-fi](https://ko-fi.com/mohsu): contributions make further free, useful software possible.

## Licence

MIT, see [LICENSE](LICENSE).
