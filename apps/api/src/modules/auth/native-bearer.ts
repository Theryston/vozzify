import { bearer } from 'better-auth/plugins';

/** Only native exchanges can export the signed cookie as a response header. */
export function nativeBearer() {
  const plugin = bearer({ requireSignature: true });
  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      after: plugin.hooks.after.map((hook) => ({
        ...hook,
        matcher: (context: Parameters<typeof hook.matcher>[0]) => {
          const headers = context.request?.headers ?? context.headers;
          return (
            headers?.get('x-vozzify-auth') === 'native' &&
            !headers.has('origin') &&
            !headers.has('cookie') &&
            hook.matcher(context)
          );
        },
      })),
    },
  };
}
