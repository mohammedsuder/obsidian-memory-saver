// Copies the built plugin into a vault's plugins folder.
// Vault path: the OBSIDIAN_VAULT environment variable, or the first line of a local .vault-path file (not committed).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const vault = process.env.OBSIDIAN_VAULT
	?? (existsSync('.vault-path') ? readFileSync('.vault-path', 'utf8').split(/\r?\n/)[0].trim() : '');
if (!vault) {
	console.error('Set OBSIDIAN_VAULT or create a .vault-path file containing the path to your vault.');
	process.exit(1);
}
const dest = join(vault, '.obsidian', 'plugins', 'memory-saver');
mkdirSync(dest, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(f, join(dest, f));
console.log(`Installed to ${dest}`);
