import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';

/** The real lightweight Sonic service used by API end-to-end tests. */
export const startSonicContainer = () =>
  new GenericContainer('valeriansaliou/sonic:v1.10.1')
    .withCommand(['sonic', '-c', '/etc/sonic/config.toml'])
    .withCopyFilesToContainer([
      {
        source: fileURLToPath(
          new URL('../../sonic/config.toml', import.meta.url),
        ),
        target: '/etc/sonic/config.toml',
      },
    ])
    .withExposedPorts(1491)
    .withWaitStrategy(Wait.forLogMessage('reading config file', 1))
    .withStartupTimeout(120_000)
    .start();
