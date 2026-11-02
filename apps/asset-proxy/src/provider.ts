type AssetRequest = {
  request: Request;
  key: string;
};

export type AssetProvider = {
  freshnessSeconds: number;
  cacheMode: 'fixed-ttl' | 'stale-while-revalidate';
  resolve(asset: AssetRequest): Promise<Response>;
};

export type ProviderRegistry = ReadonlyMap<string, AssetProvider>;
