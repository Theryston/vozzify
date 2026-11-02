import { dispatchAssetRequest } from './asset-delivery.js';
import type { ProviderRegistry } from './provider.js';
import { createR2Provider } from './r2-provider.js';

const providers = (env: Cloudflare.Env): ProviderRegistry =>
  new Map([['storage', createR2Provider(env.PUBLIC_ASSETS)]]);

const worker = {
  fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    return dispatchAssetRequest(request, providers(env));
  },
};

export default worker satisfies ExportedHandler<Cloudflare.Env>;
