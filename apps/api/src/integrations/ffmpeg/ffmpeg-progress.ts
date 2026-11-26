export function readFfmpegProgress(
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
