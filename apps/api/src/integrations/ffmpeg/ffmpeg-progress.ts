import { spawn } from 'node:child_process';

// The end of FFmpeg's log is where its error is.
export const FFMPEG_STDERR_TAIL_CHARS = 2_000;

export function readFfmpegDuration({
  executable,
  args,
  inputFd,
  maxDurationSeconds,
  timeoutMs,
}: {
  executable: string;
  args: string[];
  inputFd: number;
  maxDurationSeconds: number;
  timeoutMs: number;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe', inputFd],
      signal: AbortSignal.timeout(timeoutMs),
    });
    let progressBuffer = '';
    let stderr = '';
    let durationUs = 0;
    let durationExceeded = false;
    child.stdout?.on('data', (chunk: Buffer) => {
      const update = readFfmpegProgress(
        progressBuffer,
        chunk.toString(),
        durationUs,
        maxDurationSeconds,
      );
      progressBuffer = update.buffer;
      durationUs = update.durationUs;
      durationExceeded ||= update.durationExceeded;
      if (update.outputExceeded || update.durationExceeded) {
        child.kill('SIGKILL');
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk}`.slice(-FFMPEG_STDERR_TAIL_CHARS);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (durationExceeded) {
        reject(new Error('Media duration exceeds its limit'));
        return;
      }
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        return;
      }
      resolve(durationUs / 1_000_000);
    });
  });
}

function readFfmpegProgress(
  buffer: string,
  chunk: string,
  currentDurationUs: number,
  maxDurationSeconds: number,
) {
  const output = buffer + chunk;
  if (output.length > 32_000) {
    return {
      buffer: '',
      durationUs: currentDurationUs,
      durationExceeded: false,
      outputExceeded: true,
    };
  }
  const lines = output.split('\n');
  const remaining = lines.pop() ?? '';
  let durationUs = currentDurationUs;
  let durationExceeded = false;
  for (const line of lines) {
    if (!line.startsWith('out_time_us=')) continue;
    const parsed = Number(line.slice('out_time_us='.length));
    if (!Number.isFinite(parsed)) continue;
    durationUs = Math.max(durationUs, parsed);
    if (durationUs > maxDurationSeconds * 1_000_000) {
      durationExceeded = true;
      break;
    }
  }
  return {
    buffer: remaining,
    durationUs,
    durationExceeded,
    outputExceeded: false,
  };
}
