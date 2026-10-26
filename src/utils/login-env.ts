import { execFile } from 'node:child_process';

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
    // Node prints the environment as JSON between markers, so anything the profile itself prints is ignored.
    const node = `'${process.execPath.replace(/'/g, `'\\''`)}'`;
    const script = `${node} -e 'process.stdout.write("${MARK}" + JSON.stringify(process.env) + "${MARK}")'`;
    return new Promise((resolve) => {
        execFile(executable, ['-l', '-c', script], { timeout: 10000, maxBuffer: 8 * 1024 * 1024, env: process.env }, (error, stdout) => {
            if (error) return resolve(null);
            const start = stdout.indexOf(MARK);
            const end = stdout.lastIndexOf(MARK);
            if (start === -1 || end <= start) return resolve(null);
            try {
                const env = JSON.parse(stdout.slice(start + MARK.length, end)) as NodeJS.ProcessEnv;
                for (const key of SHELL_LOCAL) delete env[key];
                resolve(env);
            } catch {
                resolve(null);
            }
        });
    });
}
