// Lints the plugin source with eslint-plugin-obsidianmd's recommended rules, the rules the Obsidian community
// directory review reports. `npm run lint` checks src and package.json; build scripts (esbuild.config.mjs,
// scripts/) run in Node rather than in Obsidian, so they are not linted with these rules.
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
	{ ignores: ['main.js', 'build-test/**', 'logs/**', 'node_modules/**'] },
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
		rules: {
			// Same as the recommended setting, plus proper names used in notices: Memory Saver, and Obsidian's
			// Settings → Community plugins.
			'obsidianmd/ui/sentence-case': ['warn', { enforceCamelCaseLower: true, ignoreWords: ['Memory', 'Saver', 'Settings', 'Community'] }],
		},
	},
]);
