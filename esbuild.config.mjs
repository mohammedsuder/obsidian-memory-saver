import esbuild from 'esbuild';
import { builtinModules } from 'node:module';

const mode = process.argv[2] ?? 'production';
const external = [
	'obsidian', 'electron',
	'@codemirror/autocomplete', '@codemirror/collab', '@codemirror/commands', '@codemirror/language',
	'@codemirror/lint', '@codemirror/search', '@codemirror/state', '@codemirror/view',
	'@lezer/common', '@lezer/highlight', '@lezer/lr',
	...builtinModules,
];

if (mode === 'test') {
	await esbuild.build({
		entryPoints: ['test/modes.test.ts'], bundle: true, platform: 'node', format: 'esm',
		outdir: 'build-test', outExtension: { '.js': '.mjs' }, logLevel: 'info',
	});
} else {
	const ctx = await esbuild.context({
		entryPoints: ['src/main.ts'], bundle: true, external, format: 'cjs', target: 'es2020',
		outfile: 'main.js', logLevel: 'info', treeShaking: true,
		sourcemap: mode === 'watch' ? 'inline' : false,
	});
	if (mode === 'watch') await ctx.watch();
	else { await ctx.rebuild(); await ctx.dispose(); }
}
