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
