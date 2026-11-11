module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'routes-are-leaves',
      severity: 'error',
      from: { path: '^app/' },
      to: { path: '^app/' },
    },
    {
      name: 'generic-code-does-not-depend-on-features',
      severity: 'error',
      from: { path: '^src/(components|hooks|lib)/' },
      to: { path: '^src/features/' },
    },
    {
      name: 'lib-is-the-bottom-layer',
      severity: 'error',
      from: { path: '^src/lib/' },
      to: { path: '^src/(components|hooks|features)/' },
    },
    {
      name: 'features-use-other-features-through-components',
      severity: 'error',
      from: { path: '^src/features/' },
      to: {
        path: '^src/features/',
        pathNot: '^src/features/[^/]+/components/',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'] },
  },
};
