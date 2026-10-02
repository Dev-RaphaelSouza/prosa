// Sobe o servidor (porta 3001, reinicia a cada mudança) e o Vite (porta 5173) juntos.
import { spawn } from 'node:child_process';

const run = (args) => spawn(process.execPath, args, { stdio: 'inherit' });

const procs = [
  run(['--watch', '--disable-warning=ExperimentalWarning', 'server/index.ts']),
  run(['node_modules/vite/bin/vite.js']),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', stop);
