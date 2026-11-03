import { evaluatePlayerScript } from './youtube-player-evaluator.js';

describe('YouTube player decipher evaluator', () => {
  it('evaluates the extracted signature and n transforms', async () => {
    expect(
      await evaluatePlayerScript(
        {
          output:
            'const reverse = s => s.split("").reverse().join(""); return { sig: reverse("abc"), n: "decoded" };',
          exported: [],
        },
        {},
      ),
    ).toEqual({ sig: 'cba', n: 'decoded' });
  });

  it('does not expose application process globals', async () => {
    expect(
      await evaluatePlayerScript(
        {
          output: 'return { n: typeof process, sig: typeof require };',
          exported: [],
        },
        {},
      ),
    ).toEqual({ n: 'undefined', sig: 'undefined' });
  });

  it('rejects malformed decipher results', () => {
    expect(() =>
      evaluatePlayerScript({ output: 'return { n: 123 };', exported: [] }, {}),
    ).toThrow();
  });

  it('disallows additional runtime code generation', () => {
    expect(() =>
      evaluatePlayerScript(
        { output: 'return { n: eval("1") };', exported: [] },
        {},
      ),
    ).toThrow('Code generation');
  });

  it('stops a decipher script that does not terminate', () => {
    expect(() =>
      evaluatePlayerScript({ output: 'while (true) {}', exported: [] }, {}),
    ).toThrow('timed out');
  });
});
