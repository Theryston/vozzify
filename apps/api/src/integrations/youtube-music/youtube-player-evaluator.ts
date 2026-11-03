import { runInNewContext } from 'node:vm';
import type { Platform } from 'youtubei.js';
import { z } from 'zod';

const resultSchema = z.object({
  n: z.string().optional(),
  sig: z.string().optional(),
});

/** Run only the SDK-extracted decipher code, with no application globals. */
export const evaluatePlayerScript: typeof Platform.shim.eval = (data) => {
  const result: unknown = runInNewContext(
    `(() => { ${data.output}\n})()`,
    Object.create(null),
    {
      timeout: 1_000,
      contextCodeGeneration: { strings: false, wasm: false },
    },
  );
  return resultSchema.parse(result);
};
