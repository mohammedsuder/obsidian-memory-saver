// Pure start-mode logic: no Obsidian imports, so it can be unit-tested in Node.

export type Mode = 'full' | 'lite' | 'extreme';

/** Plugins that should load in a mode. Never contains the monitor itself. */
export function targetSet(mode: Mode, fullSet: string[], liteSet: string[], selfId: string): string[] {
	const base = fullSet.filter((id) => id !== selfId);
	if (mode === 'full') return base;
	if (mode === 'lite') {
		const keep = new Set(liteSet);
		return base.filter((id) => keep.has(id));
	}
	return [];
}

/**
 * Start-up plan for starting Obsidian in Lite or Extreme. Obsidian loads community plugins one at a time in
 * the order of community-plugins.json, so only plugins listed after the monitor can still be skipped.
 */
export function startupPlan(savedOrder: string[], selfId: string, startMode: Mode, liteSet: string[]): { skip: string[] } {
	const keep = new Set(targetSet(startMode, savedOrder, liteSet, selfId));
	const selfAt = savedOrder.indexOf(selfId);
	const later = selfAt < 0 ? [] : savedOrder.slice(selfAt + 1);
	return { skip: later.filter((id) => !keep.has(id)) };
}

/**
 * The Lite set to use when settings load, and whether it still has to be saved. A saved set always wins. Without
 * one, a copy cached on this device by an earlier version keeps what the user had (versions up to 0.5.0 fell back to
 * a built-in list without saving it). Otherwise this is a first install: Lite starts as every plugin switched on now,
 * so it loads the same as Standard until the user unticks plugins.
 */
export function initialLiteSet(saved: unknown, cached: unknown, switchedOn: string[], selfId: string): { liteSet: string[]; needsSave: boolean } {
	const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
	if (isList(saved)) return { liteSet: saved, needsSave: false };
	if (isList(cached)) return { liteSet: cached, needsSave: true };
	return { liteSet: switchedOn.filter((id) => id !== selfId), needsSave: true };
}

/** The saved list with the monitor moved to the front, everything else in its existing order. */
export function moveToFront(savedOrder: string[], selfId: string): string[] {
	return [selfId, ...savedOrder.filter((id) => id !== selfId)];
}

/**
 * True when a record was written in this Obsidian window session (performance.timeOrigin), i.e. only the
 * monitor was reloaded since. False after Obsidian restarts, or for records without a session id.
 */
export function sameSession(record: { sessionId?: number }, sessionId: number): boolean {
	return typeof record.sessionId === 'number' && record.sessionId === sessionId;
}
