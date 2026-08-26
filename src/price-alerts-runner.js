import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRICE_ALERT_MIN_CHANGE_PERCENT = 3;
const PRICE_ALERT_THROTTLE_MS = 30 * 60 * 1000;
const COINGECKO_API_BASE_URL = 'https://api.coingecko.com/api/v3';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadEnvFile = (path) => {
  if (!existsSync(path)) return;
  const contents = readFileSync(path, 'utf8');
  contents.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (!key || process.env[key] !== undefined) return;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
};

loadEnvFile(resolve(__dirname, '../.env'));

const MARKET_PLATFORM_BY_NETWORK = {
  'bnb-chain': 'binance-smart-chain',
  ethereum: 'ethereum',
  base: 'base',
  optimism: 'optimistic-ethereum',
  arbitrum: 'arbitrum-one',
  avalanche: 'avalanche',
  linea: 'linea',
  zksync: 'zksync',
  scroll: 'scroll',
};

const MARKET_COIN_ID_BY_SYMBOL = {
  AVAX: 'avalanche-2',
  BNB: 'binancecoin',
  ETH: 'ethereum',
  USDC: 'usd-coin',
  USDT: 'tether',
  WETH: 'ethereum',
};

const MARKET_NATIVE_COIN_ID_BY_NETWORK = {
  'bnb-chain': 'binancecoin',
  ethereum: 'ethereum',
  base: 'ethereum',
  optimism: 'ethereum',
  arbitrum: 'ethereum',
  'arbitrum-one': 'ethereum',
  avalanche: 'avalanche-2',
  linea: 'ethereum',
  zksync: 'ethereum',
  scroll: 'ethereum',
};

const MARKET_COIN_ID_BY_PLATFORM_CONTRACT = {
  'binance-smart-chain': {
    '0x55d398326f99059ff775485246999027b3197955': 'tether',
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'usd-coin',
    '0x6ec90334d89dbdc89e08a1332718d104128ed499': 'wiki-cat',
  },
  ethereum: {
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 'tether',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'usd-coin',
  },
  base: {
    '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': 'tether',
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'usd-coin',
  },
  'arbitrum-one': {
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'tether',
    '0xaf88d065e77cc223932e3a432268e5831ae4d46': 'usd-coin',
  },
};

const env = (key, required = true) => {
  const value = process.env[key] && String(process.env[key]).trim();
  if (required && !value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value || '';
};

const SUPABASE_URL = env('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const DOXA_NOTIFICATIONS_CRON_SECRET = env('DOXA_NOTIFICATIONS_CRON_SECRET');
const DISPATCH_ENDPOINT = env('DOXA_NOTIFICATIONS_DISPATCH_ENDPOINT', false) || env('EXPO_PUBLIC_DOXA_NOTIFICATIONS_ENDPOINT', false) || 'http://localhost:8787/notifications';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || process.env.COINGECKO_DEMO_API_KEY || process.env.COINGECKO_PRO_API_KEY || '';

const deriveSiblingEndpoint = (endpoint, fromRoute, toRoute) => {
  const cleanedEndpoint = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!cleanedEndpoint) return '';
  return cleanedEndpoint.replace(new RegExp(`/${fromRoute}$`, 'i'), `/${toRoute}`);
};

const MARKET_ENDPOINT = env('DOXA_MARKET_ENDPOINT', false) || deriveSiblingEndpoint(DISPATCH_ENDPOINT, 'notifications', 'market');

const fetchDoxaMarketProxy = async (route, params) => {
  if (!MARKET_ENDPOINT) return null;

  try {
    const url = new URL(`${MARKET_ENDPOINT.replace(/\/+$/, '')}/${route}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;

    return getJson(response);
  } catch (error) {
    console.warn(`Doxa market proxy ${route} failed:`, error instanceof Error ? error.message : error);
    return null;
  }
};

const normalizeMarketProxyPriceMap = (marketData) => {
  if (!marketData || typeof marketData !== 'object' || Array.isArray(marketData)) return null;

  return Object.entries(marketData).reduce((prices, [key, value]) => {
    const price = parseNumeric(value?.price ?? value?.usd);
    if (Number.isFinite(price) && price > 0) {
      prices[key.toLowerCase()] = { usd: price };
    }
    return prices;
  }, {});
};

const getJson = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { text };
  }
};

const fetchSupabase = async (path, options = {}) => {
  const url = new URL(`${SUPABASE_URL.replace(/\/+$|\/$/, '')}/rest/v1/${path}`);
  if (options.searchParams) {
    Object.entries(options.searchParams).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const payload = await getJson(response);
    throw new Error(`Supabase request failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  return response.json();
};

const normalizeAddress = (value) => String(value || '').trim().toLowerCase();
const sanitizeText = (value) => String(value || '').trim();
const parseNumeric = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return cleaned ? Number(cleaned[0]) : NaN;
};

const getMarketPlatformId = (networkId) => MARKET_PLATFORM_BY_NETWORK[networkId];
const getMarketNativeCoinId = (networkId) => MARKET_NATIVE_COIN_ID_BY_NETWORK[networkId];

const getTokenPriceKey = (token) => {
  const contractAddress = normalizeAddress(token.tokenAddress);
  const platformId = getMarketPlatformId(token.networkId);

  if (platformId && contractAddress) {
    return { type: 'contract', platformId, contractAddress };
  }

  const nativeId = getMarketNativeCoinId(token.networkId) || MARKET_COIN_ID_BY_SYMBOL[token.symbol?.toUpperCase()];
  if (nativeId) {
    return { type: 'coin', coinId: nativeId };
  }

  return null;
};

const buildPriceBatches = (tokens) => {
  const contractGroups = new Map();
  const coinIds = new Set();

  tokens.forEach((token) => {
    const priceKey = getTokenPriceKey(token);
    if (!priceKey) return;

    if (priceKey.type === 'contract') {
      const key = `${priceKey.platformId}|${priceKey.contractAddress}`;
      contractGroups.set(key, priceKey);
    } else if (priceKey.type === 'coin') {
      coinIds.add(priceKey.coinId);
    }
  });

  return { contractGroups: Array.from(contractGroups.values()), coinIds: Array.from(coinIds) };
};

const fetchContractPrices = async (platformId, contractAddresses) => {
  const proxiedPayload = await fetchDoxaMarketProxy('token-prices', {
    platformId,
    contractAddresses: contractAddresses.join(','),
    currency: 'usd',
  });
  const proxiedPrices = normalizeMarketProxyPriceMap(proxiedPayload?.data?.marketData);
  if (proxiedPrices && Object.keys(proxiedPrices).length) {
    return proxiedPrices;
  }

  const url = new URL(`${COINGECKO_API_BASE_URL}/simple/token_price/${platformId}`);
  url.searchParams.set('contract_addresses', contractAddresses.join(','));
  url.searchParams.set('vs_currencies', 'usd');

  const headers = { Accept: 'application/json' };
  if (COINGECKO_API_KEY) {
    headers['x-cg-demo-api-key'] = COINGECKO_API_KEY;
    headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`CoinGecko contract price request failed: ${response.status}`);
  }

  return response.json();
};

const fetchCoinPrices = async (coinIds) => {
  const proxiedPayload = await fetchDoxaMarketProxy('coin-prices', {
    ids: coinIds.join(','),
    currency: 'usd',
  });
  const proxiedPrices = normalizeMarketProxyPriceMap(proxiedPayload?.data?.marketData);
  if (proxiedPrices && Object.keys(proxiedPrices).length) {
    return proxiedPrices;
  }

  const url = new URL(`${COINGECKO_API_BASE_URL}/simple/price`);
  url.searchParams.set('ids', coinIds.join(','));
  url.searchParams.set('vs_currencies', 'usd');

  const headers = { Accept: 'application/json' };
  if (COINGECKO_API_KEY) {
    headers['x-cg-demo-api-key'] = COINGECKO_API_KEY;
    headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`CoinGecko price request failed: ${response.status}`);
  }

  return response.json();
};

const buildMarketPrices = async (tokens) => {
  const { contractGroups, coinIds } = buildPriceBatches(tokens);
  const prices = new Map();

  const contractGroupsByPlatform = contractGroups.reduce((map, item) => {
    const list = map.get(item.platformId) || [];
    list.push(item.contractAddress);
    map.set(item.platformId, list);
    return map;
  }, new Map());

  await Promise.all(
    Array.from(contractGroupsByPlatform.entries()).map(async ([platformId, contractAddresses]) => {
      const data = await fetchContractPrices(platformId, contractAddresses);
      Object.entries(data || {}).forEach(([address, value]) => {
        const normalized = normalizeAddress(address);
        const usd = parseNumeric(value?.usd);
        if (Number.isFinite(usd)) {
          prices.set(`${platformId}:${normalized}`, usd);
        }
      });
    }),
  );

  if (coinIds.length) {
    const data = await fetchCoinPrices(coinIds);
    Object.entries(data || {}).forEach(([coinId, value]) => {
      const usd = parseNumeric(value?.usd);
      if (Number.isFinite(usd)) {
        prices.set(`coin:${coinId}`, usd);
      }
    });
  }

  return prices;
};

const getCurrentMarketPrice = (token, prices) => {
  const priceKey = getTokenPriceKey(token);
  if (!priceKey) return null;
  if (priceKey.type === 'contract') {
    return prices.get(`${priceKey.platformId}:${priceKey.contractAddress}`) ?? null;
  }
  return prices.get(`coin:${priceKey.coinId}`) ?? null;
};

const formatPrice = (price) => {
  if (!Number.isFinite(price)) return '$0.00';
  return `$${price.toLocaleString('en-US', { maximumFractionDigits: price >= 1 ? 4 : 8 })}`;
};

const updateDeviceTokens = async (device) => {
  await fetchSupabase('doxa_notification_devices', {
    method: 'PATCH',
    searchParams: {
      'expo_push_token': `eq.${encodeURIComponent(device.expo_push_token)}`,
    },
    body: { tokens: device.tokens, last_updated_at: new Date().toISOString() },
  });
};

const sendDispatchPayload = async (messages) => {
  const response = await fetch(`${DISPATCH_ENDPOINT.replace(/\/+$|\/$/, '')}/price-alerts/dispatch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DOXA-NOTIFICATIONS-CRON-SECRET': DOXA_NOTIFICATIONS_CRON_SECRET,
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    const payload = await getJson(response);
    throw new Error(`Dispatch request failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  return response.json();
};

const fetchDevices = async () => {
  return fetchSupabase('doxa_notification_devices', {
    searchParams: {
      select: 'expo_push_token,wallet_address,platform,app_version,currency,tokens,last_registered_at,last_updated_at',
      enabled: 'eq.true',
    },
  });
};

const calculateMessages = (device, prices) => {
  if (!Array.isArray(device.tokens)) return [];

  const messages = [];
  const now = Date.now();

  device.tokens = device.tokens.map((token) => {
    const currentPrice = getCurrentMarketPrice(token, prices);
    const registeredPrice = parseNumeric(token.currentPrice);
    const previousPrice = Number.isFinite(parseNumeric(token.previousPrice)) ? parseNumeric(token.previousPrice) : registeredPrice;
    const lastNotifiedAt = Number.isFinite(parseNumeric(token.lastNotifiedAt)) ? parseNumeric(token.lastNotifiedAt) : null;

    if (!Number.isFinite(currentPrice) || !Number.isFinite(previousPrice)) {
      return token;
    }

    const percentChange = ((currentPrice - previousPrice) / previousPrice) * 100;
    const absChange = Math.abs(percentChange);
    const canNotify = !lastNotifiedAt || now - lastNotifiedAt >= PRICE_ALERT_THROTTLE_MS;

    if (absChange >= PRICE_ALERT_MIN_CHANGE_PERCENT && canNotify) {
      const direction = percentChange > 0 ? 'up' : 'down';
      const percentLabel = `${absChange.toFixed(absChange >= 10 ? 1 : 2)}%`;
      const tokenId = token.tokenId || `${token.networkId}:${token.tokenAddress || token.symbol || 'unknown'}`;

      messages.push({
        to: device.expo_push_token,
        title: `${sanitizeText(token.symbol || 'Token')} price ${direction} ${percentLabel}`,
        body: `${sanitizeText(token.symbol || 'Token')} is ${direction} to ${formatPrice(currentPrice)} on ${sanitizeText(token.networkId || 'your network')}. Tap to open Doxa and review your position.`,
        data: {
          type: 'price-alert',
          tokenId,
          token: sanitizeText(token.symbol || 'Token'),
          networkId: sanitizeText(token.networkId || ''),
          percentChange: Number(percentChange.toFixed(2)),
          href: `/token-details/${encodeURIComponent(tokenId)}`,
        },
        channelId: 'doxa-price-alerts',
      });

      token.lastNotifiedAt = now;
    }

    token.previousPrice = currentPrice;
    return token;
  });

  return messages;
};

const completeClaimedDispatches = async (claimedIds) => {
  for (const id of claimedIds) {
    try {
      await fetchSupabase('rpc/complete_doxa_price_alerts_dispatch', { method: 'POST', body: { dispatch_id: id } });
    } catch (err) {
      console.error('Failed to mark dispatch id complete:', id, err instanceof Error ? err.message : err);
    }
  }
};
export const runPriceAlertScan = async () => {
  console.log('Starting Doxa price alert runner...');

  // First, claim any scheduled dispatch items from the DB queue via Supabase RPC.
  const claimedIds = [];
  const maxClaimAttempts = 25;
  for (let attempt = 0; attempt < maxClaimAttempts; attempt += 1) {
    let claimed;
    try {
      claimed = await fetchSupabase('rpc/claim_doxa_price_alerts_dispatch', { method: 'POST', body: {} });
    } catch (err) {
      console.error('Failed to claim dispatch item:', err instanceof Error ? err.message : err);
      break;
    }

    if (!Array.isArray(claimed) || claimed.length === 0) break;
    const row = claimed[0];
    if (!row?.id) break;
    claimedIds.push(row.id);
  }

  if (claimedIds.length === 0) {
    console.log('No scheduled dispatch items found; running direct price alert scan.');
  }

  // Run the existing device -> message flow and dispatch payloads.
  const devices = await fetchDevices();
  if (!Array.isArray(devices) || devices.length === 0) {
    console.log('No active notification devices found.');
    await completeClaimedDispatches(claimedIds);
    return { devices: 0, messages: 0 };
  }

  const allTokens = devices.flatMap((device) => Array.isArray(device.tokens) ? device.tokens : []);
  if (!allTokens.length) {
    console.log('No tokens registered for price alerts.');
    await completeClaimedDispatches(claimedIds);
    return { devices: devices.length, messages: 0 };
  }

  const prices = await buildMarketPrices(allTokens);
  const allMessages = [];

  for (const device of devices) {
    const messages = calculateMessages(device, prices);
    if (messages.length) {
      allMessages.push(...messages);
    }
    await updateDeviceTokens(device);
  }

  if (!allMessages.length) {
    console.log('No price alert messages to dispatch.');
    await completeClaimedDispatches(claimedIds);
    return { devices: devices.length, messages: 0 };
  }

  const dispatchResult = await sendDispatchPayload(allMessages);
  console.log('Dispatched price alert messages:', JSON.stringify(dispatchResult, null, 2));

  // Mark all claimed dispatch rows complete
  for (const id of claimedIds) {
    try {
      await fetchSupabase('rpc/complete_doxa_price_alerts_dispatch', { method: 'POST', body: { dispatch_id: id } });
    } catch (err) {
      console.error('Failed to mark dispatch id complete:', id, err instanceof Error ? err.message : err);
    }
  }

  return { devices: devices.length, messages: allMessages.length, dispatchResult };
};

const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  try {
    await runPriceAlertScan();
    process.exitCode = 0;
  } catch (error) {
    console.error('Price alert runner failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
