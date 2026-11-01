// Dopo "vite build": copia l'API PHP e il .htaccess dentro dist/, pronta da caricare via FTP.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const server = join(root, 'server');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html mancante: esegui prima "vite build".');
  process.exit(1);
}

cpSync(join(server, '.htaccess'), join(dist, '.htaccess'));
const apiOut = join(dist, 'api');
rmSync(apiOut, { recursive: true, force: true });
cpSync(join(server, 'api'), apiOut, {
  recursive: true,
  // mai pubblicare database locali o configurazioni personali
  filter: (src) => !/\.sqlite(-journal)?$/.test(src) && !src.endsWith(`${'api'}/config.php`),
});
mkdirSync(join(apiOut, 'data'), { recursive: true });
writeFileSync(join(apiOut, 'data', 'LEGGIMI.txt'), 'Qui viene creato automaticamente il database SQLite (party-casino.sqlite). Non cancellarlo: contiene tutti i dati.\n');

const count = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0);
console.log(`✔ Pacchetto per Aruba pronto in dist/ (${count(dist)} file): carica TUTTO il contenuto della cartella via FTP nella root del sito.`);
