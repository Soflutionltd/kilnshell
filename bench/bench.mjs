// Kilnshell vs Desktop Commander, over real MCP stdio, same machine, same files, same login shell.
//   npm run bench            (installs the reference server in bench/node_modules the first time)
// Each tool runs 9 times per server; the table shows the median. Results go to bench/results.json.
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const runs = Number(process.env.BENCH_RUNS || 9);
const upstream = join(here, 'node_modules/@wonderwhy-er/desktop-commander/dist/index.js');
if (!existsSync(upstream)) execSync('npm install --no-audit --no-fund --ignore-scripts', { cwd: here, stdio: 'inherit' });

const work = mkdtempSync(join(tmpdir(), 'ks-bench-'));
writeFileSync(join(work, 'big.txt'), Array.from({ length: 20000 }, (_, i) => `line ${i} lorem ipsum dolor sit amet`).join('\n'));
for (let i = 0; i < 200; i++) {
  mkdirSync(join(work, 'src', 'd' + (i % 10)), { recursive: true });
  writeFileSync(join(work, 'src', 'd' + (i % 10), `f${i}.ts`), `export const v${i} = ${i};\n`.repeat(100));
}

// A throwaway HOME keeps each server's config apart, while the real shell profile is kept, because the
// cost of re-reading it on every command is exactly what users pay (Homebrew, nvm, pyenv...).
function env() {
  const home = mkdtempSync(join(tmpdir(), 'ks-home-'));
  const real = homedir();
  const linked = ['.bash_profile', '.profile', '.bashrc', '.nvm', '.pyenv', '.rbenv', '.cargo', '.local'];
  for (const f of linked) if (existsSync(join(real, f))) symlinkSync(join(real, f), join(home, f));
  const shell = process.env.SHELL || '/bin/bash';
  return { ...process.env, HOME: home, ZDOTDIR: real, SHELL: shell };
}

const cases = [
  ['Run a command (echo)', 'start_process', () => ({ command: 'echo hi', timeout_ms: 10000 })],
  ['Run a command (git --version)', 'start_process', () => ({ command: 'git --version', timeout_ms: 10000 })],
  ['Read 1,000 lines of a 20k-line file', 'read_file', () => ({ path: join(work, 'big.txt'), offset: 0, length: 1000 })],
  ['Edit one line (edit_block)', 'edit_block', (i) => ({ file_path: join(work, 'big.txt'), old_string: i % 2 ? 'line 15000 LOREM' : 'line 15000 lorem', new_string: i % 2 ? 'line 15000 lorem' : 'line 15000 LOREM', expected_replacements: 1 })],
  ['Write a file', 'write_file', () => ({ path: join(work, 'out.txt'), content: 'hello\n'.repeat(500), mode: 'rewrite' })],
  ['File info', 'get_file_info', () => ({ path: join(work, 'big.txt') })],
  ['List a directory', 'list_directory', () => ({ path: join(work, 'src'), depth: 2 })],
  ['Read 10 files at once', 'read_multiple_files', () => ({ paths: Array.from({ length: 10 }, (_, i) => join(work, 'src', 'd' + i, `f${i}.ts`)) })],
];

async function measure(server) {
  const client = new Client({ name: 'ks-bench', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: env(), cwd: work, stderr: 'ignore' }));
  // Telemetry turned off in the config, as a privacy-minded user would (Kilnshell has none anyway).
  await client.callTool({ name: 'set_config_value', arguments: { key: 'telemetryEnabled', value: false } });
  await new Promise((r) => setTimeout(r, 2000)); // let both servers finish their background start-up work
  const out = {};
  for (const [label, tool, args] of cases) {
    const ts = [];
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      const r = await client.callTool({ name: tool, arguments: args(i) });
      ts.push(performance.now() - t);
      if (r.isError) throw new Error(`${label}: ${JSON.stringify(r.content).slice(0, 200)}`);
    }
    ts.sort((a, b) => a - b);
    out[label] = Math.round(ts[Math.floor(ts.length / 2)] * 10) / 10;
  }
  await client.close();
  return out;
}

const dc = await measure(upstream);
const ks = await measure(join(here, '../dist/index.js'));
const rows = cases.map(([label]) => ({ label, desktopCommander: dc[label], kilnshell: ks[label], speedup: Math.round((dc[label] / ks[label]) * 10) / 10 }));
writeFileSync(join(here, 'results.json'), JSON.stringify({ date: new Date().toISOString().slice(0, 10), platform: `${process.platform} ${process.arch}`, node: process.version, shell: process.env.SHELL, runs, rows }, null, 2) + '\n');
console.log('| Tool | Desktop Commander 0.3.1 | Kilnshell | Speed-up |\n|---|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.label} | ${r.desktopCommander} ms | ${r.kilnshell} ms | ${r.speedup}x |`);
