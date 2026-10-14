// Memory readings for Obsidian's window process, where every community plugin runs.

export interface MemoryReading {
	/** Best available figure for the window process, in MB. */
	mb: number;
	/** JavaScript heap in MB, when available. */
	heapMb: number | null;
	source: 'private' | 'resident' | 'rss' | 'heap' | 'none';
}

const MB = 1024 * 1024;

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function readMemory(): Promise<MemoryReading> {
	const proc: any = (window as any).process;
	let heapMb: number | null = null;
	try {
		const u = proc?.memoryUsage?.();
		if (u?.heapUsed) heapMb = u.heapUsed / MB;
	} catch { /* not available */ }
	if (heapMb === null) {
		const pm = (performance as any).memory;
		if (pm?.usedJSHeapSize) heapMb = pm.usedJSHeapSize / MB;
	}
	// Electron: private/resident memory of this process, in kilobytes. Includes workers and native buffers.
	try {
		if (typeof proc?.getProcessMemoryInfo === 'function') {
			const info = await proc.getProcessMemoryInfo();
			if (info?.private) return { mb: info.private / 1024, heapMb, source: 'private' };
			if (info?.residentSet) return { mb: info.residentSet / 1024, heapMb, source: 'resident' };
		}
	} catch { /* not available */ }
	try {
		const u = proc?.memoryUsage?.();
		if (u?.rss) return { mb: u.rss / MB, heapMb, source: 'rss' };
	} catch { /* not available */ }
	if (heapMb !== null) return { mb: heapMb, heapMb, source: 'heap' };
	return { mb: 0, heapMb: null, source: 'none' };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function fmtMb(mb: number): string {
	return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}
