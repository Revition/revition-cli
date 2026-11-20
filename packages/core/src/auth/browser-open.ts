import { spawn } from 'node:child_process';

/**
 * T1.3.1 step 3 - opens the authorize URL in the default browser. When there is no browser (SSH, a headless box) the
 * caller prints the URL and suggests --device. The URL carries no secret (PKCE challenge, state, nonce only).
 */
export function browserCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}

export function canOpenBrowser(env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): boolean {
  if ((env['SSH_CONNECTION'] ?? '') !== '' || (env['SSH_TTY'] ?? '') !== '') return false;
  if (platform === 'linux' && (env['DISPLAY'] ?? '') === '' && (env['WAYLAND_DISPLAY'] ?? '') === '') return false;
  return true;
}

export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const [cmd, args] = browserCommand(platform, url);
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => resolve(false));
      child.on('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
