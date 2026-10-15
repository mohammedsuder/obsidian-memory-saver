// Memory readings for Obsidian's window process, where every community plugin runs.

export interface MemoryReading {
	/** Best available figure for the window process, in MB. */
	mb: number;
	/** JavaScript heap in MB, when available. */
	heapMb: number | null;
	source: 'private' | 'resident' | 'rss' | 'heap' | 'none';
}

const MB = 1024 * 1024;

/** The parts of Electron's renderer `process` used here. Every member is optional, as none is guaranteed. */
interface ElectronProcess {
	memoryUsage?: () => { heapUsed?: number; rss?: number };
	getProcessMemoryInfo?: () => Promise<{ private?: number; residentSet?: number }>;
}

/** Chromium's non-standard performance.memory. */
type PerformanceWithMemory = Performance & { memory?: { usedJSHeapSize?: number } };

export async function readMemory(): Promise<MemoryReading> {
	const proc = (window as { process?: ElectronProcess }).process;
	let heapMb: number | null = null;
	try {
		const u = proc?.memoryUsage?.();
		if (u?.heapUsed) heapMb = u.heapUsed / MB;
	} catch { /* not available */ }
	if (heapMb === null) {
		const pm = (performance as PerformanceWithMemory).memory;
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

export function fmtMb(mb: number): string {
	return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}
