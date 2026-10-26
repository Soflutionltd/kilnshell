import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Login-shell environment, resolved once per shell and reused for every command.
 *
 * Commands used to run as `<shell> -l -c <command>` so they see the PATH and variables set by the
 * user's profile (Homebrew, nvm, pyenv...). A login shell re-reads that profile on every command,
 * which costs from a few ms to well over half a second when the profile loads nvm or similar.
 * Running the profile once, capturing the environment it produces, and then starting each command
 * with `<shell> -c` and that environment gives commands the same variables at a fraction of the cost.
 *
 * Disable with DESKTOP_COMMANDER_LOGIN_ENV_CACHE=0 to get a fresh login shell for every command.
 */
const cache = new Map<string, Promise<NodeJS.ProcessEnv | null>>();
const MARK = '__DESKTOP_COMMANDER_ENV__';
// Variables that describe the capturing shell itself, not the user's environment.
const SHELL_LOCAL = ['PWD', 'OLDPWD', 'SHLVL', '_'];

export function loginEnvCacheEnabled(): boolean {
    return process.platform !== 'win32' && process.env.DESKTOP_COMMANDER_LOGIN_ENV_CACHE !== '0';
}

export function loginEnvironment(executable: string): Promise<NodeJS.ProcessEnv | null> {
    if (!loginEnvCacheEnabled()) return Promise.resolve(null);
    let pending = cache.get(executable);
    if (!pending) {
        pending = capture(executable);
        cache.set(executable, pending);
        // A failed capture (a broken profile, a timeout) is retried by the next command.
        pending.then((env) => { if (!env) cache.delete(executable); });
    }
    return pending;
}

function capture(executable: string): Promise<NodeJS.ProcessEnv | null> {
    // /usr/bin/env -0 prints the environment the profile produced, NUL separated, between markers,
    // so anything the profile itself prints is ignored. It does not depend on which Node runs
    // Kilnshell: inside Claude Desktop, process.execPath is Claude's helper app, not a node binary,
    // and the previous `node -e` capture silently failed there (every command paid the profile).
    const envBin = ['/usr/bin/env', '/bin/env'].find((p) => existsSync(p)) ?? 'env';
    const script = `printf '%s' ${MARK}; ${envBin} -0; printf '%s' ${MARK}`;
    return new Promise((resolve) => {
        execFile(executable, ['-l', '-c', script], { timeout: 10000, maxBuffer: 8 * 1024 * 1024, env: process.env }, (error, stdout) => {
            if (error) return resolve(null);
            const start = stdout.indexOf(MARK);
            const end = stdout.lastIndexOf(MARK);
            if (start === -1 || end <= start) return resolve(null);
            const env: NodeJS.ProcessEnv = {};
            for (const entry of stdout.slice(start + MARK.length, end).split('\0')) {
                const eq = entry.indexOf('=');
                if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
            }
            if (!env.PATH) return resolve(null);
            for (const key of SHELL_LOCAL) delete env[key];
            // Variables of the host app (Claude Desktop runs Kilnshell in its own Node) must not
            // reach the user's commands: ELECTRON_RUN_AS_NODE would turn every Electron app into Node.
            for (const key of Object.keys(env)) {
                if (key.startsWith('ELECTRON_') || key === 'NODE_OPTIONS' || key.startsWith('CHROME_')) delete env[key];
            }
            resolve(env);
        });
    });
}
