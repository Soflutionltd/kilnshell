import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { ServerResult } from '../types.js';
import { WaitForArgsSchema } from '../tools/schemas.js';
import { terminalManager } from '../terminal-manager.js';

function portOpen(port: number, host: string): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = createConnection({ port, host });
        const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
        socket.setTimeout(500, () => done(false));
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
    });
}

async function urlAnswers(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2000) });
        return res.status < 500;
    } catch {
        return false;
    }
}

/**
 * wait_for: blocks until a condition holds (a port accepts connections, a file exists, a URL
 * answers, a process exits) instead of polling with sleeps and repeated tool calls.
 */
export async function handleWaitFor(args: unknown): Promise<ServerResult> {
    const parsed = WaitForArgsSchema.safeParse(args);
    if (!parsed.success) {
        return { content: [{ type: 'text', text: `Invalid arguments for wait_for: ${parsed.error}` }], isError: true };
    }
    const { port, host = '127.0.0.1', path, url, pid, gone = false, timeout_ms = 30000 } = parsed.data;
    if (port === undefined && !path && !url && pid === undefined) {
        return { content: [{ type: 'text', text: 'wait_for needs one of: port, path, url, pid' }], isError: true };
    }
    const what = port !== undefined ? `port ${host}:${port}` : path ? `file ${path}` : url ? `URL ${url}` : `process ${pid}`;
    const check = async (): Promise<boolean> => {
        let ok: boolean;
        if (port !== undefined) ok = await portOpen(port, host);
        else if (path) ok = existsSync(path);
        else if (url) ok = await urlAnswers(url);
        else return !terminalManager.getSession(pid!);
        return gone ? !ok : ok;
    };
    const start = Date.now();
    const limit = Math.min(Math.max(timeout_ms, 100), 600000);
    while (true) {
        if (await check()) {
            return { content: [{ type: 'text', text: `${what}: ${gone ? 'gone' : 'ready'} after ${Date.now() - start} ms` }] };
        }
        if (Date.now() - start >= limit) {
            return { content: [{ type: 'text', text: `${what}: still not ${gone ? 'gone' : 'ready'} after ${limit} ms` }], isError: true };
        }
        await new Promise((r) => setTimeout(r, 100));
    }
}
