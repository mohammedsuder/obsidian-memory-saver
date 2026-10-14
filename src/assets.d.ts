// Images imported by the plugin are bundled into main.js as data URLs (see esbuild.config.mjs).
declare module '*.webp' {
	const src: string;
	export default src;
}
