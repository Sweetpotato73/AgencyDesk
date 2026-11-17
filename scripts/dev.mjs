// Runs the API server and the Vite dev server together, forwarding output and Ctrl+C.
import { spawn } from 'node:child_process';

const procs = [
  ['server', ['run', 'dev', '-w', 'server']],
  ['client', ['run', 'dev', '-w', 'client']],
].map(([name, args]) => {
  const p = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const tag = name === 'server' ? '\x1b[36m[server]\x1b[0m ' : '\x1b[35m[client]\x1b[0m ';
  const pipe = (stream, out) =>
    stream.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach((l) => out.write(tag + l + '\n')));
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${tag}exited with code ${code}`);
    procs.forEach((o) => o !== p && o.kill('SIGTERM'));
    process.exit(code ?? 0);
  });
  return p;
});

const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
