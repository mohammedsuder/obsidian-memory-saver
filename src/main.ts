import { App, MarkdownView, Modal, Notice, Plugin, PluginManifest, PluginSettingTab, Setting, setIcon, setTooltip } from 'obsidian';
import { Mode, moveToFront, sameSession, startupPlan } from './modes';
import { MemoryReading, fmtMb, readMemory } from './memory';

/**
 * Obsidian's plugin manager (app.plugins). Not in the public API; behaviour verified against Obsidian 1.14.4
 * app.js: community plugins load one at a time in community-plugins.json order via enablePlugin(id);
 * disablePlugin/enablePlugin never touch the saved list; saveConfig writes Array.from(enabledPlugins).
 */
interface PluginsApi {
	manifests: Record<string, PluginManifest>;
	plugins: Record<string, Plugin>;
	enabledPlugins: Set<string>;
	enablePlugin(id: string, ...rest: unknown[]): Promise<boolean>;
	disablePlugin(id: string): Promise<void>;
	enablePluginAndSave(id: string): Promise<boolean>;
	disablePluginAndSave(id: string): Promise<void>;
	saveConfig(): Promise<void>;
}

interface Settings {
	liteSet: string[];
	refreshSeconds: number;
}

/** How this Obsidian session started, so a reload of the monitor mid-session still knows. */
interface StartRecord {
	mode: Mode;
	skipped: string[];
	sessionId: number;
}

export const SUGGESTED_LITE = [
	'obsidian-tasks-plugin', 'templater-obsidian', 'dataview', 'calendar', 'table-editor-obsidian',
	'obsidian-admonition', 'obsidian-dynamic-toc', 'obsidian-reminder-plugin',
];
const DEFAULTS: Settings = { liteSet: SUGGESTED_LITE, refreshSeconds: 5 };
/** Per device: the mode Obsidian starts in. */
const START_KEY = 'plugin-monitor-start-mode';
/** Per device copy of the Lite set, readable synchronously at start-up before settings load. */
const LITE_CACHE_KEY = 'plugin-monitor-lite-set';
/** Per device record of the current session's start. */
const RECORD_KEY = 'plugin-monitor-start-record';
// Internally the everyday mode is 'full'; it is shown to the user as Standard.
const LABEL: Record<Mode, string> = { full: 'Standard', lite: 'Lite', extreme: 'Extreme' };
const ICON: Record<Mode, string> = { full: '🧩', lite: '🪶', extreme: '⛔' };
const COMMAND: Record<Mode, string> = { full: 'standard', lite: 'lite', extreme: 'extreme' };
const MODES: Mode[] = ['full', 'lite', 'extreme'];
/** Hover text for each start mode. */
const MODE_HELP: Record<Mode, string> = {
	full: 'Standard: start with every plugin that is switched on (ticked under Standard in the plugin list, the same as Settings → Community plugins). Normal Obsidian, uses the most memory.',
	lite: 'Lite: start with only the plugins ticked under Lite in the plugin list. The others stay switched on but are not loaded, so they use no memory.',
	extreme: 'Extreme: start with no plugins except this monitor. Uses the least memory. Plugin features are unavailable until you restart in Standard or use "Load now" in the plugin list.',
};
const TAKES_EFFECT = 'Takes effect when Obsidian restarts; nothing changes until then.';
const AUTHOR = 'Mohammed Suder';
const REPO_URL = 'https://github.com/mohammedsuder/obsidian-plugin-memory-monitor';
/** Same for every load of this plugin within one Obsidian window session; changes when Obsidian restarts. */
const SESSION_ID = performance.timeOrigin;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export default class PluginMonitor extends Plugin {
	settings: Settings = { ...DEFAULTS };
	/** The mode this Obsidian session started in, and which plugins were skipped. */
	startedIn: Mode = 'full';
	skippedAtStart: string[] = [];
	notFirstAtStart = false;
	last: MemoryReading | null = null;
	private statusEl!: HTMLElement;
	private popEl: HTMLElement | null = null;
	private popCleanup: (() => void) | null = null;
	private timer: number | null = null;
	private pendingSkip = new Set<string>();
	private restoreEnable: (() => void) | null = null;

	get api(): PluginsApi {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (this.app as any).plugins as PluginsApi;
	}

	get selfId(): string {
		return this.manifest.id;
	}

	async onload() {
		// Must run before the first await: Obsidian loads community plugins one at a time, and plugins listed
		// after this one load as soon as this onload yields. Only during start-up (workspace not ready yet).
		const freshStart = !this.app.workspace.layoutReady;
		const startMode = this.startMode();
		if (freshStart && startMode !== 'full') this.beginStartupSkip(startMode);
		else if (!freshStart) this.restoreStartRecord();

		await this.loadSettings();
		this.cacheLiteSet();
		// Status bar: start mode, plugin counter and memory. Click opens the popup.
		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass('plugin-monitor-status');
		this.registerDomEvent(this.statusEl, 'click', () => (this.popEl ? this.closePopup() : this.openPopup()));
		this.addCommands();
		this.addSettingTab(new MonitorSettingTab(this.app, this));
		if (freshStart && this.startedIn !== 'full') {
			this.app.workspace.onLayoutReady(() => {
				// Every plugin has had its turn by now; stop intercepting shortly after as a safety net.
				window.setTimeout(() => this.endStartupSkip(), 10000);
				new Notice(`${ICON[this.startedIn]} Started in ${LABEL[this.startedIn]} mode: ${this.skippedAtStart.length} plugins not loaded.`
					+ (this.notFirstAtStart ? '\nPlugin Memory Monitor is not first in your plugin list, so some plugins loaded before it could act. Use "Move to top" in its popup.' : ''), 10000);
			});
		}
		this.startRefresh();
		void this.refresh();
	}

	onunload() {
		this.endStartupSkip();
		this.closePopup();
		// If you switch the monitor itself off after a Lite or Extreme start, load what it skipped.
		// _userDisabled is set by Obsidian only when a user disables the plugin, not on app quit.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		if ((this as any)._userDisabled && this.skippedAtStart.length) {
			const api = this.api;
			const toLoad = this.skippedAtStart.filter((id) => api.enabledPlugins.has(id) && !api.plugins[id]);
			new Notice(`Plugin Memory Monitor turned off: loading the ${toLoad.length} plugins it skipped at start-up.`);
			void (async () => {
				for (const id of toLoad) {
					try { await api.enablePlugin(id); } catch (e) { console.error('Plugin Memory Monitor: could not load', id, e); }
				}
			})();
			this.app.saveLocalStorage(RECORD_KEY, null);
		}
	}

	// ---------- settings and per-device storage ----------

	async loadSettings() {
		const data = (await this.loadData()) ?? {};
		this.settings = { liteSet: data.liteSet ?? DEFAULTS.liteSet, refreshSeconds: data.refreshSeconds ?? DEFAULTS.refreshSeconds };
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.cacheLiteSet();
	}

	cacheLiteSet() {
		this.app.saveLocalStorage(LITE_CACHE_KEY, this.settings.liteSet);
	}

	startMode(): Mode {
		const m = this.app.loadLocalStorage(START_KEY);
		return m === 'lite' || m === 'extreme' ? m : 'full';
	}

	running(): string[] {
		return Object.keys(this.api.plugins);
	}

	saved(): string[] {
		return Array.from(this.api.enabledPlugins);
	}

	pluginName(id: string): string {
		return this.api.manifests[id]?.name ?? id;
	}

	// ---------- starting Obsidian in Lite or Extreme ----------

	/**
	 * Intercepts Obsidian's start-up loop so plugins outside the start mode are never loaded. The loop calls
	 * enablePlugin(id) with only the id; user actions (enablePluginAndSave) pass a second argument and are
	 * never intercepted. Skipped plugins stay on the saved list, so a Standard start loads them.
	 */
	beginStartupSkip(mode: Mode) {
		const api = this.api;
		const saved = Array.from(api.enabledPlugins);
		const liteSet = (this.app.loadLocalStorage(LITE_CACHE_KEY) as string[] | null) ?? SUGGESTED_LITE;
		this.notFirstAtStart = saved[0] !== this.selfId;
		this.startedIn = mode;
		this.pendingSkip = new Set(startupPlan(saved, this.selfId, mode, liteSet).skip);
		this.saveStartRecord();
		if (!this.pendingSkip.size) return;

		const hadOwn = Object.prototype.hasOwnProperty.call(api, 'enablePlugin');
		const original = api.enablePlugin;
		const wrapper = async (id: string, ...rest: unknown[]): Promise<boolean> => {
			if (rest.length === 0 && this.pendingSkip.has(id)) {
				this.pendingSkip.delete(id);
				this.skippedAtStart.push(id);
				this.saveStartRecord();
				if (!this.pendingSkip.size) this.endStartupSkip();
				return false;
			}
			return original.call(api, id, ...rest);
		};
		api.enablePlugin = wrapper;
		this.restoreEnable = () => {
			if (api.enablePlugin !== wrapper) return; // someone else replaced it since; leave theirs alone
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			if (hadOwn) api.enablePlugin = original; else delete (api as any).enablePlugin;
		};
	}

	endStartupSkip() {
		this.pendingSkip.clear();
		this.restoreEnable?.();
		this.restoreEnable = null;
	}

	saveStartRecord() {
		const record: StartRecord = { mode: this.startedIn, skipped: this.skippedAtStart, sessionId: SESSION_ID };
		this.app.saveLocalStorage(RECORD_KEY, record);
	}

	/** After a mid-session reload of the monitor, recover how this session started. */
	restoreStartRecord() {
		const r = this.app.loadLocalStorage(RECORD_KEY) as StartRecord | null;
		if (r && sameSession(r, SESSION_ID) && MODES.includes(r.mode)) {
			this.startedIn = r.mode;
			this.skippedAtStart = Array.isArray(r.skipped) ? r.skipped : [];
		} else {
			// One-off migration from 0.1, which stored { mode, fullSet, sessionId } under another key.
			const old = this.app.loadLocalStorage('plugin-monitor-state') as { mode?: Mode; fullSet?: string[]; sessionId?: number } | null;
			if (old && old.mode && sameSession(old, SESSION_ID) && Array.isArray(old.fullSet)) {
				this.startedIn = old.mode;
				this.skippedAtStart = old.fullSet.filter((id) => !this.api.plugins[id]);
				this.saveStartRecord();
			}
		}
		// Keys from 0.1 that are no longer used.
		this.app.saveLocalStorage('plugin-monitor-state', null);
		this.app.saveLocalStorage('plugin-monitor-measurements', null);
	}

	isFirstInList(): boolean {
		return Array.from(this.api.enabledPlugins)[0] === this.selfId;
	}

	/** Moves the monitor to the top of community-plugins.json. Only the order changes. */
	async moveToTop(): Promise<boolean> {
		const api = this.api;
		if (!api.enabledPlugins.has(this.selfId)) {
			new Notice('Switch Plugin Memory Monitor on in Settings → Community plugins first, so it is on your saved plugin list.', 10000);
			return false;
		}
		if (this.isFirstInList()) return true;
		const order = moveToFront(Array.from(api.enabledPlugins), this.selfId);
		api.enabledPlugins.clear();
		order.forEach((id) => api.enabledPlugins.add(id));
		await api.saveConfig();
		new Notice('Moved Plugin Memory Monitor to the top of your plugin list so it loads first. Only the order changed.', 8000);
		return true;
	}

	async chooseStartMode(mode: Mode) {
		if (mode !== 'full' && !(await this.moveToTop())) return;
		this.app.saveLocalStorage(START_KEY, mode === 'full' ? null : mode);
		this.cacheLiteSet();
		void this.refresh();
	}

	/** Saves open notes, then reloads Obsidian so it starts in the chosen start mode. */
	async restartObsidian() {
		const views: MarkdownView[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => { if (leaf.view instanceof MarkdownView) views.push(leaf.view); });
		for (const v of views) {
			try { await v.save(); } catch (e) { console.error('Plugin Memory Monitor: could not save before restart', e); }
		}
		await sleep(300);
		window.location.reload();
	}

	addCommands() {
		MODES.forEach((mode) => this.addCommand({
			id: `restart-${COMMAND[mode]}`,
			name: `Restart Obsidian in ${LABEL[mode]} mode (this device)`,
			callback: async () => {
				await this.chooseStartMode(mode);
				if (this.startMode() === mode) void this.restartObsidian();
			},
		}));
		this.addCommand({ id: 'open-monitor', name: 'Open plugin list', callback: () => new MonitorModal(this.app, this).open() });
		this.addCommand({ id: 'move-to-top', name: 'Move to the top of the plugin list', callback: () => void this.moveToTop() });
	}

	// ---------- status bar and popup ----------

	startRefresh() {
		if (this.timer !== null) window.clearInterval(this.timer);
		this.timer = this.registerInterval(window.setInterval(() => void this.refresh(), Math.max(2, this.settings.refreshSeconds) * 1000));
	}

	async refresh() {
		const m = await readMemory();
		this.last = m;
		const running = this.running().length;
		const saved = this.saved().length;
		const mem = m.source === 'none' ? '?' : fmtMb(m.mb);
		this.statusEl.setText(`${ICON[this.startedIn]} ${LABEL[this.startedIn]} · 🧩 ${running}/${saved} · ${mem}`);
		setTooltip(this.statusEl, `Plugin Memory Monitor: started in ${LABEL[this.startedIn]} mode, ${running} of ${saved} plugins running. Click for start mode and details.`, { placement: 'top' });
		this.renderPopup();
	}

	openPopup() {
		const pop = document.body.createDiv({ cls: 'pm-popover' });
		this.popEl = pop;
		const r = this.statusEl.getBoundingClientRect();
		pop.setCssStyles({ right: `${Math.max(8, window.innerWidth - r.right)}px`, bottom: `${window.innerHeight - r.top + 6}px` });
		const onDown = (e: MouseEvent) => {
			const t = e.target as Node;
			if (!pop.contains(t) && !this.statusEl.contains(t)) this.closePopup();
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.closePopup(); };
		document.addEventListener('mousedown', onDown, true);
		document.addEventListener('keydown', onKey, true);
		this.popCleanup = () => {
			document.removeEventListener('mousedown', onDown, true);
			document.removeEventListener('keydown', onKey, true);
		};
		this.renderPopup();
	}

	closePopup() {
		this.popCleanup?.();
		this.popCleanup = null;
		this.popEl?.remove();
		this.popEl = null;
	}

	renderPopup() {
		const pop = this.popEl;
		if (!pop) return;
		pop.empty();
		const m = this.last;
		const saved = this.saved();
		const installed = Object.keys(this.api.manifests).length;
		const start = this.startMode();

		// Header
		const head = pop.createDiv({ cls: 'pm-pop-head' });
		head.createSpan({ cls: 'pm-pop-title', text: 'Plugin Memory Monitor' });
		this.addHelpIcon(head);

		// Start-up mode: the setting that saves memory, first.
		const modeSec = pop.createDiv({ cls: 'pm-pop-section' });
		modeSec.createDiv({ cls: 'pm-pop-label', text: 'Start-up mode · this device' });
		const toggle = modeSec.createDiv({ cls: 'pm-toggle' });
		for (const mode of MODES) {
			const seg = toggle.createSpan({ cls: 'pm-seg', text: `${ICON[mode]} ${LABEL[mode]}` });
			seg.toggleClass('is-active', start === mode);
			setTooltip(seg, `${MODE_HELP[mode]}\n${TAKES_EFFECT}`, { placement: 'bottom' });
			seg.onclick = () => { if (mode !== start) void this.chooseStartMode(mode); };
		}
		const pending = start !== this.startedIn;
		const caption = modeSec.createDiv({
			cls: `pm-pop-caption${pending ? ' is-pending' : ''}`,
			text: pending ? `${LABEL[start]} from the next start. Restart to apply.` : 'Takes effect after restart',
		});
		setTooltip(caption, 'Plugins left out at start-up are never loaded, which is what saves memory. Each device keeps its own start-up mode.', { placement: 'bottom' });
		if (start !== 'full' && !this.isFirstInList()) {
			const warn = modeSec.createDiv({ cls: 'pm-pop-warn' });
			warn.createSpan({ text: 'Must be first in your plugin list to load before the others. ' });
			const fix = warn.createEl('button', { text: 'Move to top' });
			fix.onclick = async () => { await this.moveToTop(); this.renderPopup(); };
		}
		const restart = modeSec.createEl('button', { cls: `pm-restart${pending ? ' mod-cta' : ''}`, text: `Restart in ${ICON[start]} ${LABEL[start]}` });
		setTooltip(restart, 'Saves your open notes, then reloads Obsidian in this mode.', { placement: 'bottom' });
		restart.onclick = () => { this.closePopup(); void this.restartObsidian(); };

		// This session
		const sess = pop.createDiv({ cls: 'pm-pop-section' });
		sess.createDiv({ cls: 'pm-pop-label', text: 'This session' });
		const rows = sess.createDiv({ cls: 'pm-pop-rows' });
		const row = (key: string, value: string, tip?: string) => {
			rows.createSpan({ cls: 'pm-pop-key', text: key });
			const v = rows.createSpan({ cls: 'pm-pop-val', text: value });
			if (tip) setTooltip(v, tip, { placement: 'left' });
		};
		row('Started in', `${ICON[this.startedIn]} ${LABEL[this.startedIn]}`);
		row('Plugins running', `🧩 ${this.running().length} of ${saved.length}`, `${saved.length} switched on in Community plugins, ${installed} installed.`);
		if (this.skippedAtStart.length) row('Not loaded', `${this.skippedAtStart.length}`, 'Switched on, but left out at start-up by the start-up mode.');
		// After a Standard start, anything switched on but not running failed to load.
		const notRunning = this.startedIn === 'full' ? saved.filter((id) => !this.api.plugins[id]) : [];
		if (notRunning.length) sess.createDiv({ cls: 'pm-pop-warn', text: `Switched on but not running: ${notRunning.map((id) => this.pluginName(id)).join(', ')}` });

		// Memory
		const memSec = pop.createDiv({ cls: 'pm-pop-section' });
		memSec.createDiv({ cls: 'pm-pop-label', text: 'Memory' });
		const big = memSec.createDiv({ cls: 'pm-pop-mem' });
		const [value, unit] = m && m.source !== 'none' ? fmtMb(m.mb).split(' ') : ['?', ''];
		big.createSpan({ cls: 'pm-pop-mem-value', text: value });
		big.createSpan({ cls: 'pm-pop-mem-unit', text: `${unit} · Obsidian window` });
		setTooltip(big, 'Memory used by the Obsidian window, where plugins run. Task Manager shows more because it also counts Obsidian\'s other processes.', { placement: 'left' });
		if (m && m.heapMb !== null) memSec.createDiv({ cls: 'pm-pop-muted', text: `JavaScript heap ${fmtMb(m.heapMb)}` });

		// Footer
		const foot = pop.createDiv({ cls: 'pm-pop-footer' });
		const open = foot.createEl('button', { text: 'Manage plugin list' });
		setTooltip(open, 'Choose which plugins load in Standard and Lite, and load or unload a plugin for this session.', { placement: 'top' });
		open.onclick = () => { this.closePopup(); new MonitorModal(this.app, this).open(); };
	}

	/** A help icon that opens the About window. */
	addHelpIcon(parent: HTMLElement) {
		const help = parent.createSpan({ cls: 'pm-help clickable-icon' });
		setIcon(help, 'help-circle');
		setTooltip(help, 'What does this plugin do?', { placement: 'top' });
		help.onclick = () => { this.closePopup(); new AboutModal(this.app, this.manifest.version).open(); };
	}
}

// ---------- dialogs ----------

class ConfirmModal extends Modal {
	private answered = false;

	constructor(app: App, private message: string, private onYes: () => void, private onNo?: () => void) {
		super(app);
	}

	onOpen() {
		this.contentEl.createEl('p', { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Yes').setWarning().onClick(() => { this.answered = true; this.close(); this.onYes(); }))
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
	}

	onClose() {
		this.contentEl.empty();
		if (!this.answered) this.onNo?.(); // Cancel, Escape or clicking outside
	}
}

// ---------- shared building blocks for the popup-style windows ----------

/** A section with a small capital label, separated from the next by a rule. */
function section(parent: HTMLElement, label: string, cls = ''): HTMLElement {
	const s = parent.createDiv({ cls: `pm-m-section ${cls}`.trim() });
	s.createDiv({ cls: 'pm-label', text: label });
	return s;
}

/** Label-and-description rows, aligned in two columns. */
function defRows(parent: HTMLElement, rows: [string, string][]) {
	const grid = parent.createDiv({ cls: 'pm-m-rows' });
	for (const [key, desc] of rows) {
		grid.createDiv({ cls: 'pm-m-key', text: key });
		grid.createDiv({ cls: 'pm-m-desc', text: desc });
	}
}

function bullets(parent: HTMLElement, items: string[]) {
	const ul = parent.createEl('ul', { cls: 'pm-m-list' });
	items.forEach((text) => ul.createEl('li', { text }));
}

/** The mode help without its leading "Standard: " so it can sit beside the mode name. */
const modeDesc = (m: Mode) => MODE_HELP[m].replace(/^\w+: /, '');

/** Explains the plugin in plain language. Opened from the help icon. */
class AboutModal extends Modal {
	constructor(app: App, private version: string) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass('pm-modal', 'pm-about-modal');
		const c = this.contentEl;
		c.empty();

		const head = c.createDiv({ cls: 'pm-m-head' });
		head.createSpan({ cls: 'pm-m-title', text: 'Plugin Memory Monitor' });
		head.createSpan({ cls: 'pm-m-version', text: this.version });

		const body = c.createDiv({ cls: 'pm-m-scroll' });
		const intro = body.createDiv({ cls: 'pm-m-section pm-m-intro' });
		intro.createDiv({ cls: 'pm-m-lead', text: 'Save memory in Obsidian on machines with limited RAM.' });
		intro.createDiv({ cls: 'pm-m-text', text: 'Older laptops, low-memory PCs and virtual desktops feel the cost of every plugin. A community plugin uses memory as soon as it loads and keeps most of it until Obsidian restarts, so switching one off mid-session hands very little back. Plugin Memory Monitor lets each device choose which plugins load at start-up, so the rest never load at all.' });

		bullets(section(body, 'Saving memory'), [
			'Start in 🪶 Lite day to day, and tick only the plugins you rely on every day.',
			'Leave the heaviest plugins out of Lite. Plugins that index your whole vault or run AI models in the background tend to use the most memory.',
			'Need a plugin briefly? Use "Load now" in Manage plugin list. It lasts until the next restart.',
			'To get memory back, restart in a lighter mode. Unloading a plugin mid-session frees little.',
			'Check the memory figure a few minutes after starting: plugins that index your vault push it up at first.',
			'Use ⛔ Extreme for the lowest memory, for example quick note-taking on a very constrained machine.',
			'Each device has its own start-up mode, so a low-memory laptop can start in Lite while a desktop syncing the same vault starts in Standard.',
		]);

		const modes = section(body, 'Start-up modes');
		defRows(modes, MODES.map((m) => [`${ICON[m]} ${LABEL[m]}`, modeDesc(m)] as [string, string]));
		modes.createDiv({ cls: 'pm-m-note', text: 'Only community plugins are affected. Core plugins, such as Daily notes and Search, load as set in Settings → Core plugins in every mode.' });

		defRows(section(body, 'Status bar'), [
			['Mode', 'How this Obsidian session started: 🧩 Standard, 🪶 Lite or ⛔ Extreme.'],
			['🧩 running / on', 'Community plugins running now, out of those switched on in Settings → Community plugins.'],
			['Memory', 'Used by the Obsidian window, where plugins run. Task Manager shows more because it also counts Obsidian\'s other processes.'],
			['Click', 'Opens the popup: start-up mode, Restart, this session, memory and Manage plugin list.'],
		]);

		bullets(section(body, 'Changing mode'), [
			'Pick a mode under "Start-up mode" at the top of the status bar popup, then click Restart. Nothing changes until Obsidian restarts.',
			'The choice is stored on this device only. Your other devices keep starting the way they are set.',
			'Lite and Extreme put this plugin at the top of your plugin list, so it loads before the others and can stop them loading. Only the order changes.',
		]);

		defRows(section(body, 'Manage plugin list'), [
			[`${ICON.full} Standard tick`, 'The plugin is switched on. The same switch as Settings → Community plugins; applies on every device.'],
			[`${ICON.lite} Lite tick`, 'The plugin also loads at a Lite start. Lite choices are shared across devices.'],
			[`${ICON.extreme} Extreme`, 'Loads none of them.'],
			['Load / Unload now', 'This session only. The next start follows the start-up mode.'],
		]);

		bullets(section(body, 'Safe by design'), [
			'Starting in Lite or Extreme never removes plugins from your list. A Standard start loads them all again.',
			'If this plugin is removed, switched off or not first in the list, Obsidian loads your plugins as normal.',
		]);

		const foot = c.createDiv({ cls: 'pm-m-footer' });
		foot.createSpan({ text: `Plugin Memory Monitor ${this.version} by ${AUTHOR} · ` });
		foot.createEl('a', { text: 'Source and issues on GitHub', href: REPO_URL });
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Plugin list: what loads in Standard and Lite, and loading or unloading a plugin for this session. */
class MonitorModal extends Modal {
	constructor(app: App, private plugin: PluginMonitor) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass('pm-modal', 'pm-list-modal');
		void this.render();
	}

	async render() {
		const p = this.plugin;
		const { contentEl } = this;
		// Keep the table where it was when a button re-renders the window.
		const prevScroll = contentEl.querySelector('.pm-m-scroll')?.scrollTop ?? 0;
		contentEl.empty();
		const m = await readMemory();
		const running = new Set(p.running());
		const saved = new Set(p.saved());
		const skipped = new Set(p.skippedAtStart);
		const lite = new Set(p.settings.liteSet);
		const ids = Object.keys(p.api.manifests).filter((id) => id !== p.selfId);

		const head = contentEl.createDiv({ cls: 'pm-m-head' });
		head.createSpan({ cls: 'pm-m-title', text: 'Manage plugin list' });
		p.addHelpIcon(head);

		// Summary strip, like the popup's This session and Memory.
		const stats = section(contentEl, 'This session').createDiv({ cls: 'pm-m-stats' });
		const stat = (key: string, value: string, tip?: string) => {
			const s = stats.createDiv({ cls: 'pm-m-stat' });
			s.createDiv({ cls: 'pm-m-stat-value', text: value });
			s.createDiv({ cls: 'pm-m-stat-key', text: key });
			if (tip) setTooltip(s, tip, { placement: 'bottom' });
		};
		stat('Started in', `${ICON[p.startedIn]} ${LABEL[p.startedIn]}`);
		stat('Running', `${running.size} of ${saved.size}`, `${saved.size} switched on in Community plugins, ${ids.length + 1} installed.`);
		stat('Not loaded', `${skipped.size}`, 'Switched on, but left out at start-up by the start-up mode.');
		stat('Memory', m.source === 'none' ? '?' : fmtMb(m.mb), 'Used by the Obsidian window, where plugins run.');

		defRows(section(contentEl, 'How the start-up modes use this list'), [
			[`${ICON.full} Standard`, 'Loads every plugin ticked under Standard. The same switch as Settings → Community plugins; applies on every device.'],
			[`${ICON.lite} Lite`, 'Loads only plugins ticked under both Standard and Lite. Lite choices are shared across devices.'],
			[`${ICON.extreme} Extreme`, 'Loads none of them, only this monitor.'],
			['Load / Unload now', 'This session only, until Obsidian restarts.'],
		]);

		// Only the table scrolls; the header, summary and footer stay in place.
		const plugSec = section(contentEl, `Plugins · ${ids.length} installed`, 'pm-m-table-section');
		const scroll = plugSec.createDiv({ cls: 'pm-m-scroll' });
		const table = scroll.createEl('table', { cls: 'pm-m-table' });
		const hr = table.createEl('thead').createEl('tr');
		const headers: [string, string][] = [
			['Plugin', ''],
			['Now', 'What is running in this session.'],
			[`${ICON.full} Standard`, 'Switched on: loads at a Standard start. Same as Settings → Community plugins, applies on every device.'],
			[`${ICON.lite} Lite`, 'Also loads at a Lite start (if it is ticked under Standard too). Shared across your devices.'],
			['', ''],
		];
		headers.forEach(([text, tip]) => {
			const th = hr.createEl('th', { text });
			if (tip) setTooltip(th, tip, { placement: 'top' });
		});
		const body = table.createEl('tbody');
		ids.sort((a, b) => Number(running.has(b)) - Number(running.has(a)) || Number(saved.has(b)) - Number(saved.has(a)) || p.pluginName(a).localeCompare(p.pluginName(b)));

		for (const id of ids) {
			const tr = body.createEl('tr');
			tr.createEl('td', { cls: 'pm-m-name', text: p.pluginName(id) });
			const status = running.has(id) ? ['Running', 'is-running']
				: skipped.has(id) ? ['Not loaded', 'is-skipped']
					: saved.has(id) ? ['Not running', 'is-failed'] : ['Off', 'is-off'];
			const badge = tr.createEl('td').createSpan({ cls: `pm-badge ${status[1]}`, text: status[0] });
			if (skipped.has(id)) setTooltip(badge, `Switched on, but not loaded because this session started in ${LABEL[p.startedIn]}.`, { placement: 'top' });
			else if (status[1] === 'is-failed') setTooltip(badge, 'Switched on, but it did not load. Check Settings → Community plugins.', { placement: 'top' });

			// Standard = Obsidian's own on/off switch for the plugin (saved, all devices).
			const std = tr.createEl('td', { cls: 'pm-m-check' }).createEl('input', { type: 'checkbox' });
			std.checked = saved.has(id);
			setTooltip(std, std.checked ? 'Switched on. Untick to switch it off on every device.' : 'Tick to switch it on (loads now, and at every Standard start).', { placement: 'top' });
			std.onchange = async () => {
				if (std.checked) {
					await p.api.enablePluginAndSave(id);
					void p.refresh(); void this.render();
				} else {
					new ConfirmModal(this.app,
						`Switch ${p.pluginName(id)} off? It unloads now and stays off on every device, the same as switching it off in Settings → Community plugins.`,
						async () => { await p.api.disablePluginAndSave(id); void p.refresh(); void this.render(); },
						() => { std.checked = true; }).open();
				}
			};

			const liteTd = tr.createEl('td', { cls: 'pm-m-check' });
			const cb = liteTd.createEl('input', { type: 'checkbox' });
			cb.checked = lite.has(id);
			if (!saved.has(id)) liteTd.addClass('pm-dim');
			setTooltip(cb, saved.has(id) ? 'Loads at a Lite start. Shared across your devices.' : 'Tick Standard as well, otherwise it will not load in Lite either.', { placement: 'top' });
			cb.onchange = async () => {
				p.settings.liteSet = cb.checked ? [...p.settings.liteSet, id] : p.settings.liteSet.filter((x) => x !== id);
				await p.saveSettings();
			};

			const act = tr.createEl('td', { cls: 'pm-actions' });
			if (running.has(id)) {
				const off = act.createEl('button', { text: 'Unload now' });
				setTooltip(off, 'Stops it for this session only. It stays switched on.', { placement: 'top' });
				off.onclick = async () => { await p.api.disablePlugin(id); void p.refresh(); void this.render(); };
			} else {
				const on = act.createEl('button', { text: 'Load now' });
				setTooltip(on, 'Loads it for this session only. The next start follows the start-up mode.', { placement: 'top' });
				on.onclick = async () => { await p.api.enablePlugin(id); void p.refresh(); void this.render(); };
			}
		}

		const start = p.startMode();
		const foot = contentEl.createDiv({ cls: 'pm-m-footer' });
		foot.setText(`Start-up mode on this device: ${ICON[start]} ${LABEL[start]} · takes effect after restart`);
		scroll.scrollTop = prevScroll;
	}

	onClose() {
		this.contentEl.empty();
	}
}

class MonitorSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: PluginMonitor) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		const p = this.plugin;
		containerEl.empty();

		new Setting(containerEl).setName('Start-up mode (this device)')
			.setDesc('Plugins outside this mode are never loaded at start-up, which is what saves memory. Stored on this device only. Lite and Extreme move Plugin Memory Monitor to the top of your plugin list so it loads first.')
			.addDropdown((d) => {
				MODES.forEach((m) => d.addOption(m, `${ICON[m]} ${LABEL[m]}`));
				d.setValue(p.startMode()).onChange(async (v) => { await p.chooseStartMode(v as Mode); this.display(); });
			});
		new Setting(containerEl).setName('Refresh every (seconds)').setDesc('How often the status bar reads memory.')
			.addSlider((s) => s.setLimits(2, 60, 1).setValue(p.settings.refreshSeconds).setDynamicTooltip()
				.onChange(async (v) => { p.settings.refreshSeconds = v; await p.saveSettings(); p.startRefresh(); }));

		new Setting(containerEl).setName('Lite plugins').setHeading();
		new Setting(containerEl)
			.setDesc('Plugins that load when Obsidian starts in Lite. Shared across your devices. A plugin only loads if it is also switched on (ticked under Standard in the plugin list). The same choices appear in the plugin list.')
			.addButton((b) => b.setButtonText('Reset to suggested').onClick(async () => {
				p.settings.liteSet = [...SUGGESTED_LITE];
				await p.saveSettings();
				this.display();
			}));
		Object.keys(p.api.manifests).filter((id) => id !== p.selfId)
			.sort((a, b) => p.pluginName(a).localeCompare(p.pluginName(b)))
			.forEach((id) => {
				new Setting(containerEl)
					.setName(p.pluginName(id))
					.setDesc(`${id}${p.api.enabledPlugins.has(id) ? '' : ' · not switched on'}`)
					.addToggle((t) => t.setValue(p.settings.liteSet.includes(id)).onChange(async (v) => {
						p.settings.liteSet = v ? [...p.settings.liteSet, id] : p.settings.liteSet.filter((x) => x !== id);
						await p.saveSettings();
					}));
			});
	}
}
