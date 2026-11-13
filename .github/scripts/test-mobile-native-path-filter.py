from fnmatch import fnmatchcase
from pathlib import Path
import re
import sys


WORKFLOWS = (
    Path('.github/workflows/mobile-android.yml'),
    Path('.github/workflows/mobile-ios.yml'),
)
TRIGGERING_PATHS = (
    'apps/mobile/app/index.tsx',
    'packages/design-tokens/src/index.ts',
    'packages/contracts/src/index.ts',
    'nub.lock',
    'turbo.json',
    '.node-version',
    '.npmrc',
    'biome.json',
    'knip.config.ts',
    '.jscpd.json',
    'vitest.config.ts',
    '.github/workflows/ci.yml',
)
NON_TRIGGERING_PATHS = (
    'apps/api/src/tracks/tracks.service.ts',
    'apps/music-catalog/src/server.ts',
)


def filters_for(workflow: Path) -> list[str]:
    contents = workflow.read_text()
    patterns = re.findall(r"^\s+- '([^']+)'$", contents, re.MULTILINE)
    if not patterns:
        raise ValueError(f'{workflow} has no quoted path-filter patterns')
    return patterns


def verify_workflow(workflow: Path) -> list[str]:
    patterns = filters_for(workflow)
    errors = [
        f'{workflow}: expected trigger did not match: {path}'
        for path in TRIGGERING_PATHS
        if not any(fnmatchcase(path, pattern) for pattern in patterns)
    ]
    errors.extend(
        f'{workflow}: unrelated service path matched: {path}'
        for path in NON_TRIGGERING_PATHS
        if any(fnmatchcase(path, pattern) for pattern in patterns)
    )
    return errors


def main() -> int:
    errors = [
        error
        for workflow in WORKFLOWS
        if workflow.exists()
        for error in verify_workflow(workflow)
    ]
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print('Native workflow path filters cover mobile/shared config and exclude unrelated services.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
