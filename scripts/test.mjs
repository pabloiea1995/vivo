// `npm test`: compila las funciones y corre las pruebas contra el JavaScript
// resultante, que es lo que se despliega. Sin framework — son dos ficheros y
// node ya trae todo lo que hace falta.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: new URL('..', import.meta.url) });

run('npx', ['tsc', '--noEmit', 'false', '--outDir', '.tmp/build']);

const tests = readdirSync(new URL('../test', import.meta.url)).filter((f) => f.endsWith('.test.cjs')).sort();
for (const file of tests) {
  console.log(`\n─── ${file} ${'─'.repeat(Math.max(0, 60 - file.length))}`);
  run('node', [`test/${file}`]);
}
console.log('\nOK');
