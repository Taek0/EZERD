import { spawn } from 'node:child_process';

/** Preserve partial output from a killed child instead of treating it as valid JSON. */
export function parseMessages(stdout) {
  const messages = [],
    malformed = [];
  for (const line of stdout.split('\n').filter((line) => line.trim())) {
    try {
      messages.push(JSON.parse(line));
    } catch {
      malformed.push(line);
    }
  }
  return { messages, malformed };
}

/** Own a single direct child process; timeout covers startup and measurement. */
export function runBounded(command, args, { timeoutMs = 30000, maxBytes = 1048576 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '',
      bytes = 0,
      reason = null;
    const stop = (why) => {
      if (!reason) {
        reason = why;
        child.kill();
      }
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const append = (chunk, error) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        stop('output-limit');
        return;
      }
      if (error) stderr += chunk.toString();
      else stdout += chunk.toString();
    };
    child.stdout.on('data', (chunk) => append(chunk, false));
    child.stderr.on('data', (chunk) => append(chunk, true));
    child.on('error', (error) => {
      reason = 'spawn-error';
      stderr += error.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: reason ?? (code === 0 ? 'complete' : 'error'), code, stdout, stderr });
    });
  });
}
