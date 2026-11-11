module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
      comment: 'Circular imports are not allowed.',
    },
    {
      name: 'routes-are-leaves',
      severity: 'error',
      from: { pathNot: '^app/' },
      to: { path: '^app/' },
      comment:
        'Routes are entry points and must not be imported by other layers.',
    },
    {
      name: 'generic-code-does-not-depend-on-features',
      severity: 'error',
      from: { path: '^src/(components|hooks|lib)/' },
      to: { path: '^src/features/' },
      comment: 'Generic code must stay independent of product features.',
    },
    {
      name: 'lib-is-the-bottom-layer',
      severity: 'error',
      from: { path: '^src/lib/' },
      to: { path: '^(app|src/(components|features|hooks))/' },
      comment:
        'Low-level libraries must remain below routes, UI, hooks, and features.',
    },
    {
      name: 'features-use-other-features-through-components',
      severity: 'error',
      from: { path: '^src/features/([^/]+)/' },
      to: {
        path: '^src/features/[^/]+/',
        pathNot: ['^src/features/$1/', '^src/features/[^/]+/components/'],
      },
      comment: 'Cross-feature imports use a feature’s public components.',
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(coverage|dist)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
