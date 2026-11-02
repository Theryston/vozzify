import { mkdir, writeFile } from 'node:fs/promises';

const sampleRate = 8000;
const seconds = 1;
const samples = sampleRate * seconds;
const dataSize = samples * 2;
const wav = Buffer.alloc(44 + dataSize);

wav.write('RIFF', 0);
wav.writeUInt32LE(36 + dataSize, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(dataSize, 40);
for (let sample = 0; sample < samples; sample += 1) {
  const value = Math.sin((2 * Math.PI * 440 * sample) / sampleRate) * 7000;
  wav.writeInt16LE(value, 44 + sample * 2);
}

await mkdir('tmp/smoke-fixtures', { recursive: true });
await writeFile('tmp/smoke-fixtures/tone.wav', wav);
await writeFile(
  'tmp/smoke-fixtures/pitch.bin',
  Buffer.from([0, 1, 2, 128, 255]),
);
