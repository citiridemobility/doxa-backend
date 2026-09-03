import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
const MAX_JSON_BYTES = 32 * 1024;
const RAILS_EVM_NETWORKS = new Set([
  'ethereum',
  'base',
  'polygon',
  'arbitrum-one',
  'bnb-smart-chain',
  'celo',
  'lisk',
  'scroll',
]);
const RAILS_STABLE_TOKENS = new Set(['USDC', 'USDT', 'CNGN']);
const RAILS_FIAT_CURRENCIES = new Set(['NGN', 'KES']);
const PAYCREST_EVM_NETWORKS = new Set([
  'ethereum',
  'base',
  'polygon',
  'arbitrum-one',
  'bnb-smart-chain',
  'lisk',
  'celo',
  'scroll',
]);
const PAYCREST_STABLE_TOKENS = new Set(['USDC', 'USDT', 'CNGN']);
const PAYCREST_FIAT_CURRENCIES = new Set(['NGN', 'KES']);
const MARKET_CHART_RANGE_CONFIG = {
  '1H': { coinGeckoDays: '1', timeframe: 'minute', aggregate: 5, limit: 24, ttlMs: 45 * 1000 },
  '1D': { coinGeckoDays: '1', timeframe: 'hour', aggregate: 1, limit: 48, ttlMs: 60 * 1000 },
  '1W': { coinGeckoDays: '7', timeframe: 'hour', aggregate: 4, limit: 64, ttlMs: 5 * 60 * 1000 },
  '1M': { coinGeckoDays: '30', timeframe: 'day', aggregate: 1, limit: 60, ttlMs: 10 * 60 * 1000 },
  '1Y': { coinGeckoDays: '365', timeframe: 'day', aggregate: 1, limit: 365, ttlMs: 60 * 60 * 1000 },
  All: { coinGeckoDays: '3650', timeframe: 'day', aggregate: 1, limit: 1000, ttlMs: 6 * 60 * 60 * 1000 },
};
const MARKET_CHART_FALLBACK_RANGES = {
  '1H': ['1D'],
  All: ['1Y', '1M'],
};
const MARKET_STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'BUSD']);
const MARKET_STABLE_COIN_IDS = new Set(['usd-coin', 'tether', 'dai', 'binance-usd']);
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
const MARKET_ONCHAIN_NETWORK_BY_PLATFORM = {
  'arbitrum-one': 'arbitrum',
  avalanche: 'avax',
  base: 'base',
  'binance-smart-chain': 'bsc',
  ethereum: 'eth',
  linea: 'linea',
  'optimistic-ethereum': 'optimism',
  scroll: 'scroll',
  zksync: 'zksync',
};
const MARKET_ONCHAIN_NETWORK_BY_EVM_CHAIN_ID = {
  1: 'eth',
  10: 'optimism',
  56: 'bsc',
  137: 'polygon_pos',
  324: 'zksync',
  8453: 'base',
  42161: 'arbitrum',
  43114: 'avax',
  534352: 'scroll',
  59144: 'linea',
};
const MARKET_DEXSCREENER_CHAIN_BY_PLATFORM = {
  'arbitrum-one': 'arbitrum',
  avalanche: 'avalanche',
  base: 'base',
  'binance-smart-chain': 'bsc',
  ethereum: 'ethereum',
  linea: 'linea',
  'optimistic-ethereum': 'optimism',
  scroll: 'scroll',
  zksync: 'zksync',
};
const MARKET_TOKEN_DATA_BATCH_SIZE = 25;
const HISTORY_ALCHEMY_NETWORK_BY_RECEIVE_NETWORK = {
  'bnb-chain': 'bnb-mainnet',
  ethereum: 'eth-mainnet',
  base: 'base-mainnet',
  optimism: 'opt-mainnet',
  arbitrum: 'arb-mainnet',
  avalanche: 'avax-mainnet',
  linea: 'linea-mainnet',
  zksync: 'zksync-mainnet',
  scroll: 'scroll-mainnet',
};
const HISTORY_TRANSFER_CATEGORIES = ['external', 'internal', 'erc20', 'erc721', 'erc1155'];
const HISTORY_ALCHEMY_TRANSFER_CATEGORIES_BY_NETWORK = {
  'bnb-chain': ['external', 'erc20'],
  base: ['external', 'erc20'],
  arbitrum: ['external', 'erc20'],
};
const HISTORY_ALCHEMY_SUCCESS_CACHE_TTL_MS = 2 * 60 * 1000;
const HISTORY_ALCHEMY_STALE_CACHE_TTL_MS = 30 * 60 * 1000;
const HISTORY_ALCHEMY_RETRY_DELAY_MS = 1500;
const HISTORY_PAGE_SIZE_HEX = '0x32';
const HISTORY_MAX_PAGES_PER_DIRECTION = 2;
const HISTORY_DIRECTIONS = new Set(['incoming', 'outgoing']);
const HISTORY_BSCSCAN_API_URL = 'https://api.bscscan.com/api';
const HISTORY_ETHERSCAN_V2_API_URL = 'https://api.etherscan.io/v2/api';
const HISTORY_ETHERSCAN_V2_CHAIN_ID_BY_NETWORK = {
  ethereum: 1,
  'bnb-chain': 56,
  base: 8453,
  arbitrum: 42161,
};
const HISTORY_EXPLORER_NETWORKS = new Set(['bnb-chain', 'ethereum', 'base', 'arbitrum']);
const HISTORY_EXPLORER_PAGE_SIZE = '100';
const HISTORY_PUBLIC_RPC_NETWORKS = new Set(['bnb-chain', 'base', 'arbitrum']);
const HISTORY_PUBLIC_RPC_DEFAULT_URLS_BY_NETWORK = {
  'bnb-chain': [
    'https://bsc-dataseed.binance.org',
    'https://bsc-dataseed1.binance.org',
    'https://bsc-dataseed2.binance.org',
    'https://bsc-dataseed3.binance.org',
    'https://bsc-dataseed4.binance.org',
    'https://bsc-dataseed1.defibit.io',
    'https://bsc-dataseed2.defibit.io',
    'https://bsc-rpc.publicnode.com',
    'https://rpc.ankr.com/bsc',
    'https://1rpc.io/bnb',
    'https://bsc.drpc.org',
    'https://binance.llamarpc.com',
  ],
  base: [
    'https://mainnet.base.org',
    'https://base-rpc.publicnode.com',
    'https://base.llamarpc.com',
    'https://rpc.ankr.com/base',
    'https://1rpc.io/base',
    'https://base.drpc.org',
    'https://base-mainnet.public.blastapi.io',
  ],
  arbitrum: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arbitrum.llamarpc.com',
    'https://rpc.ankr.com/arbitrum',
    'https://1rpc.io/arb',
    'https://arbitrum.drpc.org',
    'https://arbitrum-one.public.blastapi.io',
  ],
};
const HISTORY_PUBLIC_RPC_DEFAULT_LOOKBACK_BLOCKS_BY_NETWORK = {
  'bnb-chain': 8000,
  base: 5000,
  arbitrum: 12000,
};
const HISTORY_PUBLIC_RPC_BLOCK_CHUNK_SIZE_BY_NETWORK = {
  'bnb-chain': 400,
  base: 500,
  arbitrum: 1000,
};
const HISTORY_PUBLIC_RPC_BLOCK_CHUNK_SIZE = 500;
const HISTORY_PUBLIC_RPC_MIN_BLOCK_CHUNK_SIZE = 25;
const HISTORY_PUBLIC_RPC_MAX_LOGS = 100;
const HISTORY_PUBLIC_RPC_SUCCESS_CACHE_TTL_MS = 60 * 1000;
const HISTORY_PUBLIC_RPC_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const HISTORY_PUBLIC_RPC_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const HISTORY_PUBLIC_RPC_TIMEOUT_MS = 8000;
const HISTORY_PUBLIC_RPC_MAX_URL_ATTEMPTS = 3;
const HISTORY_PUBLIC_RPC_SCAN_BUDGET_MS = 25000;
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
  avalanche: 'avalanche-2',
  linea: 'ethereum',
  zksync: 'ethereum',
  scroll: 'ethereum',
};
const MARKET_WRAPPED_NATIVE_BY_NETWORK = {
  'bnb-chain': '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  ethereum: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  base: '0x4200000000000000000000000000000000000006',
  optimism: '0x4200000000000000000000000000000000000006',
  arbitrum: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
  avalanche: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
};
const MARKET_COIN_ID_BY_PLATFORM_CONTRACT = {
  'binance-smart-chain': {
    '0x55d398326f99059ff775485246999027b3197955': 'tether',
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'usd-coin',
    '0x6ec90334d89dbdc89e08a133271be3d104128edb': 'wiki-cat',
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
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'usd-coin',
  },
};
const MARKET_KNOWN_CHART_POOLS_BY_ONCHAIN_NETWORK_CONTRACT = {
  bsc: {
    '0x72928a49c4e88f382b0b6ff3e561f56dd75485f9': {
      poolAddress: '0x3e93fec6e3ae5940dac4869acf5178bd30f4fc04',
      tokenParam: 'base',
    },
  },
};
const marketChartCache = new Map();

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;

  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const index = trimmed.indexOf('=');
      if (index === -1) return;

      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if (!key || process.env[key] !== undefined) return;

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    });
}

loadEnvFile(envPath);

function cleanEnvValue(value, keyName = '') {
  let cleaned = String(value || '').trim();

  if (keyName && cleaned.startsWith(`${keyName}=`)) {
    cleaned = cleaned.slice(keyName.length + 1).trim();
  }

  while (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}

function normalizePaycrestApiBaseUrl(value) {
  const cleaned = cleanEnvValue(value || 'https://api.paycrest.io/v2', 'PAYCREST_API_BASE_URL').replace(/\/+$/, '');

  if (!cleaned) return 'https://api.paycrest.io/v2';
  if (/\/v2$/i.test(cleaned)) return cleaned;
  if (/\/v1$/i.test(cleaned)) return cleaned.replace(/\/v1$/i, '/v2');
  if (/^https?:\/\/api(?:-gateway)?\.paycrest\.io$/i.test(cleaned)) return `${cleaned}/v2`;

  return cleaned;
}

function normalizeTokenDecimals(value, fallbackValue) {
  const cleaned = cleanEnvValue(value);
  const numeric = Number(cleaned || fallbackValue);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 36) return fallbackValue;
  return numeric;
}
function normalizeSupabaseUrl(value) {
  return cleanEnvValue(value, 'SUPABASE_URL').replace(/\/+$/, '');
}
function normalizeSogoApiBaseUrl(value) {
  const cleaned = cleanEnvValue(value || 'https://api.sogo.africa/v1', 'SOGO_API_BASE_URL').replace(/\/+$/, '');

  if (!cleaned) return 'https://api.sogo.africa/v1';
  if (/\/v1$/i.test(cleaned)) return cleaned;
  if (/^https?:\/\/(?:api|sandbox)\.sogo\.africa$/i.test(cleaned)) return `${cleaned}/v1`;

  return cleaned;
}

const config = {
  port: Number(process.env.PORT || process.env.DOXA_BACKEND_PORT || 8787),
  allowedOrigins: (process.env.DOXA_BACKEND_ALLOWED_ORIGINS || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  railsApiBaseUrl: cleanEnvValue(process.env.RAILS_API_BASE_URL || 'https://b2b.usetapp.xyz', 'RAILS_API_BASE_URL'),
  railsApiKey: cleanEnvValue(process.env.RAILS_API_KEY, 'RAILS_API_KEY'),
  railsFeeMode: cleanEnvValue(process.env.RAILS_FEE_MODE, 'RAILS_FEE_MODE').toLowerCase(),
  railsFeePercent: cleanEnvValue(process.env.RAILS_FEE_PERCENT, 'RAILS_FEE_PERCENT'),
  railsFeeAmount: cleanEnvValue(process.env.RAILS_FEE_AMOUNT, 'RAILS_FEE_AMOUNT'),
  railsFeeAddress: cleanEnvValue(process.env.RAILS_FEE_ADDRESS, 'RAILS_FEE_ADDRESS'),
  paycrestApiBaseUrl: normalizePaycrestApiBaseUrl(process.env.PAYCREST_API_BASE_URL),
  paycrestApiKey: cleanEnvValue(process.env.PAYCREST_API_KEY, 'PAYCREST_API_KEY'),
  onboardApiBaseUrl: cleanEnvValue(
    process.env.ONBOARD_API_BASE_URL || 'https://external.dev.onboardpay.co',
    'ONBOARD_API_BASE_URL',
  ).replace(/\/+$/, '') || 'https://external.dev.onboardpay.co',
  onboardApiKey: cleanEnvValue(process.env.ONBOARD_API_KEY, 'ONBOARD_API_KEY'),
  onboardApiSecret: cleanEnvValue(process.env.ONBOARD_API_SECRET, 'ONBOARD_API_SECRET'),
  coinGeckoPublicApiBaseUrl: cleanEnvValue(process.env.COINGECKO_PUBLIC_API_BASE_URL || 'https://api.coingecko.com/api/v3', 'COINGECKO_PUBLIC_API_BASE_URL').replace(/\/+$/, ''),
  coinGeckoProApiBaseUrl: cleanEnvValue(process.env.COINGECKO_PRO_API_BASE_URL || 'https://pro-api.coingecko.com/api/v3', 'COINGECKO_PRO_API_BASE_URL').replace(/\/+$/, ''),
  coinGeckoApiKey: cleanEnvValue(process.env.COINGECKO_API_KEY || process.env.COINGECKO_DEMO_API_KEY, 'COINGECKO_API_KEY'),
  coinGeckoProApiKey: cleanEnvValue(process.env.COINGECKO_PRO_API_KEY, 'COINGECKO_PRO_API_KEY'),
  geckoTerminalApiBaseUrl: cleanEnvValue(process.env.GECKOTERMINAL_API_BASE_URL || 'https://api.geckoterminal.com/api/v2', 'GECKOTERMINAL_API_BASE_URL').replace(/\/+$/, ''),
  dexScreenerApiBaseUrl: cleanEnvValue(process.env.DEXSCREENER_API_BASE_URL || 'https://api.dexscreener.com', 'DEXSCREENER_API_BASE_URL').replace(/\/+$/, ''),
  alchemyApiKey: cleanEnvValue(process.env.ALCHEMY_API_KEY || process.env.EXPO_PUBLIC_ALCHEMY_API_KEY || process.env.REACT_APP_ALCHEMY_API_KEY, 'ALCHEMY_API_KEY'),
  etherscanApiKey: cleanEnvValue(process.env.ETHERSCAN_API_KEY || process.env.ETHERSCAN_API_TOKEN || process.env.EXPO_PUBLIC_ETHERSCAN_API_KEY || process.env.REACT_APP_ETHERSCAN_API_KEY, 'ETHERSCAN_API_KEY'),
  bscScanApiKey: cleanEnvValue(process.env.BSCSCAN_API_KEY || process.env.BSCSCAN_API_TOKEN || process.env.BSC_SCAN_API_KEY, 'BSCSCAN_API_KEY'),
  supabaseUrl: normalizeSupabaseUrl(process.env.SUPABASE_URL),
  supabaseServiceRoleKey: cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'),
  notificationsCronSecret: cleanEnvValue(process.env.DOXA_NOTIFICATIONS_CRON_SECRET, 'DOXA_NOTIFICATIONS_CRON_SECRET'),
  sogoApiBaseUrl: normalizeSogoApiBaseUrl(process.env.SOGO_API_BASE_URL),
  sogoApiKey: cleanEnvValue(process.env.SOGO_API_KEY, 'SOGO_API_KEY'),
  sogoBillsQuoteSecret: cleanEnvValue(process.env.SOGO_BILLS_QUOTE_SECRET, 'SOGO_BILLS_QUOTE_SECRET'),
  sogoBillsTreasuryAddress: cleanEnvValue(process.env.SOGO_BILLS_TREASURY_ADDRESS, 'SOGO_BILLS_TREASURY_ADDRESS'),
  sogoBillsRpcUrls: {
    'bnb-chain': cleanEnvValue(process.env.SOGO_BILLS_RPC_BNB_CHAIN_URL || process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org', 'SOGO_BILLS_RPC_BNB_CHAIN_URL'),
    ethereum: cleanEnvValue(process.env.SOGO_BILLS_RPC_ETHEREUM_URL || process.env.ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com', 'SOGO_BILLS_RPC_ETHEREUM_URL'),
    base: cleanEnvValue(process.env.SOGO_BILLS_RPC_BASE_URL || process.env.BASE_RPC_URL || 'https://base-rpc.publicnode.com', 'SOGO_BILLS_RPC_BASE_URL'),
    arbitrum: cleanEnvValue(process.env.SOGO_BILLS_RPC_ARBITRUM_URL || process.env.ARBITRUM_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com', 'SOGO_BILLS_RPC_ARBITRUM_URL'),
  },
  sogoBillsUsdcAddresses: {
    'bnb-chain': cleanEnvValue(process.env.SOGO_BILLS_USDC_BNB_CHAIN_ADDRESS || '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 'SOGO_BILLS_USDC_BNB_CHAIN_ADDRESS'),
    ethereum: cleanEnvValue(process.env.SOGO_BILLS_USDC_ETHEREUM_ADDRESS || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'SOGO_BILLS_USDC_ETHEREUM_ADDRESS'),
    base: cleanEnvValue(process.env.SOGO_BILLS_USDC_BASE_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'SOGO_BILLS_USDC_BASE_ADDRESS'),
    arbitrum: cleanEnvValue(process.env.SOGO_BILLS_USDC_ARBITRUM_ADDRESS || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'SOGO_BILLS_USDC_ARBITRUM_ADDRESS'),
  },
  sogoBillsUsdcDecimals: {
    'bnb-chain': normalizeTokenDecimals(process.env.SOGO_BILLS_USDC_BNB_CHAIN_DECIMALS, 18),
    ethereum: normalizeTokenDecimals(process.env.SOGO_BILLS_USDC_ETHEREUM_DECIMALS, 6),
    base: normalizeTokenDecimals(process.env.SOGO_BILLS_USDC_BASE_DECIMALS, 6),
    arbitrum: normalizeTokenDecimals(process.env.SOGO_BILLS_USDC_ARBITRUM_DECIMALS, 6),
  },
  sogoBillsUsdtAddresses: {
    'bnb-chain': cleanEnvValue(process.env.SOGO_BILLS_USDT_BNB_CHAIN_ADDRESS || '0x55d398326f99059fF775485246999027B3197955', 'SOGO_BILLS_USDT_BNB_CHAIN_ADDRESS'),
    ethereum: cleanEnvValue(process.env.SOGO_BILLS_USDT_ETHEREUM_ADDRESS || '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'SOGO_BILLS_USDT_ETHEREUM_ADDRESS'),
    base: cleanEnvValue(process.env.SOGO_BILLS_USDT_BASE_ADDRESS || '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 'SOGO_BILLS_USDT_BASE_ADDRESS'),
    arbitrum: cleanEnvValue(process.env.SOGO_BILLS_USDT_ARBITRUM_ADDRESS || '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 'SOGO_BILLS_USDT_ARBITRUM_ADDRESS'),
  },
  sogoBillsUsdtDecimals: {
    'bnb-chain': normalizeTokenDecimals(process.env.SOGO_BILLS_USDT_BNB_CHAIN_DECIMALS, 18),
    ethereum: normalizeTokenDecimals(process.env.SOGO_BILLS_USDT_ETHEREUM_DECIMALS, 6),
    base: normalizeTokenDecimals(process.env.SOGO_BILLS_USDT_BASE_DECIMALS, 6),
    arbitrum: normalizeTokenDecimals(process.env.SOGO_BILLS_USDT_ARBITRUM_DECIMALS, 6),
  },
  sogoBillsUsdcNgnRate: cleanEnvValue(process.env.SOGO_BILLS_USDC_NGN_RATE || process.env.SOGO_BILLS_STABLE_NGN_RATE, 'SOGO_BILLS_USDC_NGN_RATE'),
  sogoBillsUsdtNgnRate: cleanEnvValue(process.env.SOGO_BILLS_USDT_NGN_RATE || process.env.SOGO_BILLS_STABLE_NGN_RATE || process.env.SOGO_BILLS_USDC_NGN_RATE, 'SOGO_BILLS_USDT_NGN_RATE'),
  analyticsDashboardSecret: cleanEnvValue(process.env.DOXA_ANALYTICS_DASHBOARD_SECRET, 'DOXA_ANALYTICS_DASHBOARD_SECRET'),
  uptodownAppUrl: cleanEnvValue(process.env.DOXA_UPTODOWN_APP_URL, 'DOXA_UPTODOWN_APP_URL'),
  androidApkUrl: cleanEnvValue(
    process.env.DOXA_ANDROID_APK_URL ||
      'https://expo.dev/artifacts/eas/KBTpEz0-_fSQ2a2ecFdpPkkeEkGyupdBvAygwRwi9QI.apk',
    'DOXA_ANDROID_APK_URL',
  ),
};

function getAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return '*';
  if (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) return origin;
  return '';
}

function setCors(req, res) {
  const origin = getAllowedOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Accept, x-doxa-analytics-secret, x-doxa-notifications-cron-secret',
  );
  return Boolean(origin);
}

function sendJson(req, res, status, payload) {
  setCors(req, res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

const LEGAL_DIR = resolve(__dirname, '../public/legal');
const LEGAL_PAGES = {
  '/legal/privacy-policy': 'privacy-policy.html',
  '/legal/privacy-policy.html': 'privacy-policy.html',
  '/privacy': 'privacy-policy.html',
  '/privacy-policy': 'privacy-policy.html',
  '/legal/terms-of-service': 'terms-of-service.html',
  '/legal/terms-of-service.html': 'terms-of-service.html',
  '/terms': 'terms-of-service.html',
  '/terms-of-service': 'terms-of-service.html',
};

function trySendLegalPage(req, res, pathname) {
  const fileName = LEGAL_PAGES[pathname];
  if (!fileName) {
    return false;
  }

  const filePath = resolve(LEGAL_DIR, fileName);
  if (!filePath.startsWith(LEGAL_DIR) || !existsSync(filePath)) {
    throw new HttpError(404, 'not_found', 'Legal page not found.');
  }

  const html = readFileSync(filePath, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
  });
  res.end(html);
  return true;
}

function assertCors(req) {
  if (req.headers.origin && !getAllowedOrigin(req)) {
    throw new HttpError(403, 'origin_not_allowed', 'This origin is not allowed.');
  }
}

function assertRailsConfigured() {
  if (!config.railsApiKey) {
    throw new HttpError(500, 'rails_not_configured', 'Set RAILS_API_KEY on the backend.');
  }
}

function assertPaycrestConfigured() {
  if (!config.paycrestApiKey) {
    throw new HttpError(500, 'paycrest_not_configured', 'Set PAYCREST_API_KEY on the backend.');
  }
}
function assertAnalyticsConfigured() {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new HttpError(500, 'analytics_not_configured', 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the backend.');
  }
}
function assertSogoConfigured() {
  if (!config.sogoApiKey) {
    throw new HttpError(500, 'sogo_not_configured', 'Set SOGO_API_KEY on the backend.');
  }
}

function assertSogoBillsCollectionConfigured() {
  if (!config.sogoBillsTreasuryAddress || !/^0x[a-fA-F0-9]{40}$/.test(config.sogoBillsTreasuryAddress)) {
    throw new HttpError(500, 'sogo_bills_collection_not_configured', 'Set SOGO_BILLS_TREASURY_ADDRESS on the backend.');
  }
}

function readRawBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        rejectBody(new HttpError(413, 'payload_too_large', 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolveBody(Buffer.concat(chunks));
    });

    req.on('error', rejectBody);
  });
}

function readJson(req) {
  return new Promise((resolveBody, rejectBody) => {
    readRawBody(req).then((rawBody) => {
      try {
        const raw = rawBody.toString('utf8');
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        rejectBody(new HttpError(400, 'invalid_json', 'Request body must be valid JSON.'));
      }
    }).catch(rejectBody);
  });
}

async function readResponseJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function asMarketRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function getMarketString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function parseMarketNumber(value) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMarketAddress(value) {
  const cleaned = getMarketString(value).toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(cleaned) ? cleaned : '';
}

function normalizeMarketRange(value) {
  const range = getMarketString(value) || '1D';
  if (!Object.prototype.hasOwnProperty.call(MARKET_CHART_RANGE_CONFIG, range)) {
    throw new HttpError(400, 'invalid_market_params', 'Chart range is not supported.');
  }
  return range;
}

function normalizeMarketCurrency(value) {
  const currency = (getMarketString(value) || 'usd').toLowerCase();
  if (!/^[a-z]{2,8}$/.test(currency)) {
    throw new HttpError(400, 'invalid_market_params', 'Chart currency is invalid.');
  }
  return currency;
}

function normalizeMarketNetworkId(value) {
  const networkId = getMarketString(value).toLowerCase();
  if (!/^[a-z0-9-]{2,60}$/.test(networkId)) {
    throw new HttpError(400, 'invalid_market_params', 'Chart network is invalid.');
  }
  return networkId;
}

function normalizeMarketSymbol(value) {
  const symbol = (getMarketString(value) || 'TOKEN').toUpperCase();
  if (!/^[A-Z0-9._-]{1,32}$/.test(symbol)) {
    throw new HttpError(400, 'invalid_market_params', 'Chart token symbol is invalid.');
  }
  return symbol;
}

function normalizeMarketEvmChainId(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function getMarketCacheKey(request) {
  return [
    request.networkId,
    request.contractAddress || request.symbol,
    request.range,
    request.currency,
  ].join(':');
}

function getCachedMarketChart(cacheKey, range, stale = false) {
  const cached = marketChartCache.get(cacheKey);
  if (!cached) return null;
  if (!stale && Date.now() - cached.timestamp > MARKET_CHART_RANGE_CONFIG[range].ttlMs) return null;
  return { ...cached.data, cached: true };
}

function cacheMarketChart(cacheKey, data) {
  marketChartCache.set(cacheKey, { data: { ...data, cached: false }, timestamp: Date.now() });
}

function getMarketRangeStartMs(range) {
  const now = Date.now();
  switch (range) {
    case '1H': return now - 60 * 60 * 1000;
    case '1D': return now - 24 * 60 * 60 * 1000;
    case '1W': return now - 7 * 24 * 60 * 60 * 1000;
    case '1M': return now - 30 * 24 * 60 * 60 * 1000;
    case '1Y': return now - 365 * 24 * 60 * 60 * 1000;
    case 'All': return null;
    default: return now - 24 * 60 * 60 * 1000;
  }
}

function normalizeMarketChartPoints(points, range) {
  const startMs = getMarketRangeStartMs(range);
  const sortedPoints = points
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price) && point.price > 0)
    .sort((first, second) => first.timestamp - second.timestamp)
    .filter((point, index, allPoints) => index === 0 || point.timestamp !== allPoints[index - 1].timestamp);
  const rangedPoints = startMs === null ? sortedPoints : sortedPoints.filter((point) => point.timestamp >= startMs);
  const minimumPoints = Math.min(2, sortedPoints.length);

  if (rangedPoints.length >= minimumPoints) return rangedPoints;
  return sortedPoints.slice(-Math.max(MARKET_CHART_RANGE_CONFIG[range].limit, minimumPoints));
}

function getMarketRangeDurationMs(range) {
  switch (range) {
    case '1H': return 60 * 60 * 1000;
    case '1D': return 24 * 60 * 60 * 1000;
    case '1W': return 7 * 24 * 60 * 60 * 1000;
    case '1M': return 30 * 24 * 60 * 60 * 1000;
    case '1Y': return 365 * 24 * 60 * 60 * 1000;
    case 'All': return 3650 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

function buildMarketPriceLineChart(range, price) {
  const configForRange = MARKET_CHART_RANGE_CONFIG[range] || MARKET_CHART_RANGE_CONFIG['1D'];
  const count = Math.max(2, Math.min(configForRange.limit || 48, range === 'All' ? 365 : 96));
  const now = Date.now();
  const durationMs = getMarketRangeDurationMs(range);
  const stepMs = durationMs / Math.max(count - 1, 1);

  return Array.from({ length: count }, (_, index) => ({
    timestamp: Math.round(now - durationMs + stepMs * index),
    price,
  }));
}

function isMarketStablecoinRequest(request, coinId) {
  return MARKET_STABLE_SYMBOLS.has(request.symbol) || (coinId ? MARKET_STABLE_COIN_IDS.has(coinId) : false);
}

function getCoinGeckoChartPoints(payload, range) {
  const prices = Array.isArray(payload?.prices) ? payload.prices : [];
  const points = [];

  for (const row of prices) {
    if (!Array.isArray(row)) continue;
    const timestamp = parseMarketNumber(row[0]);
    const price = parseMarketNumber(row[1]);
    if (timestamp !== null && price !== null) points.push({ timestamp, price });
  }

  return normalizeMarketChartPoints(points, range);
}

function getOhlcvChartPoints(payload, range) {
  const attributes = asMarketRecord(asMarketRecord(payload?.data)?.attributes);
  const ohlcvList = Array.isArray(attributes?.ohlcv_list) ? attributes.ohlcv_list : [];
  const points = [];

  for (const row of ohlcvList) {
    if (!Array.isArray(row)) continue;
    const timestampSeconds = parseMarketNumber(row[0]);
    const close = parseMarketNumber(row[4]);
    if (timestampSeconds !== null && close !== null) points.push({ timestamp: timestampSeconds * 1000, price: close });
  }

  return normalizeMarketChartPoints(points, range);
}

function getMarketPlatformId(networkId) {
  return MARKET_PLATFORM_BY_NETWORK[networkId];
}

function getMarketOnchainNetworkId(networkId, evmChainId) {
  const platformId = getMarketPlatformId(networkId);
  if (platformId) return MARKET_ONCHAIN_NETWORK_BY_PLATFORM[platformId];
  return evmChainId ? MARKET_ONCHAIN_NETWORK_BY_EVM_CHAIN_ID[evmChainId] : undefined;
}

function getMarketCoinId(request) {
  const platformId = getMarketPlatformId(request.networkId);
  if (request.contractAddress && platformId) {
    const knownCoinId = MARKET_COIN_ID_BY_PLATFORM_CONTRACT[platformId]?.[request.contractAddress];
    if (knownCoinId) return knownCoinId;
  }

  if (!request.contractAddress) {
    return MARKET_NATIVE_COIN_ID_BY_NETWORK[request.networkId] || MARKET_COIN_ID_BY_SYMBOL[request.symbol];
  }

  return MARKET_COIN_ID_BY_SYMBOL[request.symbol];
}

function getMarketRelationshipDataId(record, key) {
  const relationships = asMarketRecord(record?.relationships);
  const relationship = asMarketRecord(relationships?.[key]);
  const data = asMarketRecord(relationship?.data);
  return getMarketString(data?.id).toLowerCase();
}

function getMarketPoolTokenParam(poolRecord, contractAddress) {
  const baseTokenId = getMarketRelationshipDataId(poolRecord, 'base_token');
  const quoteTokenId = getMarketRelationshipDataId(poolRecord, 'quote_token');
  if (baseTokenId.includes(contractAddress)) return 'base';
  if (quoteTokenId.includes(contractAddress)) return 'quote';
  return 'base';
}

function getTopMarketPool(payload, contractAddress) {
  const dataItems = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
  const included = Array.isArray(payload?.included) ? payload.included : [];
  const poolRecords = [...dataItems, ...included]
    .map((item) => asMarketRecord(item))
    .filter((item) => getMarketString(item?.type) === 'pool');

  if (!poolRecords.length) return null;

  const topPool = poolRecords.reduce((bestPool, currentPool) => {
    if (!bestPool) return currentPool;
    const currentReserve = parseMarketNumber(asMarketRecord(currentPool.attributes)?.reserve_in_usd) || 0;
    const bestReserve = parseMarketNumber(asMarketRecord(bestPool.attributes)?.reserve_in_usd) || 0;
    return currentReserve > bestReserve ? currentPool : bestPool;
  }, null);
  const poolAddress = normalizeMarketAddress(asMarketRecord(topPool?.attributes)?.address);

  return poolAddress ? { poolAddress, tokenParam: getMarketPoolTokenParam(topPool, contractAddress) } : null;
}

async function requestMarketProvider(url, { headers } = {}) {
  const response = await fetch(url, { headers: { Accept: 'application/json', ...(headers || {}) } });
  const payload = await readResponseJson(response);

  if (!response.ok) {
    throw new HttpError(response.status, 'market_provider_failed', 'Live chart data is temporarily unavailable.');
  }

  return payload;
}

async function requestCoinGecko(path) {
  const options = [];
  if (config.coinGeckoApiKey) {
    options.push({ baseUrl: config.coinGeckoPublicApiBaseUrl, headers: { 'x-cg-demo-api-key': config.coinGeckoApiKey } });
  }
  if (config.coinGeckoProApiKey || config.coinGeckoApiKey) {
    options.push({ baseUrl: config.coinGeckoProApiBaseUrl, headers: { 'x-cg-pro-api-key': config.coinGeckoProApiKey || config.coinGeckoApiKey } });
  }
  options.push({ baseUrl: config.coinGeckoPublicApiBaseUrl, headers: undefined });

  let lastError;
  for (const option of options) {
    try {
      return await requestMarketProvider(`${option.baseUrl}${path}`, { headers: option.headers });
    } catch (error) {
      lastError = error;
      if (!(error instanceof HttpError) || ![401, 403, 429].includes(error.status)) break;
    }
  }

  throw lastError || new HttpError(502, 'market_provider_failed', 'Live chart data is temporarily unavailable.');
}

async function fetchMarketCoinChart(coinId, range, currency) {
  const configForRange = MARKET_CHART_RANGE_CONFIG[range];
  const payload = await requestCoinGecko(`/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=${encodeURIComponent(currency)}&days=${encodeURIComponent(configForRange.coinGeckoDays)}`);
  const points = getCoinGeckoChartPoints(payload, range);
  return points.length >= 2 ? points : null;
}

async function getMarketCoinPrices(coinIds, currency) {
  const result = {};

  for (const coinIdChunk of chunkMarketItems(coinIds)) {
    const idsString = coinIdChunk.map(encodeURIComponent).join(',');
    const payload = await requestCoinGecko(
      `/simple/price?ids=${idsString}&vs_currencies=${encodeURIComponent(currency)}&include_market_cap=false&include_24hr_vol=false&include_24hr_change=true`,
    );

    for (const coinId of coinIdChunk) {
      const row = asMarketRecord(payload?.[coinId]);
      const price = parseMarketNumber(row?.[currency]);
      const change24h = parseMarketNumber(row?.[`${currency}_24h_change`]);

      result[coinId] = {
        price: price !== null && price > 0 ? price : null,
        change24h,
      };
    }
  }

  return result;
}

async function fetchMarketSimplePrice(coinId, currency) {
  const payload = await requestCoinGecko(`/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=${encodeURIComponent(currency)}`);
  const price = parseMarketNumber(asMarketRecord(payload?.[coinId])?.[currency]);
  return price !== null && price > 0 ? price : null;
}

function getMarketDataFromSimpleTokenPrice(payload, address, currency) {
  const row = asMarketRecord(payload?.[address]) ?? asMarketRecord(payload?.[address.toLowerCase()]);
  const price = parseMarketNumber(row?.[currency]);
  const change24h = parseMarketNumber(row?.[`${currency}_24h_change`]);

  return {
    price: price !== null && price > 0 ? price : null,
    change24h,
  };
}

function chunkMarketItems(items, size = MARKET_TOKEN_DATA_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeMarketPlatformId(value) {
  const platformId = getMarketString(value).toLowerCase();
  if (!/^[a-z0-9-]{2,80}$/.test(platformId)) {
    throw new HttpError(400, 'invalid_market_params', 'Market platform is invalid.');
  }
  return platformId;
}

function normalizeMarketCoinIdList(value) {
  const coinIds = getMarketString(value)
    .split(',')
    .map((coinId) => coinId.trim().toLowerCase())
    .filter((coinId) => /^[a-z0-9._-]{1,100}$/.test(coinId));

  return Array.from(new Set(coinIds));
}

function normalizeMarketAddressList(value) {
  const addresses = getMarketString(value)
    .split(',')
    .map((address) => normalizeMarketAddress(address))
    .filter(Boolean);

  return Array.from(new Set(addresses));
}

async function fetchMarketContractPricesFromCoinGecko(platformId, contractAddresses, currency) {
  const result = {};

  for (const addressChunk of chunkMarketItems(contractAddresses)) {
    const addressesString = addressChunk.map(encodeURIComponent).join(',');
    const payload = await requestCoinGecko(
      `/simple/token_price/${encodeURIComponent(platformId)}?contract_addresses=${addressesString}&vs_currencies=${encodeURIComponent(currency)}&include_market_cap=false&include_24hr_vol=false&include_24hr_change=true`,
    );

    for (const address of addressChunk) {
      result[address] = getMarketDataFromSimpleTokenPrice(payload, address, currency);
    }
  }

  return result;
}

function getDexScreenerPairsFromPayload(payload) {
  const pairs = Array.isArray(payload) ? payload : Array.isArray(payload?.pairs) ? payload.pairs : [];
  return pairs.map((pair) => asMarketRecord(pair)).filter(Boolean);
}

function selectBestMarketDexPair(pairs) {
  return pairs.reduce((bestPair, currentPair) => {
    if (!bestPair) return currentPair;

    const bestLiquidity = parseMarketNumber(asMarketRecord(bestPair.liquidity)?.usd) || 0;
    const currentLiquidity = parseMarketNumber(asMarketRecord(currentPair.liquidity)?.usd) || 0;
    const bestVolume = parseMarketNumber(asMarketRecord(bestPair.volume)?.h24) || 0;
    const currentVolume = parseMarketNumber(asMarketRecord(currentPair.volume)?.h24) || 0;
    const bestScore = bestLiquidity * 10 + bestVolume;
    const currentScore = currentLiquidity * 10 + currentVolume;

    return currentScore > bestScore ? currentPair : bestPair;
  }, null);
}

async function getMarketUsdToCurrencyRate(currency) {
  if (currency === 'usd') return 1;

  try {
    return await fetchMarketSimplePrice('usd-coin', currency);
  } catch {
    return null;
  }
}

async function requestDexScreener(path) {
  return requestMarketProvider(`${config.dexScreenerApiBaseUrl}${path}`);
}

async function fetchDexScreenerContractPrices(platformId, contractAddresses, currency) {
  const chainId = MARKET_DEXSCREENER_CHAIN_BY_PLATFORM[platformId];
  if (!chainId) return {};

  const requestedAddresses = new Set(contractAddresses);
  const pairsByAddress = new Map();

  for (const addressChunk of chunkMarketItems(contractAddresses)) {
    const encodedAddresses = addressChunk.map(encodeURIComponent).join(',');
    const endpoints = [
      `/tokens/v1/${encodeURIComponent(chainId)}/${encodedAddresses}`,
      `/latest/dex/tokens/${encodedAddresses}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const payload = await requestDexScreener(endpoint);
        const pairs = getDexScreenerPairsFromPayload(payload).filter((pair) => !pair.chainId || pair.chainId === chainId);

        for (const pair of pairs) {
          const baseTokenAddress = normalizeMarketAddress(asMarketRecord(pair.baseToken)?.address);
          if (!baseTokenAddress || !requestedAddresses.has(baseTokenAddress)) continue;

          const tokenPairs = pairsByAddress.get(baseTokenAddress) || [];
          tokenPairs.push(pair);
          pairsByAddress.set(baseTokenAddress, tokenPairs);
        }
      } catch {
        // Try the next DexScreener endpoint/chunk.
      }
    }
  }

  const usdToCurrencyRate = await getMarketUsdToCurrencyRate(currency);
  const result = {};

  for (const address of contractAddresses) {
    const bestPair = selectBestMarketDexPair(pairsByAddress.get(address) || []);
    if (!bestPair) continue;

    const usdPrice = parseMarketNumber(bestPair.priceUsd);
    const price = usdPrice !== null && usdToCurrencyRate !== null ? usdPrice * usdToCurrencyRate : null;
    result[address] = {
      price: price !== null && price > 0 ? price : null,
      change24h: parseMarketNumber(asMarketRecord(bestPair.priceChange)?.h24),
    };
  }

  return result;
}

function isCompleteMarketDataRow(row) {
  return Boolean(row && row.price !== null && row.price !== undefined && row.change24h !== null && row.change24h !== undefined);
}

async function getMarketTokenPrices(request) {
  const result = {};

  try {
    Object.assign(
      result,
      await fetchMarketContractPricesFromCoinGecko(request.platformId, request.contractAddresses, request.currency),
    );
  } catch (error) {
    if (!(error instanceof HttpError) || ![401, 403, 404, 429].includes(error.status)) {
      console.warn('Market token price provider failed', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  const fallbackAddresses = request.contractAddresses.filter((address) => !isCompleteMarketDataRow(result[address]));
  if (fallbackAddresses.length) {
    const fallbackData = await fetchDexScreenerContractPrices(request.platformId, fallbackAddresses, request.currency);

    for (const address of fallbackAddresses) {
      const currentData = result[address] || { price: null, change24h: null };
      const dexData = fallbackData[address];
      result[address] = {
        price: currentData.price ?? dexData?.price ?? null,
        change24h: currentData.change24h ?? dexData?.change24h ?? null,
      };
    }
  }

  for (const address of request.contractAddresses) {
    if (!result[address]) {
      result[address] = { price: null, change24h: null };
    }
  }

  return result;
}

async function fetchMarketContractChart(platformId, contractAddress, range, currency) {
  const configForRange = MARKET_CHART_RANGE_CONFIG[range];
  const payload = await requestCoinGecko(`/coins/${encodeURIComponent(platformId)}/contract/${encodeURIComponent(contractAddress)}/market_chart?vs_currency=${encodeURIComponent(currency)}&days=${encodeURIComponent(configForRange.coinGeckoDays)}`);
  const points = getCoinGeckoChartPoints(payload, range);
  return points.length >= 2 ? points : null;
}

async function fetchMarketOnchainTokenChart(networkId, contractAddress, range) {
  const configForRange = MARKET_CHART_RANGE_CONFIG[range];
  const payload = await requestCoinGecko(`/onchain/networks/${encodeURIComponent(networkId)}/tokens/${encodeURIComponent(contractAddress)}/ohlcv/${configForRange.timeframe}?aggregate=${encodeURIComponent(String(configForRange.aggregate))}&limit=${encodeURIComponent(String(configForRange.limit))}&currency=usd`);
  const points = getOhlcvChartPoints(payload, range);
  return points.length >= 2 ? points : null;
}

async function requestGeckoTerminal(path) {
  return requestMarketProvider(`${config.geckoTerminalApiBaseUrl}${path}`);
}

async function fetchGeckoTerminalTopPool(networkId, contractAddress) {
  const knownPool = MARKET_KNOWN_CHART_POOLS_BY_ONCHAIN_NETWORK_CONTRACT[networkId]?.[contractAddress];

  if (knownPool) {
    return knownPool;
  }

  try {
    const tokenPayload = await requestGeckoTerminal(`/networks/${encodeURIComponent(networkId)}/tokens/${encodeURIComponent(contractAddress)}?include=top_pools`);
    const tokenTopPool = getTopMarketPool(tokenPayload, contractAddress);
    if (tokenTopPool) return tokenTopPool;
  } catch {
    // Continue to the pools endpoint below.
  }

  const poolsPayload = await requestGeckoTerminal(`/networks/${encodeURIComponent(networkId)}/tokens/${encodeURIComponent(contractAddress)}/pools?include=base_token,quote_token&page=1`);
  return getTopMarketPool(poolsPayload, contractAddress);
}

async function fetchGeckoTerminalMarketChart(networkId, contractAddress, range) {
  const topPool = await fetchGeckoTerminalTopPool(networkId, contractAddress);
  if (!topPool) return null;

  const configForRange = MARKET_CHART_RANGE_CONFIG[range];
  const payload = await requestGeckoTerminal(`/networks/${encodeURIComponent(networkId)}/pools/${encodeURIComponent(topPool.poolAddress)}/ohlcv/${configForRange.timeframe}?aggregate=${encodeURIComponent(String(configForRange.aggregate))}&limit=${encodeURIComponent(String(configForRange.limit))}&currency=usd&token=${encodeURIComponent(topPool.tokenParam)}`);
  const points = getOhlcvChartPoints(payload, range);
  return points.length >= 2 ? points : null;
}

async function getMarketChartFromProviders(request, range) {
  const platformId = getMarketPlatformId(request.networkId);
  const onchainNetworkId = getMarketOnchainNetworkId(request.networkId, request.evmChainId);
  const providers = [];
  const coinId = getMarketCoinId(request);

  if (coinId) {
    providers.push(async () => {
      const points = await fetchMarketCoinChart(coinId, range, request.currency);
      return points ? { points, provider: 'coingecko' } : null;
    });
  }

  if (request.contractAddress && platformId) {
    providers.push(async () => {
      const points = await fetchMarketContractChart(platformId, request.contractAddress, range, request.currency);
      return points ? { points, provider: 'coingecko-contract' } : null;
    });
  }

  const chartContractAddress = request.contractAddress || MARKET_WRAPPED_NATIVE_BY_NETWORK[request.networkId] || '';

  if (chartContractAddress && onchainNetworkId) {
    providers.push(async () => {
      const points = await fetchMarketOnchainTokenChart(onchainNetworkId, chartContractAddress, range);
      return points ? { points, provider: 'coingecko-onchain' } : null;
    });
    providers.push(async () => {
      const points = await fetchGeckoTerminalMarketChart(onchainNetworkId, chartContractAddress, range);
      return points ? { points, provider: 'geckoterminal' } : null;
    });
  }

  for (const provider of providers) {
    try {
      const result = await provider();
      if (result) return result;
    } catch (error) {
      if (!(error instanceof HttpError) || ![401, 403, 404, 429].includes(error.status)) {
        console.warn('Market chart provider failed', { message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return null;
}

async function getMarketFallbackChartPrice(request) {
  const directPrice = parseMarketNumber(request.currentPrice);
  if (directPrice !== null && directPrice > 0) return directPrice;

  const platformId = getMarketPlatformId(request.networkId);
  if (request.contractAddress && platformId) {
    try {
      const marketData = await getMarketTokenPrices({
        platformId,
        contractAddresses: [request.contractAddress],
        currency: request.currency,
      });
      const contractPrice = parseMarketNumber(marketData[request.contractAddress]?.price);
      if (contractPrice !== null && contractPrice > 0) return contractPrice;
    } catch {
      // Continue to coin-id/stablecoin fallbacks below.
    }
  }

  const coinId = getMarketCoinId(request);
  if (coinId) {
    try {
      const simplePrice = await fetchMarketSimplePrice(coinId, request.currency);
      if (simplePrice !== null) return simplePrice;
    } catch {
      // Stablecoins can still render an honest flat peg line when price APIs are unavailable.
    }
  }

  if (isMarketStablecoinRequest(request, coinId)) {
    if (request.currency === 'usd') return 1;

    try {
      const currencyRate = await getMarketUsdToCurrencyRate(request.currency);
      if (currencyRate !== null && currencyRate > 0) return currencyRate;
    } catch {
      return null;
    }
  }

  return null;
}

async function getMarketChart(request) {
  const cacheKey = getMarketCacheKey(request);
  const cached = getCachedMarketChart(cacheKey, request.range);
  if (cached) return cached;

  const rangesToTry = [request.range, ...(MARKET_CHART_FALLBACK_RANGES[request.range] || [])];

  for (const range of rangesToTry) {
    const result = await getMarketChartFromProviders(request, range);
    if (!result) continue;

    const data = {
      ...result,
      points: range === request.range ? result.points : normalizeMarketChartPoints(result.points, request.range),
      cached: false,
      refreshedAt: Date.now(),
    };
    cacheMarketChart(cacheKey, data);
    return data;
  }

  const stale = getCachedMarketChart(cacheKey, request.range, true);
  if (stale) return stale;

  const fallbackPrice = await getMarketFallbackChartPrice(request);
  if (fallbackPrice !== null) {
    const data = {
      points: buildMarketPriceLineChart(request.range, fallbackPrice),
      provider: 'doxa-market',
      cached: false,
      refreshedAt: Date.now(),
    };
    cacheMarketChart(cacheKey, data);
    return data;
  }

  throw new HttpError(503, 'market_chart_unavailable', 'Live chart data is temporarily unavailable.');
}

function getMarketRouteSegments(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const marketIndex = segments[0] === 'api' ? 1 : 0;

  if (segments[marketIndex] !== 'market') return [];
  const pathSegments = segments.slice(marketIndex + 1).map((segment) => decodeURIComponent(segment));
  return pathSegments.length > 0 ? pathSegments : getVercelCatchAllSegments(url);
}

async function handleMarketProxy(req, res, url) {
  assertCors(req);
  const segments = getMarketRouteSegments(url);

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'health') {
    sendJson(req, res, 200, {
      status: 'ok',
      service: 'doxa-market-proxy',
      configured: Boolean(config.coinGeckoApiKey || config.coinGeckoProApiKey),
    });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'coin-prices') {
    const coinIds = normalizeMarketCoinIdList(url.searchParams.get('ids'));
    if (!coinIds.length) {
      throw new HttpError(400, 'invalid_market_params', 'At least one coin id is required.');
    }

    const currency = normalizeMarketCurrency(url.searchParams.get('currency'));
    const marketData = await getMarketCoinPrices(coinIds, currency);
    sendJson(req, res, 200, { data: { marketData, refreshedAt: Date.now() } });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'token-prices') {
    const contractAddresses = normalizeMarketAddressList(url.searchParams.get('contractAddresses'));
    if (!contractAddresses.length) {
      throw new HttpError(400, 'invalid_market_params', 'At least one token contract address is required.');
    }

    const request = {
      platformId: normalizeMarketPlatformId(url.searchParams.get('platformId')),
      contractAddresses,
      currency: normalizeMarketCurrency(url.searchParams.get('currency')),
    };
    const marketData = await getMarketTokenPrices(request);
    sendJson(req, res, 200, { data: { marketData, refreshedAt: Date.now() } });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'charts') {
    const request = {
      symbol: normalizeMarketSymbol(url.searchParams.get('symbol')),
      networkId: normalizeMarketNetworkId(url.searchParams.get('networkId')),
      range: normalizeMarketRange(url.searchParams.get('range')),
      currency: normalizeMarketCurrency(url.searchParams.get('currency')),
      contractAddress: normalizeMarketAddress(url.searchParams.get('contractAddress')),
      evmChainId: normalizeMarketEvmChainId(url.searchParams.get('evmChainId')),
      currentPrice: parseMarketNumber(url.searchParams.get('currentPrice')),
    };
    const chart = await getMarketChart(request);
    sendJson(req, res, 200, { data: chart });
    return;
  }

  throw new HttpError(404, 'not_found', 'Market route not found.');
}
function normalizeHistoryNetworkId(value) {
  const networkId = getMarketString(value).toLowerCase();
  if (!HISTORY_ALCHEMY_NETWORK_BY_RECEIVE_NETWORK[networkId]) {
    throw new HttpError(400, 'invalid_history_params', 'Transaction history is not supported for this network yet.');
  }
  return networkId;
}

function normalizeHistoryDirection(value) {
  const direction = getMarketString(value).toLowerCase();
  if (!direction) return '';
  if (!HISTORY_DIRECTIONS.has(direction)) {
    throw new HttpError(400, 'invalid_history_params', 'Transaction history direction is invalid.');
  }
  return direction;
}

function requireHistoryWalletAddress(value) {
  const address = getMarketString(value);
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new HttpError(400, 'invalid_history_params', 'Wallet address is invalid.');
  }
  return address;
}

function requireAlchemyHistoryApiKey() {
  const apiKey = cleanEnvValue(config.alchemyApiKey, 'ALCHEMY_API_KEY');
  if (!apiKey || ['demo', 'docs-demo', 'YOUR_API_KEY', 'your_alchemy_api_key_here'].includes(apiKey)) {
    throw new HttpError(503, 'history_provider_unconfigured', 'Transaction history is temporarily unavailable.');
  }
  return apiKey;
}

const historyAlchemyTransferCache = new Map();
const historyAlchemyTransferInflight = new Map();

const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

function getHistoryAlchemyCacheKey({ walletAddress, networkId, direction }) {
  return `${networkId}:${direction}:${walletAddress.toLowerCase()}`;
}

function getRetryAfterMs(response) {
  const retryAfter = Number(response.headers.get('retry-after'));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1000, 5000)
    : HISTORY_ALCHEMY_RETRY_DELAY_MS;
}

async function fetchAlchemyHistoryPage(endpoint, networkId, direction, pageCount, transferParams) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${networkId}-${direction}-${pageCount}`,
      method: 'alchemy_getAssetTransfers',
      params: [transferParams],
    }),
  });
  const payload = await readResponseJson(response);

  if (response.status === 429) {
    await wait(getRetryAfterMs(response));
    const retryResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `${networkId}-${direction}-${pageCount}-retry`,
        method: 'alchemy_getAssetTransfers',
        params: [transferParams],
      }),
    });
    const retryPayload = await readResponseJson(retryResponse);

    if (!retryResponse.ok || retryPayload?.error) {
      throw new HttpError(retryResponse.status || 502, 'history_provider_failed', 'Transaction history is temporarily unavailable.');
    }

    return retryPayload;
  }

  if (!response.ok || payload?.error) {
    throw new HttpError(response.status || 502, 'history_provider_failed', 'Transaction history is temporarily unavailable.');
  }

  return payload;
}

async function requestAlchemyHistoryTransfersUncached({ apiKey, walletAddress, networkId, direction }) {
  const alchemyNetwork = HISTORY_ALCHEMY_NETWORK_BY_RECEIVE_NETWORK[networkId];
  const endpoint = `https://${alchemyNetwork}.g.alchemy.com/v2/${apiKey}`;
  const transfers = [];
  let pageKey;
  let pageCount = 0;
  const categories = HISTORY_ALCHEMY_TRANSFER_CATEGORIES_BY_NETWORK[networkId] ?? HISTORY_TRANSFER_CATEGORIES;

  do {
    const transferParams = {
      fromBlock: '0x0',
      toBlock: 'latest',
      category: categories,
      withMetadata: true,
      excludeZeroValue: true,
      maxCount: HISTORY_PAGE_SIZE_HEX,
      order: 'desc',
      ...(direction === 'incoming' ? { toAddress: walletAddress } : { fromAddress: walletAddress }),
      ...(pageKey ? { pageKey } : {}),
    };
    const payload = await fetchAlchemyHistoryPage(endpoint, networkId, direction, pageCount, transferParams);

    transfers.push(...(Array.isArray(payload?.result?.transfers) ? payload.result.transfers : []));
    pageKey = payload?.result?.pageKey;
    pageCount += 1;
  } while (pageKey && pageCount < HISTORY_MAX_PAGES_PER_DIRECTION);

  return transfers;
}

async function requestAlchemyHistoryTransfers({ apiKey, walletAddress, networkId, direction }) {
  const cacheKey = getHistoryAlchemyCacheKey({ walletAddress, networkId, direction });
  const now = Date.now();
  const cached = historyAlchemyTransferCache.get(cacheKey);

  if (cached && now - cached.timestamp <= HISTORY_ALCHEMY_SUCCESS_CACHE_TTL_MS) {
    return cached.transfers;
  }

  if (historyAlchemyTransferInflight.has(cacheKey)) {
    return historyAlchemyTransferInflight.get(cacheKey);
  }

  const requestPromise = requestAlchemyHistoryTransfersUncached({ apiKey, walletAddress, networkId, direction })
    .then((transfers) => {
      historyAlchemyTransferCache.set(cacheKey, { transfers, timestamp: Date.now() });
      return transfers;
    })
    .catch((error) => {
      if (cached && now - cached.timestamp <= HISTORY_ALCHEMY_STALE_CACHE_TTL_MS) {
        return cached.transfers;
      }

      throw error;
    })
    .finally(() => {
      historyAlchemyTransferInflight.delete(cacheKey);
    });

  historyAlchemyTransferInflight.set(cacheKey, requestPromise);
  return requestPromise;
}

async function getAlchemyHistoryTransfers(request) {
  const apiKey = requireAlchemyHistoryApiKey();
  const directions = request.direction ? [request.direction] : ['incoming', 'outgoing'];
  const transferGroups = [];

  for (const direction of directions) {
    transferGroups.push(await requestAlchemyHistoryTransfers({ ...request, apiKey, direction }));
  }

  return transferGroups.flat();
}
const historyPublicRpcTransferCache = new Map();
const historyPublicRpcMetadataCache = new Map();
const historyPublicRpcBlockCache = new Map();
const historyPublicRpcProviderCooldownUntil = new Map();
let historyPublicRpcRequestId = 1;

function getHistoryPublicRpcProviderCooldownKey(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

function isHistoryPublicRpcProviderCoolingDown(url) {
  const until = historyPublicRpcProviderCooldownUntil.get(getHistoryPublicRpcProviderCooldownKey(url)) || 0;
  return until > Date.now();
}

function markHistoryPublicRpcProviderCooldown(url, durationMs = 60_000) {
  historyPublicRpcProviderCooldownUntil.set(
    getHistoryPublicRpcProviderCooldownKey(url),
    Date.now() + durationMs,
  );
}

function getConfiguredHistoryPublicRpcUrls(networkId) {
  const envKeysByNetwork = {
    'bnb-chain': ['HISTORY_RPC_BNB_CHAIN_URLS', 'BSC_RPC_URLS', 'BSC_RPC_URL'],
    base: ['HISTORY_RPC_BASE_URLS', 'BASE_RPC_URLS', 'BASE_RPC_URL'],
    arbitrum: ['HISTORY_RPC_ARBITRUM_URLS', 'ARBITRUM_RPC_URLS', 'ARBITRUM_RPC_URL'],
  };
  const envKeys = envKeysByNetwork[networkId] || [];
  const envValue = envKeys
    .map((key) => cleanEnvValue(process.env[key], key))
    .find((value) => Boolean(value)) || '';
  const configuredUrls = envValue
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  const alchemyNetwork = HISTORY_ALCHEMY_NETWORK_BY_RECEIVE_NETWORK[networkId];
  const alchemyApiKey = cleanEnvValue(config.alchemyApiKey, 'ALCHEMY_API_KEY');
  const alchemyRpcUrl =
    alchemyNetwork && alchemyApiKey && !['demo', 'docs-demo', 'YOUR_API_KEY', 'your_alchemy_api_key_here'].includes(alchemyApiKey)
      ? `https://${alchemyNetwork}.g.alchemy.com/v2/${alchemyApiKey}`
      : '';

  return Array.from(
    new Set(
      [alchemyRpcUrl, ...configuredUrls, ...(HISTORY_PUBLIC_RPC_DEFAULT_URLS_BY_NETWORK[networkId] || [])].filter(Boolean),
    ),
  );
}

function getHistoryPublicRpcLookbackBlocks(networkId) {
  const envKeyByNetwork = {
    'bnb-chain': 'HISTORY_RPC_BNB_CHAIN_LOOKBACK_BLOCKS',
    base: 'HISTORY_RPC_BASE_LOOKBACK_BLOCKS',
    arbitrum: 'HISTORY_RPC_ARBITRUM_LOOKBACK_BLOCKS',
  };
  const rawValue = process.env[envKeyByNetwork[networkId] || ''] || process.env.HISTORY_RPC_LOOKBACK_BLOCKS;
  const parsedValue = Number(cleanEnvValue(rawValue, 'HISTORY_RPC_LOOKBACK_BLOCKS'));

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? Math.floor(parsedValue)
    : HISTORY_PUBLIC_RPC_DEFAULT_LOOKBACK_BLOCKS_BY_NETWORK[networkId] || 80000;
}

function toRpcQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function parseRpcQuantity(value, fallback = 0) {
  try {
    return Number(BigInt(value || '0x0'));
  } catch {
    return fallback;
  }
}

function padHistoryAddressTopic(address) {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

function topicToHistoryAddress(topic) {
  const normalizedTopic = String(topic || '').toLowerCase().replace(/^0x/, '');
  return normalizedTopic.length >= 40 ? `0x${normalizedTopic.slice(-40)}` : HISTORY_PUBLIC_RPC_ZERO_ADDRESS;
}

function getHistoryRpcLogKey(log) {
  return `${String(log?.transactionHash || '').toLowerCase()}:${String(log?.logIndex || '').toLowerCase()}`;
}

async function requestHistoryPublicRpc(networkId, method, params) {
  const urls = getConfiguredHistoryPublicRpcUrls(networkId)
    .filter((url) => !isHistoryPublicRpcProviderCoolingDown(url))
    .slice(0, HISTORY_PUBLIC_RPC_MAX_URL_ATTEMPTS);
  let firstError;

  if (!urls.length) {
    throw new Error('No available public RPC providers for transaction history.');
  }

  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HISTORY_PUBLIC_RPC_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: historyPublicRpcRequestId += 1,
          method,
          params,
        }),
        signal: controller.signal,
      });
      const payload = await readResponseJson(response);
      const rpcMessage = payload?.error?.message || (!response.ok ? `RPC ${method} failed with ${response.status}` : '');

      if (!response.ok || payload?.error) {
        if (
          response.status === 429 ||
          isHistoryPublicRpcRateLimitError(rpcMessage) ||
          /archive requests require/i.test(rpcMessage)
        ) {
          markHistoryPublicRpcProviderCooldown(url, /alchemy\.com/i.test(url) ? 120_000 : 45_000);
        }
        throw new Error(rpcMessage || `RPC ${method} failed with ${response.status}`);
      }

      return payload?.result;
    } catch (error) {
      firstError = firstError || error;
      if (isHistoryPublicRpcRateLimitError(error)) {
        markHistoryPublicRpcProviderCooldown(url, /alchemy\.com/i.test(url) ? 120_000 : 45_000);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  console.warn('Public RPC history request failed', {
    networkId,
    method,
    message: firstError instanceof Error ? firstError.message : String(firstError),
  });
  const underlyingMessage = firstError instanceof Error ? firstError.message : String(firstError || 'RPC request failed');
  throw new Error(underlyingMessage || 'Transaction history is temporarily unavailable.');
}

async function getHistoryPublicRpcLatestBlock(networkId) {
  return parseRpcQuantity(await requestHistoryPublicRpc(networkId, 'eth_blockNumber', []));
}

async function getHistoryPublicRpcBlockTimestamp(networkId, blockNumberHex) {
  const cacheKey = `${networkId}:${String(blockNumberHex).toLowerCase()}`;

  if (historyPublicRpcBlockCache.has(cacheKey)) {
    return historyPublicRpcBlockCache.get(cacheKey);
  }

  try {
    const block = await requestHistoryPublicRpc(networkId, 'eth_getBlockByNumber', [blockNumberHex, false]);
    const timestampMs = parseRpcQuantity(block?.timestamp, Math.floor(Date.now() / 1000)) * 1000;
    const isoTimestamp = new Date(timestampMs).toISOString();
    historyPublicRpcBlockCache.set(cacheKey, isoTimestamp);
    return isoTimestamp;
  } catch {
    return new Date().toISOString();
  }
}

function decodeRpcAbiString(value) {
  const hex = String(value || '').replace(/^0x/, '');
  if (!hex || /^0+$/.test(hex)) return '';

  try {
    if (hex.length >= 128) {
      const length = Number(BigInt(`0x${hex.slice(64, 128)}`));
      const data = hex.slice(128, 128 + length * 2);
      return Buffer.from(data, 'hex').toString('utf8').replace(/\0/g, '').trim();
    }

    return Buffer.from(hex.slice(0, 64), 'hex').toString('utf8').replace(/\0/g, '').trim();
  } catch {
    return '';
  }
}

function decodeRpcUint(value, fallback = 18) {
  try {
    return Number(BigInt(value || '0x0'));
  } catch {
    return fallback;
  }
}

async function getHistoryPublicRpcTokenMetadata(networkId, tokenAddress) {
  const normalizedTokenAddress = String(tokenAddress || '').toLowerCase();
  const cacheKey = `${networkId}:${normalizedTokenAddress}`;

  if (historyPublicRpcMetadataCache.has(cacheKey)) {
    return historyPublicRpcMetadataCache.get(cacheKey);
  }

  const call = async (data) => requestHistoryPublicRpc(networkId, 'eth_call', [{ to: normalizedTokenAddress, data }, 'latest']);
  const metadata = { symbol: 'TOKEN', name: 'Token', decimals: 18 };

  try {
    metadata.symbol = decodeRpcAbiString(await call('0x95d89b41')) || metadata.symbol;
  } catch {}

  try {
    metadata.name = decodeRpcAbiString(await call('0x06fdde03')) || metadata.symbol;
  } catch {}

  try {
    metadata.decimals = decodeRpcUint(await call('0x313ce567'), 18);
  } catch {}

  historyPublicRpcMetadataCache.set(cacheKey, metadata);
  return metadata;
}

function getHistoryPublicRpcBlockChunkSize(networkId) {
  return HISTORY_PUBLIC_RPC_BLOCK_CHUNK_SIZE_BY_NETWORK[networkId] || HISTORY_PUBLIC_RPC_BLOCK_CHUNK_SIZE;
}

function isHistoryPublicRpcLogRangeError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('limit exceeded') ||
    message.includes('query returned more than') ||
    message.includes('response size exceeded') ||
    message.includes('block range is too large') ||
    message.includes('exceed maximum block range') ||
    message.includes('exceeded maximum block range') ||
    message.includes('log response size exceeded') ||
    message.includes('archive requests require') ||
    message.includes('timeout') ||
    message.includes('too many results')
  );
}

function isHistoryPublicRpcRateLimitError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('over rate limit') || message.includes('rate limit') || message.includes('429');
}

async function requestHistoryPublicRpcLogsWithSplit(networkId, filter, depth = 0) {
  try {
    const logs = await requestHistoryPublicRpc(networkId, 'eth_getLogs', [filter]);
    return Array.isArray(logs) ? logs : [];
  } catch (error) {
    const fromBlock = parseRpcQuantity(filter.fromBlock);
    const toBlock = parseRpcQuantity(filter.toBlock);
    const span = toBlock - fromBlock;

    // Rate limits get worse if we split/retry aggressively — soft-skip the chunk.
    if (isHistoryPublicRpcRateLimitError(error)) {
      if (depth < 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return requestHistoryPublicRpcLogsWithSplit(networkId, filter, depth + 1);
      }

      const rateLimitError = new Error(error instanceof Error ? error.message : String(error));
      rateLimitError.name = 'HistoryPublicRpcRateLimitError';
      throw rateLimitError;
    }

    if (!isHistoryPublicRpcLogRangeError(error) || span <= 0 || depth >= 8) {
      throw error;
    }

    if (span <= HISTORY_PUBLIC_RPC_MIN_BLOCK_CHUNK_SIZE) {
      console.warn('Public RPC log chunk skipped after min range', {
        networkId,
        fromBlock: filter.fromBlock,
        toBlock: filter.toBlock,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const mid = fromBlock + Math.floor(span / 2);
    const left = await requestHistoryPublicRpcLogsWithSplit(
      networkId,
      { ...filter, fromBlock: toRpcQuantity(fromBlock), toBlock: toRpcQuantity(mid) },
      depth + 1,
    );
    const right = await requestHistoryPublicRpcLogsWithSplit(
      networkId,
      { ...filter, fromBlock: toRpcQuantity(mid + 1), toBlock: toRpcQuantity(toBlock) },
      depth + 1,
    );
    return [...left, ...right];
  }
}

async function getHistoryPublicRpcTransferLogs(request) {
  const latestBlock = await getHistoryPublicRpcLatestBlock(request.networkId);
  const lookbackBlocks = getHistoryPublicRpcLookbackBlocks(request.networkId);
  const chunkSize = getHistoryPublicRpcBlockChunkSize(request.networkId);
  const fromBlock = Math.max(0, latestBlock - lookbackBlocks);
  const walletTopic = padHistoryAddressTopic(request.walletAddress);
  const logsByKey = new Map();
  let successfulLogRequests = 0;
  let failedLogRequests = 0;
  let consecutiveRateLimits = 0;
  const scanStartedAt = Date.now();

  for (let chunkEnd = latestBlock; chunkEnd >= fromBlock; chunkEnd -= chunkSize) {
    if (Date.now() - scanStartedAt > HISTORY_PUBLIC_RPC_SCAN_BUDGET_MS) {
      break;
    }

    if (consecutiveRateLimits >= 2) {
      console.warn('Public RPC history scan aborted after repeated rate limits', {
        networkId: request.networkId,
        collectedLogs: logsByKey.size,
      });
      break;
    }

    const chunkStart = Math.max(fromBlock, chunkEnd - chunkSize + 1);
    const fromBlockHex = toRpcQuantity(chunkStart);
    const toBlockHex = toRpcQuantity(chunkEnd);
    const filters = [
      { fromBlock: fromBlockHex, toBlock: toBlockHex, topics: [HISTORY_PUBLIC_RPC_TRANSFER_TOPIC, walletTopic] },
      { fromBlock: fromBlockHex, toBlock: toBlockHex, topics: [HISTORY_PUBLIC_RPC_TRANSFER_TOPIC, null, walletTopic] },
    ];

    // Sequential filters reduce free-RPC rate-limit pressure vs Promise.all.
    for (let index = 0; index < filters.length; index += 1) {
      try {
        const logs = await requestHistoryPublicRpcLogsWithSplit(request.networkId, filters[index]);
        successfulLogRequests += 1;
        consecutiveRateLimits = 0;
        logs.forEach((log) => {
          const key = getHistoryRpcLogKey(log);
          if (key && !logsByKey.has(key)) logsByKey.set(key, log);
        });
      } catch (error) {
        failedLogRequests += 1;
        if (error?.name === 'HistoryPublicRpcRateLimitError' || isHistoryPublicRpcRateLimitError(error)) {
          consecutiveRateLimits += 1;
        }
        console.warn('Public RPC log chunk failed', {
          networkId: request.networkId,
          fromBlock: fromBlockHex,
          toBlock: toBlockHex,
          filterIndex: index,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (logsByKey.size >= HISTORY_PUBLIC_RPC_MAX_LOGS) {
      break;
    }
  }

  if (successfulLogRequests === 0 && logsByKey.size === 0) {
    // Prefer empty history over a hard 502 when public RPCs are rate-limited so
    // explorer / Alchemy sources can still fulfill the client request.
    if (failedLogRequests > 0) {
      console.warn('Public RPC history returned no logs after provider failures', {
        networkId: request.networkId,
        walletAddress: request.walletAddress,
        failedLogRequests,
      });
      return [];
    }
    throw new HttpError(502, 'history_provider_failed', 'Transaction history is temporarily unavailable.');
  }

  return [...logsByKey.values()]
    .sort((firstLog, secondLog) => {
      const blockDiff = parseRpcQuantity(secondLog?.blockNumber) - parseRpcQuantity(firstLog?.blockNumber);
      return blockDiff || parseRpcQuantity(secondLog?.logIndex) - parseRpcQuantity(firstLog?.logIndex);
    })
    .slice(0, HISTORY_PUBLIC_RPC_MAX_LOGS);
}

async function getPublicRpcHistoryTransfers(request) {
  const networkId = normalizeHistoryNetworkId(request.networkId);
  if (!HISTORY_PUBLIC_RPC_NETWORKS.has(networkId)) {
    throw new HttpError(400, 'invalid_history_params', 'Public RPC transaction history is not supported for this network yet.');
  }

  const cacheKey = `${networkId}:${request.walletAddress.toLowerCase()}`;
  const cached = historyPublicRpcTransferCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp <= HISTORY_PUBLIC_RPC_SUCCESS_CACHE_TTL_MS) {
    return cached.transfers;
  }

  const logs = await getHistoryPublicRpcTransferLogs({ ...request, networkId });
  const enrichmentStartedAt = Date.now();
  const transfers = [];

  for (const log of logs) {
    if (Date.now() - enrichmentStartedAt > HISTORY_PUBLIC_RPC_SCAN_BUDGET_MS) {
      break;
    }

    const tokenAddress = String(log?.address || '').toLowerCase();
    let metadata = { symbol: 'TOKEN', decimals: 18 };
    let blockTimestamp = new Date().toISOString();

    try {
      metadata = await getHistoryPublicRpcTokenMetadata(networkId, tokenAddress);
    } catch {
      // Keep placeholder metadata so history still returns.
    }

    try {
      blockTimestamp = await getHistoryPublicRpcBlockTimestamp(networkId, log?.blockNumber);
    } catch {
      // Keep current timestamp fallback.
    }

    transfers.push({
      blockNum: log?.blockNumber,
      uniqueId: getHistoryRpcLogKey(log),
      hash: log?.transactionHash,
      from: topicToHistoryAddress(log?.topics?.[1]),
      to: topicToHistoryAddress(log?.topics?.[2]),
      asset: metadata.symbol,
      category: 'erc20',
      rawContract: {
        address: tokenAddress,
        decimal: String(metadata.decimals),
        value: log?.data || '0x0',
      },
      metadata: {
        blockTimestamp,
      },
    });
  }

  historyPublicRpcTransferCache.set(cacheKey, { transfers, timestamp: Date.now() });
  return transfers;
}

function normalizeHistoryExplorerNetworkId(value) {
  const networkId = normalizeHistoryNetworkId(value);
  if (!HISTORY_EXPLORER_NETWORKS.has(networkId)) {
    throw new HttpError(400, 'invalid_history_params', 'Explorer transaction history is not supported for this network yet.');
  }
  return networkId;
}

function buildHistoryQueryString(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

function getBscScanHistoryApiKey() {
  const apiKey = cleanEnvValue(config.bscScanApiKey, 'BSCSCAN_API_KEY');
  if (!apiKey || ['demo', 'docs-demo', 'YOUR_API_KEY', 'your_bscscan_api_key_here'].includes(apiKey)) {
    return '';
  }
  return apiKey;
}

function getEtherscanHistoryApiKey() {
  const apiKey = cleanEnvValue(
    config.etherscanApiKey || config.bscScanApiKey,
    'ETHERSCAN_API_KEY',
  );
  if (!apiKey || ['demo', 'docs-demo', 'YOUR_API_KEY', 'your_etherscan_api_key_here', 'your_etherscan_v2_api_key_here', 'your_bscscan_api_key_here'].includes(apiKey)) {
    return '';
  }
  return apiKey;
}

function getExplorerHistoryApiUrl(action, walletAddress, networkId) {
  // BscScan/Etherscan V1 account endpoints are deprecated; use unified Etherscan V2.
  const apiKey = getEtherscanHistoryApiKey();

  if (!apiKey) {
    throw new HttpError(503, 'history_provider_unconfigured', 'Explorer history API key is not configured.');
  }

  const chainId = HISTORY_ETHERSCAN_V2_CHAIN_ID_BY_NETWORK[networkId];
  if (!chainId) {
    throw new HttpError(500, 'history_provider_failed', 'Unsupported history network.');
  }

  const url = new URL(HISTORY_ETHERSCAN_V2_API_URL);
  url.searchParams.set('chainid', String(chainId));
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', action);
  url.searchParams.set('address', walletAddress);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '99999999');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', HISTORY_EXPLORER_PAGE_SIZE);
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('apikey', apiKey);

  return url.toString();
}

async function requestExplorerHistoryList(action, walletAddress, networkId) {
  const response = await fetch(getExplorerHistoryApiUrl(action, walletAddress, networkId), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const payload = await readResponseJson(response);

  if (!response.ok) {
    throw new HttpError(response.status || 502, 'history_provider_failed', 'Transaction history is temporarily unavailable.');
  }

  if (Array.isArray(payload?.result)) {
    return payload.result;
  }

  const providerMessage = `${payload?.message || ''} ${payload?.result || ''}`.toLowerCase();
  if (providerMessage.includes('no transactions')) {
    return [];
  }

  if (providerMessage.includes('free api access is not supported for this chain') ||
      providerMessage.includes('deprecated v1 endpoint')) {
    throw new HttpError(502, 'history_provider_failed', 'Transaction history is temporarily unavailable.');
  }

  throw new HttpError(502, 'history_provider_failed', 'Transaction history is temporarily unavailable.');
}

async function getExplorerHistoryTransactions(request) {
  const networkId = normalizeHistoryExplorerNetworkId(request.networkId);
  const [tokenTransferResult, nativeTransactionResult] = await Promise.allSettled([
    requestExplorerHistoryList('tokentx', request.walletAddress, networkId),
    requestExplorerHistoryList('txlist', request.walletAddress, networkId),
  ]);

  return {
    tokenTransfers: tokenTransferResult.status === 'fulfilled' ? tokenTransferResult.value : [],
    nativeTransactions: nativeTransactionResult.status === 'fulfilled' ? nativeTransactionResult.value : [],
  };
}

function getHistoryRouteSegments(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const historyIndex = segments[0] === 'api' ? 1 : 0;

  if (segments[historyIndex] !== 'history') return [];
  const pathSegments = segments.slice(historyIndex + 1).map((segment) => decodeURIComponent(segment));
  return pathSegments.length > 0 ? pathSegments : getVercelCatchAllSegments(url);
}

async function handleHistoryProxy(req, res, url) {
  assertCors(req);
  const segments = getHistoryRouteSegments(url);

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'health') {
    sendJson(req, res, 200, {
      status: 'ok',
      service: 'doxa-history-proxy',
      provider: 'alchemy',
      configured: Boolean(cleanEnvValue(config.alchemyApiKey, 'ALCHEMY_API_KEY')),
      providers: {
        alchemy: Boolean(cleanEnvValue(config.alchemyApiKey, 'ALCHEMY_API_KEY')),
        bscscan: Boolean(getBscScanHistoryApiKey() || getEtherscanHistoryApiKey()),
        etherscan: Boolean(getEtherscanHistoryApiKey()),
      },
    });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'alchemy-transfers') {
    const request = {
      walletAddress: requireHistoryWalletAddress(url.searchParams.get('walletAddress')),
      networkId: normalizeHistoryNetworkId(url.searchParams.get('networkId')),
      direction: normalizeHistoryDirection(url.searchParams.get('direction')),
    };
    try {
      const transfers = await getAlchemyHistoryTransfers(request);
      sendJson(req, res, 200, { data: { transfers, provider: 'alchemy', refreshedAt: Date.now() } });
    } catch (error) {
      console.warn('Alchemy history transfers failed', {
        networkId: request.networkId,
        walletAddress: request.walletAddress,
        message: error instanceof Error ? error.message : String(error),
      });
      sendJson(req, res, 200, { data: { transfers: [], provider: 'alchemy', refreshedAt: Date.now() } });
    }
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'rpc-token-transfers') {
    const request = {
      walletAddress: requireHistoryWalletAddress(url.searchParams.get('walletAddress')),
      networkId: normalizeHistoryNetworkId(url.searchParams.get('networkId')),
    };
    const transfers = await getPublicRpcHistoryTransfers(request);
    sendJson(req, res, 200, { data: { transfers, provider: 'public-rpc', refreshedAt: Date.now() } });
    return;
  }
  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'explorer-transactions') {
    const request = {
      walletAddress: requireHistoryWalletAddress(url.searchParams.get('walletAddress')),
      networkId: normalizeHistoryNetworkId(url.searchParams.get('networkId')),
    };

    if (!HISTORY_EXPLORER_NETWORKS.has(request.networkId)) {
      sendJson(req, res, 200, {
        data: {
          tokenTransfers: [],
          nativeTransactions: [],
          provider: 'disabled',
          refreshedAt: Date.now(),
        },
      });
      return;
    }

    try {
      const explorerTransactions = await getExplorerHistoryTransactions(request);
      sendJson(req, res, 200, { data: { ...explorerTransactions, provider: request.networkId === 'bnb-chain' ? 'bscscan' : 'etherscan', refreshedAt: Date.now() } });
    } catch (error) {
      sendJson(req, res, 200, {
        data: {
          tokenTransfers: [],
          nativeTransactions: [],
          provider: 'unavailable',
          refreshedAt: Date.now(),
        },
      });
    }
    return;
  }

  throw new HttpError(404, 'not_found', 'History route not found.');
}
function railsMessage(payload, fallback) {
  return payload?.message || payload?.error?.message || payload?.error || payload?.errorMessage || payload?.data?.message || fallback;
}

function requireRailsString(value, name, pattern) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'invalid_rails_params', `${name} is required.`);
  }

  const trimmed = value.trim();
  if (pattern && !pattern.test(trimmed)) {
    throw new HttpError(400, 'invalid_rails_params', `${name} is invalid.`);
  }

  return trimmed;
}

function normalizeRailsNetwork(value) {
  const network = requireRailsString(value, 'network', /^[a-z0-9-]+$/i).toLowerCase();

  if (!RAILS_EVM_NETWORKS.has(network)) {
    throw new HttpError(400, 'invalid_rails_params', `${network} is not supported for EVM off-ramp orders.`);
  }

  return network;
}

function normalizeRailsToken(value) {
  const token = requireRailsString(value, 'token', /^[A-Z0-9]{2,16}$/i).toUpperCase();

  if (!RAILS_STABLE_TOKENS.has(token)) {
    throw new HttpError(400, 'invalid_rails_params', `${token} is not supported for Rails off-ramp orders.`);
  }

  return token;
}

function normalizeRailsCurrency(value) {
  const currency = requireRailsString(value, 'currency', /^[A-Z]{2,8}$/i).toUpperCase();

  if (!RAILS_FIAT_CURRENCIES.has(currency)) {
    throw new HttpError(400, 'invalid_rails_params', `${currency} is not supported for Xchange fiat payouts yet.`);
  }

  return currency;
}

function normalizeRailsAmount(value, name = 'amount') {
  const amount = typeof value === 'number' ? String(value) : requireRailsString(value, name);
  const numeric = Number(amount);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new HttpError(400, 'invalid_rails_params', `${name} must be greater than 0.`);
  }

  return amount;
}

function normalizeEvmAddress(value, name) {
  return requireRailsString(value, name, /^0x[a-fA-F0-9]{40}$/);
}

function sanitizeRailsRecipient(recipient) {
  if (!recipient || typeof recipient !== 'object' || Array.isArray(recipient)) {
    throw new HttpError(400, 'invalid_rails_params', 'recipient is required.');
  }

  return {
    currency: normalizeRailsCurrency(recipient.currency),
    institution: requireRailsString(recipient.institution, 'recipient.institution'),
    accountIdentifier: requireRailsString(recipient.accountIdentifier, 'recipient.accountIdentifier'),
    accountName: requireRailsString(recipient.accountName, 'recipient.accountName'),
    memo: requireRailsString(recipient.memo || 'Doxa Xchange payout', 'recipient.memo'),
    ...(typeof recipient.providerId === 'string' && recipient.providerId.trim()
      ? { providerId: recipient.providerId.trim() }
      : {}),
  };
}

function applyRailsFeeConfig(orderBody) {
  const body = { ...orderBody };
  delete body.feeMode;
  delete body.feePercent;
  delete body.feeAmount;
  delete body.feeAddress;

  if (!config.railsFeeMode && !config.railsFeePercent && !config.railsFeeAmount) {
    return body;
  }

  if (!config.railsFeeAddress) {
    throw new HttpError(500, 'rails_fee_not_configured', 'Set RAILS_FEE_ADDRESS when enabling Rails off-ramp fees.');
  }

  body.feeMode = config.railsFeeMode === 'fixed' ? 'fixed' : 'percent';
  body.feeAddress = normalizeEvmAddress(config.railsFeeAddress, 'RAILS_FEE_ADDRESS');

  if (body.feeMode === 'fixed') {
    body.feeAmount = normalizeRailsAmount(config.railsFeeAmount, 'RAILS_FEE_AMOUNT');
  } else {
    body.feePercent = normalizeRailsAmount(config.railsFeePercent || '0', 'RAILS_FEE_PERCENT');
  }

  return body;
}

function sanitizeRailsOrderBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_rails_params', 'Order payload is required.');
  }

  const orderBody = {
    network: normalizeRailsNetwork(body.network),
    token: normalizeRailsToken(body.token),
    amount: normalizeRailsAmount(body.amount),
    returnAddress: normalizeEvmAddress(body.returnAddress, 'returnAddress'),
    ...(typeof body.rateId === 'string' && body.rateId.trim() ? { rateId: body.rateId.trim() } : {}),
    ...(typeof body.rate === 'string' && body.rate.trim() ? { rate: body.rate.trim() } : {}),
  };

  if (typeof body.recipientId === 'string' && body.recipientId.trim()) {
    orderBody.recipientId = body.recipientId.trim();
  } else {
    orderBody.recipient = sanitizeRailsRecipient(body.recipient);
  }

  if (!orderBody.rateId && !orderBody.rate) {
    throw new HttpError(400, 'invalid_rails_params', 'rateId or rate is required.');
  }

  return applyRailsFeeConfig(orderBody);
}

function sanitizeRailsVerifyAccountBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_rails_params', 'Account verification payload is required.');
  }

  return {
    institution: requireRailsString(body.institution, 'institution'),
    accountIdentifier: requireRailsString(body.accountIdentifier, 'accountIdentifier'),
    ...(body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? { metadata: body.metadata }
      : {}),
  };
}

function sanitizeRailsSubmittedBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_rails_params', 'Submission payload is required.');
  }

  return {
    orderId: requireRailsString(body.orderId, 'orderId', /^0x[a-fA-F0-9]{64}$/),
    txHash: requireRailsString(body.txHash, 'txHash', /^0x[a-fA-F0-9]{64}$/),
  };
}

async function requestRails(path, { method = 'GET', body, authenticated = false, logFailure = true } = {}) {
  if (authenticated) {
    assertRailsConfigured();
  }

  const headers = { Accept: 'application/json' };

  if (authenticated) {
    headers['API-Key'] = config.railsApiKey;
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${config.railsApiBaseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await readResponseJson(response);

  if (!response.ok) {
    const message = railsMessage(payload, 'No Rails error message returned.');
    if (logFailure) {
      console.warn('Rails API request failed', {
        path,
        status: response.status,
        message,
      });
    }

    if (authenticated && /Failed to fetch API key/i.test(message)) {
      throw new HttpError(
        502,
        'xchange_api_key_rejected',
        'The Xchange service is temporarily unavailable. Please try again later.',
      );
    }

    throw new HttpError(response.status, 'rails_request_failed', message);
  }

  return payload;
}

async function requestRailsRate({ network, token, amount, fiat }) {
  const encodedToken = encodeURIComponent(token);
  const encodedAmount = encodeURIComponent(amount);
  const encodedFiat = encodeURIComponent(fiat);
  const documentedPath = `/v1/rates/${encodedToken}/${encodedAmount}/${encodedFiat}`;
  const candidatePaths = [documentedPath];
  let lastError;

  for (const candidatePath of candidatePaths) {
    try {
      return await requestRails(candidatePath, { logFailure: false });
    } catch (error) {
      lastError = error;

      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        break;
      }
    }
  }

  if (lastError instanceof HttpError && lastError.status >= 500) {
    try {
      const currenciesPayload = await requestRails('/v1/currencies', { logFailure: false });
      const currencies = Array.isArray(currenciesPayload?.data)
        ? currenciesPayload.data
        : Array.isArray(currenciesPayload)
          ? currenciesPayload
          : [];
      const currency = currencies.find((item) => String(item?.code || '').toUpperCase() === fiat);
      const rawMarketRate = currency?.marketRate ?? currency?.ceiling_rate ?? currency?.ceilingRate;
      const marketRate = Number(rawMarketRate);

      if (Number.isFinite(marketRate) && marketRate > 0) {
        const fallbackRate = marketRate * 0.995;
        const rate = fallbackRate
          .toFixed(8)
          .replace(/\.?0+$/, '');

        console.warn('Rails rate endpoint unavailable; using currency market-rate fallback', {
          network,
          token,
          amount,
          fiat,
          rate,
        });

        return {
          status: 'success',
          message: 'Rate fetched from market-rate fallback',
          data: {
            rate,
            rateId: '',
            token,
            currency: fiat,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            fallback: true,
          },
        };
      }
    } catch (fallbackError) {
      console.warn('Rails market-rate fallback failed', {
        network,
        token,
        amount,
        fiat,
        message: fallbackError instanceof Error ? fallbackError.message : 'Unable to fetch currency market rate.',
      });
    }
  }

  const status = lastError instanceof HttpError && lastError.status < 500 ? lastError.status : 502;
  const message = network
    ? `Unable to fetch ${token}/${fiat} rate on ${network}.`
    : `Unable to fetch ${token}/${fiat} rate.`;

  console.warn('Rails API rate request failed', {
    network,
    token,
    amount,
    fiat,
    status: lastError instanceof HttpError ? lastError.status : 502,
    message: lastError instanceof Error ? lastError.message : 'Unable to complete Rails rate request.',
  });

  throw new HttpError(status, 'rails_rate_unavailable', message);
}

function paycrestMessage(payload, fallback) {
  const primary =
    payload?.message || payload?.error?.message || payload?.error || payload?.errorMessage || undefined;
  const detailMessage =
    (typeof payload?.data?.message === 'string' && payload.data.message.trim()) ||
    (typeof payload?.data?.error === 'string' && payload.data.error.trim()) ||
    undefined;
  const primaryText = typeof primary === 'string' ? primary.trim() : '';

  if (primaryText && detailMessage && !primaryText.includes(detailMessage)) {
    return `${primaryText}: ${detailMessage}`;
  }

  return primaryText || detailMessage || fallback;
}

function paycrestDetails(payload) {
  if (!payload || typeof payload !== 'object') return undefined;

  const details = payload.errors || payload.details || payload.data?.errors || payload.data?.details;
  if (details !== undefined) return details;

  const data = payload.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data).filter(([key]) => key !== 'status');
    if (entries.length > 0) return Object.fromEntries(entries);
  }

  return undefined;
}

function sanitizeXchangeServiceText(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  if (/api\s*-?key|access-token|authorization|credential|secret|unauthorized|forbidden/i.test(text)) {
    return '';
  }

  return text
    .replace(/paycrest/gi, 'Xchange service')
    .replace(/rails/gi, 'Xchange service')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeXchangeServiceDetails(details) {
  if (details === undefined) return undefined;

  const serialized = typeof details === 'string' ? details : JSON.stringify(details);
  if (/api\s*-?key|access-token|authorization|credential|secret|unauthorized|forbidden/i.test(serialized)) {
    return undefined;
  }

  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      const sanitized = sanitizeXchangeServiceText(value);
      return sanitized || undefined;
    }

    if (Array.isArray(value)) {
      const nextItems = value.map(sanitizeValue).filter((item) => item !== undefined);
      return nextItems.length > 0 ? nextItems : undefined;
    }

    if (value && typeof value === 'object') {
      const nextEntries = Object.entries(value)
        .map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)])
        .filter(([, nestedValue]) => nestedValue !== undefined);
      return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined;
    }

    return value;
  };

  return sanitizeValue(details);
}
function requirePaycrestString(value, name, pattern) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'invalid_paycrest_params', `${name} is required.`);
  }

  const trimmed = value.trim();
  if (pattern && !pattern.test(trimmed)) {
    throw new HttpError(400, 'invalid_paycrest_params', `${name} is invalid.`);
  }

  return trimmed;
}

function normalizePaycrestNetwork(value) {
  const network = requirePaycrestString(value, 'network', /^[a-z0-9-]+$/i).toLowerCase();

  if (!PAYCREST_EVM_NETWORKS.has(network)) {
    throw new HttpError(400, 'invalid_paycrest_params', `${network} is not supported for Paycrest orders.`);
  }

  return network;
}

function normalizePaycrestToken(value) {
  const token = requirePaycrestString(value, 'token', /^[A-Z0-9]{2,16}$/i).toUpperCase();

  if (!PAYCREST_STABLE_TOKENS.has(token)) {
    throw new HttpError(400, 'invalid_paycrest_params', `${token} is not supported for Paycrest orders.`);
  }

  return token;
}

function normalizePaycrestCurrency(value) {
  const currency = requirePaycrestString(value, 'currency', /^[A-Z]{2,8}$/i).toUpperCase();

  if (!PAYCREST_FIAT_CURRENCIES.has(currency)) {
    throw new HttpError(400, 'invalid_paycrest_params', `${currency} is not supported for Paycrest orders.`);
  }

  return currency;
}

function normalizePaycrestAmount(value, name = 'amount') {
  const amount = typeof value === 'number' ? String(value) : requirePaycrestString(value, name);
  const numeric = Number(amount);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new HttpError(400, 'invalid_paycrest_params', `${name} must be greater than 0.`);
  }

  return amount;
}

function normalizePaycrestEvmAddress(value, name) {
  return requirePaycrestString(value, name, /^0x[a-fA-F0-9]{40}$/);
}

function sanitizePaycrestMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  return metadata;
}

function sanitizePaycrestFiatAccount(account, name, { accountNameRequired = false, includeMemo = false } = {}) {
  if (!account || typeof account !== 'object' || Array.isArray(account)) {
    throw new HttpError(400, 'invalid_paycrest_params', `${name} is required.`);
  }

  const sanitized = {
    institution: requirePaycrestString(account.institution, `${name}.institution`),
    accountIdentifier: requirePaycrestString(account.accountIdentifier, `${name}.accountIdentifier`),
  };

  if (accountNameRequired || (typeof account.accountName === 'string' && account.accountName.trim())) {
    sanitized.accountName = requirePaycrestString(account.accountName, `${name}.accountName`);
  }

  if (includeMemo) {
    sanitized.memo = requirePaycrestString(account.memo || 'Doxa Xchange payout', `${name}.memo`);
  }

  const metadata = sanitizePaycrestMetadata(account.metadata);
  if (metadata) {
    sanitized.metadata = metadata;
  }

  return sanitized;
}

function sanitizePaycrestOrderBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_paycrest_params', 'Order payload is required.');
  }

  const source = body.source;
  const destination = body.destination;

  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new HttpError(400, 'invalid_paycrest_params', 'source is required.');
  }

  if (!destination || typeof destination !== 'object' || Array.isArray(destination)) {
    throw new HttpError(400, 'invalid_paycrest_params', 'destination is required.');
  }

  const sourceType = requirePaycrestString(source.type, 'source.type').toLowerCase();
  const destinationType = requirePaycrestString(destination.type, 'destination.type').toLowerCase();
  const isOnramp = sourceType === 'fiat' && destinationType === 'crypto';
  const isOfframp = sourceType === 'crypto' && destinationType === 'fiat';

  if (!isOnramp && !isOfframp) {
    throw new HttpError(400, 'invalid_paycrest_params', 'Paycrest orders must be fiat to crypto or crypto to fiat.');
  }

  const sanitized = {
    amount: normalizePaycrestAmount(body.amount),
  };

  const rawAmountIn = typeof body.amountIn === 'string' && body.amountIn.trim()
    ? body.amountIn.trim().toLowerCase()
    : '';

  if (rawAmountIn && rawAmountIn !== 'fiat' && rawAmountIn !== 'crypto') {
    throw new HttpError(400, 'invalid_paycrest_params', 'amountIn must be fiat or crypto.');
  }

  if (isOnramp) {
    sanitized.amountIn = 'fiat';
  } else if (rawAmountIn === 'fiat') {
    throw new HttpError(400, 'invalid_paycrest_params', 'Sell order amount must be a token amount.');
  }

  if (typeof body.senderFeePercent === 'string' && body.senderFeePercent.trim()) {
    sanitized.senderFeePercent = normalizePaycrestAmount(body.senderFeePercent, 'senderFeePercent');
  }

  if (typeof body.rate === 'string' && body.rate.trim()) {
    sanitized.rate = normalizePaycrestAmount(body.rate, 'rate');
  }

  if (typeof body.reference === 'string' && body.reference.trim()) {
    sanitized.reference = body.reference.trim().slice(0, 128);
  }

  const destinationProviderId =
    (typeof destination.providerId === 'string' && destination.providerId.trim()) ||
    (typeof destination.recipient?.providerId === 'string' && destination.recipient.providerId.trim()) ||
    '';

  if (isOnramp) {
    sanitized.source = {
      type: 'fiat',
      currency: normalizePaycrestCurrency(source.currency),
      refundAccount: sanitizePaycrestFiatAccount(source.refundAccount, 'source.refundAccount', { accountNameRequired: true }),
    };
    sanitized.destination = {
      type: 'crypto',
      currency: normalizePaycrestToken(destination.currency),
      recipient: {
        address: normalizePaycrestEvmAddress(destination.recipient?.address, 'destination.recipient.address'),
        network: normalizePaycrestNetwork(destination.recipient?.network),
      },
      ...(destinationProviderId ? { providerId: destinationProviderId } : {}),
    };
    return sanitized;
  }

  sanitized.source = {
    type: 'crypto',
    currency: normalizePaycrestToken(source.currency),
    network: normalizePaycrestNetwork(source.network),
    refundAddress: normalizePaycrestEvmAddress(source.refundAddress, 'source.refundAddress'),
  };
  sanitized.destination = {
    type: 'fiat',
    currency: normalizePaycrestCurrency(destination.currency),
    recipient: sanitizePaycrestFiatAccount(destination.recipient, 'destination.recipient', {
      accountNameRequired: true,
      includeMemo: true,
    }),
    ...(destinationProviderId ? { providerId: destinationProviderId } : {}),
  };

  return sanitized;
}

function sanitizePaycrestVerifyAccountBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_paycrest_params', 'Account verification payload is required.');
  }

  const metadata = sanitizePaycrestMetadata(body.metadata);
  return {
    institution: requirePaycrestString(body.institution, 'institution'),
    accountIdentifier: requirePaycrestString(body.accountIdentifier, 'accountIdentifier'),
    ...(metadata ? { metadata } : {}),
  };
}

function sanitizePaycrestRateQuery(segments, url) {
  const network = normalizePaycrestNetwork(segments[1]);
  const from = requirePaycrestString(segments[2], 'from', /^[A-Z0-9]{2,16}$/i).toUpperCase();
  const amount = normalizePaycrestAmount(segments[3]);
  const to = requirePaycrestString(segments[4], 'to', /^[A-Z0-9]{2,16}$/i).toUpperCase();
  const fromIsStableToken = PAYCREST_STABLE_TOKENS.has(from);
  const toIsStableToken = PAYCREST_STABLE_TOKENS.has(to);
  const fromIsFiat = PAYCREST_FIAT_CURRENCIES.has(from);
  const toIsFiat = PAYCREST_FIAT_CURRENCIES.has(to);

  if (!((fromIsStableToken && toIsFiat) || (fromIsFiat && toIsStableToken))) {
    throw new HttpError(400, 'invalid_paycrest_params', 'Unsupported rate pair.');
  }

  const query = new URLSearchParams();
  const side = url.searchParams.get('side');
  const providerId = url.searchParams.get('provider_id') || url.searchParams.get('providerId');

  if (side) {
    const normalizedSide = side.trim().toLowerCase();
    if (normalizedSide !== 'buy' && normalizedSide !== 'sell') {
      throw new HttpError(400, 'invalid_paycrest_params', 'side must be buy or sell.');
    }
    query.set('side', normalizedSide);
  }

  if (providerId) {
    if (!/^[a-zA-Z]{8}$/.test(providerId.trim())) {
      throw new HttpError(400, 'invalid_paycrest_params', 'provider_id must be exactly 8 letters.');
    }
    query.set('provider_id', providerId.trim());
  }

  const upstreamFrom = fromIsFiat ? to : from;
  const upstreamAmount = fromIsFiat ? '1' : amount;
  const upstreamTo = fromIsFiat ? from : to;

  return `/rates/${encodeURIComponent(network)}/${encodeURIComponent(upstreamFrom)}/${encodeURIComponent(upstreamAmount)}/${encodeURIComponent(upstreamTo)}${query.toString() ? `?${query.toString()}` : ''}`;
}

async function requestPaycrest(path, { method = 'GET', body, authenticated = true } = {}) {
  if (authenticated) {
    assertPaycrestConfigured();
  }

  const headers = { Accept: 'application/json' };

  if (authenticated) {
    headers['API-Key'] = config.paycrestApiKey;
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${config.paycrestApiBaseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await readResponseJson(response);

  if (!response.ok) {
    const providerMessage = paycrestMessage(payload, 'Unable to complete this Xchange request.');
    const isAuthFailure =
      response.status === 401 ||
      response.status === 403 ||
      /api\s*-?key|access-token|authorization|credential|secret|unauthorized|forbidden/i.test(providerMessage);

    const providerDetails = sanitizeXchangeServiceDetails(paycrestDetails(payload));

    console.warn('Paycrest API request failed', {
      path,
      status: response.status,
      message: providerMessage,
      ...(providerDetails !== undefined ? { details: providerDetails } : {}),
    });

    throw new HttpError(
      isAuthFailure ? 502 : response.status,
      isAuthFailure ? 'xchange_service_unavailable' : 'paycrest_request_failed',
      isAuthFailure
        ? 'The Xchange service is temporarily unavailable. Please try again later.'
        : sanitizeXchangeServiceText(providerMessage) || 'Unable to complete this Xchange request.',
      isAuthFailure ? undefined : providerDetails,
    );
  }

  return payload;
}

const SOGO_BILL_TYPES = new Set(['airtime', 'data', 'electricity']);
const SOGO_METER_TYPES = new Set(['prepaid', 'postpaid']);
const SOGO_PAYMENT_NETWORKS = new Set(['bnb-chain', 'ethereum', 'base', 'arbitrum']);
const SOGO_PAYMENT_NETWORK_LABELS = {
  'bnb-chain': 'BNB Chain',
  ethereum: 'Ethereum',
  base: 'Base',
  arbitrum: 'Arbitrum',
};
const SOGO_DEFAULT_STABLE_DECIMALS = 6;
const SOGO_BILLS_PAYMENT_ASSETS = new Set(['USDC', 'USDT']);
const SOGO_BILLS_PLATFORM_FEE_BPS = 200n;
const SOGO_BPS_DENOMINATOR = 10000n;
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const consumedSogoBillPaymentTxHashes = new Set();

function sogoMessage(payload, fallback) {
  return payload?.message || payload?.error?.message || payload?.error || payload?.errorMessage || payload?.data?.message || fallback;
}

function asSogoRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getSogoStatusField(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'boolean') return value ? 'success' : 'failed';
  }
  return '';
}

function normalizeSogoBillPaymentStatus(...values) {
  const statusKeys = ['status', 'transaction_status', 'transactionStatus', 'payment_status', 'paymentStatus', 'fulfillment_status', 'fulfillmentStatus', 'delivery_status', 'deliveryStatus', 'state', 'success'];
  const messageKeys = ['message', 'description', 'response_message', 'responseMessage', 'status_message', 'statusMessage'];
  const records = values.flatMap((value) => {
    const record = asSogoRecord(value);
    return [record, asSogoRecord(record.data), asSogoRecord(record.meta), asSogoRecord(record.bill), asSogoRecord(record.transaction), asSogoRecord(record.payment)];
  });

  for (const record of records) {
    const status = getSogoStatusField(record, statusKeys).toLowerCase().replace(/[_-]+/g, ' ').trim();
    if (!status) continue;
    if (/failed|failure|declined|rejected|error|unsuccessful/.test(status)) return 'failed';
    if (/refunded|refund|reversed|reversal/.test(status)) return 'refunded';
    if (/cancelled|canceled/.test(status)) return 'cancelled';
    if (/completed|complete|success|successful|delivered|fulfilled|settled|paid|approved|done|submitted/.test(status)) return 'completed';
    if (/pending|processing|queued|in progress/.test(status)) return 'processing';
  }

  for (const record of records) {
    const message = getSogoStatusField(record, messageKeys).toLowerCase().replace(/[_-]+/g, ' ').trim();
    if (!message) continue;
    if (/failed|failure|declined|rejected|error|unsuccessful/.test(message)) return 'failed';
    if (/refunded|refund|reversed|reversal/.test(message)) return 'refunded';
    if (/cancelled|canceled/.test(message)) return 'cancelled';
    if (/completed|complete|success|successful|delivered|fulfilled|settled|paid|approved|done|submitted/.test(message)) return 'completed';
    if (/pending|processing|queued|in progress/.test(message)) return 'processing';
  }

  return 'completed';
}
function sanitizeBillsServiceText(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  if (/api\s*-?key|access-token|authorization|credential|secret|unauthorized|forbidden/i.test(text)) {
    return '';
  }

  return text
    .replace(/sogo/gi, 'Bills service')
    .replace(/partner api/gi, 'Bills service')
    .replace(/wallet balance/gi, 'provider balance')
    .replace(/\s+/g, ' ')
    .trim();
}

function requireSogoString(value, name, pattern) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'invalid_bills_params', `${name} is required.`);
  }

  const trimmed = value.trim();
  if (pattern && !pattern.test(trimmed)) {
    throw new HttpError(400, 'invalid_bills_params', `${name} is invalid.`);
  }

  return trimmed;
}

function normalizeSogoBillType(value) {
  const billType = requireSogoString(value, 'type', /^[a-z-]+$/i).toLowerCase();
  if (!SOGO_BILL_TYPES.has(billType)) {
    throw new HttpError(400, 'invalid_bills_params', 'Only airtime, data, and electricity bill payments are supported.');
  }
  return billType;
}

function normalizeSogoPaymentNetwork(value) {
  const network = requireSogoString(value, 'payment.network', /^[a-z0-9-]+$/i).toLowerCase();
  if (!SOGO_PAYMENT_NETWORKS.has(network)) {
    throw new HttpError(400, 'invalid_bills_params', 'This stablecoin payment network is not supported for Bills yet.');
  }
  return network;
}

function normalizeSogoAmount(value, name = 'amount') {
  const amount = typeof value === 'number' ? String(value) : requireSogoString(value, name);
  const numeric = Number(String(amount).replace(/,/g, ''));

  if (!Number.isFinite(numeric) || numeric < 50) {
    throw new HttpError(400, 'invalid_bills_params', `${name} must be at least NGN 50.`);
  }

  return Math.round(numeric);
}

function normalizeSogoPaymentAsset(value, fallback = 'USDC') {
  const asset = String(value || fallback).trim().toUpperCase();
  if (!SOGO_BILLS_PAYMENT_ASSETS.has(asset)) {
    throw new HttpError(400, 'invalid_bills_params', 'Bills payments currently support USDC and USDT only.');
  }
  return asset;
}

function getConfiguredSogoTokenAddress(network, asset) {
  const tokenAsset = normalizeSogoPaymentAsset(asset);
  const addresses = tokenAsset === 'USDT' ? config.sogoBillsUsdtAddresses : config.sogoBillsUsdcAddresses;
  const address = addresses[network];
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new HttpError(500, 'sogo_bills_token_not_configured', `${tokenAsset} is not configured for ${network}.`);
  }
  return address.toLowerCase();
}

function getConfiguredSogoTokenDecimals(network, asset) {
  const tokenAsset = normalizeSogoPaymentAsset(asset);
  const decimalsByNetwork = tokenAsset === 'USDT' ? config.sogoBillsUsdtDecimals : config.sogoBillsUsdcDecimals;
  const decimals = decimalsByNetwork[network];
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new HttpError(500, 'sogo_bills_token_not_configured', `${tokenAsset} decimals are not configured for ${network}.`);
  }
  return decimals;
}

function getSogoQuoteTokenAmount(quote) {
  return quote.tokenAmount || quote.usdcAmount;
}

function getSogoQuoteTokenAmountRaw(quote) {
  return quote.tokenAmountRaw || quote.usdcAmountRaw;
}

function getConfiguredSogoBillsTreasuryAddress() {
  assertSogoBillsCollectionConfigured();
  return config.sogoBillsTreasuryAddress.toLowerCase();
}

function normalizeSogoTreasuryAddress(value, fieldName = 'quote.treasuryAddress') {
  return requireSogoString(value, fieldName, /^0x[a-fA-F0-9]{40}$/).toLowerCase();
}

function decimalStringToRawUnits(value, decimals, fieldName = 'quote.tokenAmount') {
  const amount = requireSogoString(value, fieldName).replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(amount)) {
    throw new HttpError(400, 'invalid_bills_quote', 'The Bills stablecoin amount is invalid.');
  }

  const [wholePart, fractionalPart = ''] = amount.split('.');
  if (fractionalPart.length > decimals) {
    throw new HttpError(400, 'invalid_bills_quote', 'The Bills stablecoin amount precision is not supported on this network. Refresh and try again.');
  }

  const scale = 10n ** BigInt(decimals);
  const whole = BigInt(wholePart || '0') * scale;
  const fractional = fractionalPart ? BigInt(fractionalPart.padEnd(decimals, '0')) : 0n;
  return whole + fractional;
}

function ceilDivide(value, divisor) {
  return (value + divisor - 1n) / divisor;
}

function getSogoBillsPaymentBreakdown(quote, decimals) {
  const billRawAmount = decimalStringToRawUnits(getSogoQuoteTokenAmount(quote), decimals);
  const platformFeeRawAmount = ceilDivide(billRawAmount * SOGO_BILLS_PLATFORM_FEE_BPS, SOGO_BPS_DENOMINATOR);
  const totalRawAmount = billRawAmount + platformFeeRawAmount;

  return { billRawAmount, platformFeeRawAmount, totalRawAmount };
}

async function requestSogo(path, { method = 'GET', body, idempotencyKey } = {}) {
  assertSogoConfigured();

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${config.sogoApiKey}`,
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const response = await fetch(`${config.sogoApiBaseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await readResponseJson(response);

  if (!response.ok) {
    const providerMessage = sogoMessage(payload, 'Unable to complete this Bills request.');
    const isAuthFailure =
      response.status === 401 ||
      response.status === 403 ||
      /api\s*-?key|access-token|authorization|credential|secret|unauthorized|forbidden/i.test(providerMessage);

    console.warn('Sogo API request failed', {
      path,
      status: response.status,
      message: providerMessage,
    });

    throw new HttpError(
      isAuthFailure ? 502 : response.status,
      isAuthFailure ? 'bills_service_unavailable' : 'sogo_request_failed',
      isAuthFailure
        ? 'The Bills service is temporarily unavailable. Please try again later.'
        : sanitizeBillsServiceText(providerMessage) || 'Unable to complete this Bills request.',
    );
  }

  return payload;
}

function getSogoNumericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
  if (typeof value === 'string') {
    const numeric = Number(value.replace(/,/g, ''));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['raw', 'value', 'amount', 'rate', 'formatted']) {
      const numeric = getSogoNumericValue(value[key]);
      if (numeric > 0) return numeric;
    }
  }
  return 0;
}

function getConfiguredSogoBillsRate(asset = 'USDC') {
  const tokenAsset = normalizeSogoPaymentAsset(asset);
  const rate = tokenAsset === 'USDT' ? config.sogoBillsUsdtNgnRate : config.sogoBillsUsdcNgnRate;
  const numeric = getSogoNumericValue(rate);
  return numeric > 0 ? numeric : 0;
}

function getSogoRateValue(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const candidates = [
    data?.user_receives_ngn,
    data?.estimated_ngn,
    data?.net_amount,
    data?.rate,
    data?.usd_ngn_rate,
    data?.usdc_ngn_rate,
    data?.ngn_per_usdc,
    data?.exchange_rate,
    data?.buy_rate,
    data?.sell_rate,
  ];

  for (const candidate of candidates) {
    const numeric = getSogoNumericValue(candidate);
    if (numeric > 0) return numeric;
  }

  return 0;
}

function decimalRawToString(raw, decimals) {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fractional = value % scale;

  if (fractional === 0n) return whole.toString();

  return `${whole}.${fractional.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

function formatNgnAmount(amount) {
  return Number(amount).toFixed(2).replace(/\.00$/, '');
}

function getSogoQuoteSigningSecret() {
  return config.sogoBillsQuoteSecret || config.sogoApiKey;
}

function getSignedQuotePayload(quote, { includeTreasury = true } = {}) {
  const asset = normalizeSogoPaymentAsset(quote.asset);
  const tokenAmount = getSogoQuoteTokenAmount(quote);
  const tokenAmountRaw = getSogoQuoteTokenAmountRaw(quote);
  const payload = {
    id: quote.id,
    asset,
    fiat: quote.fiat,
    fiatAmount: quote.fiatAmount,
    rate: quote.rate,
    tokenAmount,
    tokenAmountRaw,
    usdcAmount: tokenAmount,
    usdcAmountRaw: tokenAmountRaw,
    decimals: quote.decimals,
    issuedAt: quote.issuedAt,
    expiresAt: quote.expiresAt,
  };

  if (includeTreasury) {
    payload.treasuryAddress = normalizeSogoTreasuryAddress(quote.treasuryAddress || config.sogoBillsTreasuryAddress);
  }

  return payload;
}

function signSogoBillsQuote(quote, options) {
  return createHmac('sha256', getSogoQuoteSigningSecret())
    .update(JSON.stringify(getSignedQuotePayload(quote, options)))
    .digest('hex');
}

function verifySogoBillsQuote(quote) {
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) {
    throw new HttpError(400, 'invalid_bills_quote', 'A Bills quote is required.');
  }

  const signature = requireSogoString(quote.signature, 'quote.signature', /^[a-f0-9]{64}$/i);
  const expected = signSogoBillsQuote(quote);
  const legacyExpected = quote.treasuryAddress ? '' : signSogoBillsQuote(quote, { includeTreasury: false });
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const legacyExpectedBuffer = legacyExpected ? Buffer.from(legacyExpected, 'hex') : Buffer.alloc(0);
  const matchesExpected = signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
  const matchesLegacy = legacyExpectedBuffer.length > 0 && signatureBuffer.length === legacyExpectedBuffer.length && timingSafeEqual(signatureBuffer, legacyExpectedBuffer);

  if (!matchesExpected && !matchesLegacy) {
    throw new HttpError(400, 'invalid_bills_quote', 'The Bills quote is no longer valid. Refresh and try again.');
  }

  const expiresAt = Date.parse(requireSogoString(quote.expiresAt, 'quote.expiresAt'));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(400, 'expired_bills_quote', 'The Bills quote has expired. Refresh and try again.');
  }

  const tokenAmountRaw = BigInt(requireSogoString(getSogoQuoteTokenAmountRaw(quote), 'quote.tokenAmountRaw', /^[0-9]+$/));
  if (tokenAmountRaw <= 0n) {
    throw new HttpError(400, 'invalid_bills_quote', 'The Bills quote amount is invalid.');
  }

  return {
    ...getSignedQuotePayload(quote),
    signature,
  };
}

async function buildSogoBillsQuote(amount, assetInput = 'USDC') {
  const fiatAmount = normalizeSogoAmount(amount);
  const treasuryAddress = getConfiguredSogoBillsTreasuryAddress();
  const asset = normalizeSogoPaymentAsset(assetInput);
  const assetSlug = asset.toLowerCase();
  let effectiveNgnPerToken = 0;

  try {
    const ratePayload = await requestSogo(`/crypto/assets/${assetSlug}/rate?amount=1`);
    effectiveNgnPerToken = getSogoRateValue(ratePayload);

    if (!effectiveNgnPerToken) {
      console.warn(`Sogo ${asset} rate response did not include a usable NGN rate`, { ratePayload });
    }
  } catch (error) {
    console.warn(`Sogo ${asset} rate request failed; checking configured Bills fallback rate`, {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (!effectiveNgnPerToken) {
    effectiveNgnPerToken = getConfiguredSogoBillsRate(asset);
  }

  if (!effectiveNgnPerToken) {
    throw new HttpError(502, 'bills_quote_unavailable', `Unable to fetch a ${asset} quote for this bill right now.`);
  }

  const rawAmount = BigInt(Math.ceil((fiatAmount / effectiveNgnPerToken) * 10 ** SOGO_DEFAULT_STABLE_DECIMALS));
  const tokenAmount = decimalRawToString(rawAmount, SOGO_DEFAULT_STABLE_DECIMALS);
  const quote = {
    id: randomUUID(),
    asset,
    fiat: 'NGN',
    fiatAmount: formatNgnAmount(fiatAmount),
    rate: String(effectiveNgnPerToken),
    tokenAmount,
    tokenAmountRaw: rawAmount.toString(),
    usdcAmount: tokenAmount,
    usdcAmountRaw: rawAmount.toString(),
    treasuryAddress,
    decimals: SOGO_DEFAULT_STABLE_DECIMALS,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
  };

  return {
    ...quote,
    signature: signSogoBillsQuote(quote),
  };
}

async function requestJsonRpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const payload = await readResponseJson(response);

  if (!response.ok || payload?.error) {
    throw new HttpError(502, 'bills_payment_verification_unavailable', 'Unable to verify the stablecoin payment on-chain right now.');
  }

  return payload.result;
}

function addressFromTopic(topic) {
  const value = String(topic || '').toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(value)) return '';
  return `0x${value.slice(-40)}`;
}

async function verifySogoBillsStablePayment({ payment, quote }) {
  assertSogoBillsCollectionConfigured();

  if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
    throw new HttpError(400, 'invalid_bills_payment', 'Stablecoin payment details are required.');
  }

  const quoteAsset = normalizeSogoPaymentAsset(quote.asset);
  const paymentAsset = normalizeSogoPaymentAsset(payment.asset || quoteAsset);
  if (paymentAsset !== quoteAsset) {
    throw new HttpError(400, 'invalid_bills_payment', 'The selected payment token does not match the Bills quote. Refresh and try again.');
  }

  const network = normalizeSogoPaymentNetwork(payment.network);
  const rpcUrl = config.sogoBillsRpcUrls[network];
  const txHash = requireSogoString(payment.txHash, 'payment.txHash', /^0x[a-fA-F0-9]{64}$/).toLowerCase();
  const walletAddress = requireSogoString(payment.walletAddress, 'payment.walletAddress', /^0x[a-fA-F0-9]{40}$/).toLowerCase();
  const tokenAddress = requireSogoString(payment.tokenAddress, 'payment.tokenAddress', /^0x[a-fA-F0-9]{40}$/).toLowerCase();
  const configuredTreasuryAddress = getConfiguredSogoBillsTreasuryAddress();
  const treasuryAddress = normalizeSogoTreasuryAddress(quote.treasuryAddress || configuredTreasuryAddress);
  const configuredTokenAddress = getConfiguredSogoTokenAddress(network, paymentAsset);

  if (treasuryAddress !== configuredTreasuryAddress) {
    throw new HttpError(400, 'invalid_bills_quote', 'The Bills collection address changed. Refresh the quote and try again.');
  }

  if (tokenAddress !== configuredTokenAddress) {
    throw new HttpError(400, 'invalid_bills_payment', `The selected ${paymentAsset} token is not supported for Bills on this network.`);
  }

  if (consumedSogoBillPaymentTxHashes.has(txHash)) {
    throw new HttpError(409, 'bills_payment_already_used', 'This stablecoin payment has already been used for a bill.');
  }

  const receipt = await requestJsonRpc(rpcUrl, 'eth_getTransactionReceipt', [txHash]);
  if (!receipt) {
    throw new HttpError(409, 'bills_payment_pending', 'The stablecoin payment is not confirmed yet. Wait a moment and try again.');
  }

  if (String(receipt.status).toLowerCase() !== '0x1') {
    throw new HttpError(400, 'bills_payment_failed', 'The stablecoin payment failed on-chain.');
  }

  const configuredDecimals = getConfiguredSogoTokenDecimals(network, paymentAsset);
  const { billRawAmount, platformFeeRawAmount, totalRawAmount } = getSogoBillsPaymentBreakdown(quote, configuredDecimals);
  if (payment.amount !== undefined) {
    const reportedRawAmount = decimalStringToRawUnits(String(payment.amount), configuredDecimals, 'payment.amount');
    if (reportedRawAmount < totalRawAmount) {
      throw new HttpError(400, 'bills_payment_not_found', `Doxa could not confirm the full ${paymentAsset} payment for this bill and platform fee.`);
    }
  }

  const relatedTransfers = (receipt.logs || [])
    .map((log) => {
      const topics = Array.isArray(log?.topics) ? log.topics : [];
      if (String(log?.address || '').toLowerCase() !== tokenAddress) return null;
      if (String(topics[0] || '').toLowerCase() !== ERC20_TRANSFER_TOPIC) return null;
      if (addressFromTopic(topics[1]) !== walletAddress) return null;

      let rawAmount = 0n;
      try {
        rawAmount = BigInt(log.data || '0x0');
      } catch {
        rawAmount = 0n;
      }

      return {
        to: addressFromTopic(topics[2]),
        amountRaw: rawAmount,
        amountText: decimalRawToString(rawAmount, configuredDecimals),
      };
    })
    .filter(Boolean);

  const matchingTransfer = relatedTransfers.find((transfer) => transfer.to === treasuryAddress && transfer.amountRaw >= totalRawAmount);

  if (!matchingTransfer) {
    console.warn('Bills payment transfer mismatch', {
      asset: paymentAsset,
      network,
      txHash,
      walletAddress,
      tokenAddress,
      expectedTreasuryAddress: treasuryAddress,
      requiredAmount: decimalRawToString(totalRawAmount, configuredDecimals),
      relatedTransfers: relatedTransfers.slice(0, 5).map((transfer) => ({
        to: transfer.to,
        amount: transfer.amountText,
      })),
    });
    throw new HttpError(400, 'bills_payment_not_found', `Doxa could not confirm the required ${paymentAsset} payment for this bill.`);
  }

  return {
    asset: paymentAsset,
    network,
    txHash,
    walletAddress,
    tokenAddress,
    treasuryAddress,
    amount: decimalRawToString(totalRawAmount, configuredDecimals),
    billAmount: decimalRawToString(billRawAmount, configuredDecimals),
    platformFeeAmount: decimalRawToString(platformFeeRawAmount, configuredDecimals),
    platformFeeRate: '2%',
  };
}

function sanitizeSogoBillPurchaseBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_bills_params', 'Bill payment payload is required.');
  }

  const type = normalizeSogoBillType(body.type);
  const amount = normalizeSogoAmount(body.amount);
  const quote = verifySogoBillsQuote(body.quote);
  const quotedNgnAmount = Math.round(Number(quote.fiatAmount));

  if (quotedNgnAmount !== amount) {
    throw new HttpError(400, 'invalid_bills_quote', 'The Bills quote does not match this payment amount. Refresh and try again.');
  }

  const base = {
    type,
    amount,
    quote,
    payment: body.payment,
    idempotencyKey: typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 128)
      : randomUUID(),
  };

  if (type === 'airtime') {
    return {
      ...base,
      upstreamPath: '/bills/airtime',
      upstreamBody: {
        network: requireSogoString(body.network, 'network', /^[a-z0-9-]+$/i).toLowerCase(),
        phone: requireSogoString(body.phone, 'phone', /^\+?[0-9\s-]{10,16}$/).replace(/[\s-]/g, ''),
        amount,
      },
    };
  }

  if (type === 'data') {
    return {
      ...base,
      upstreamPath: '/bills/data',
      upstreamBody: {
        network: requireSogoString(body.network, 'network', /^[a-z0-9-]+$/i).toLowerCase(),
        phone: requireSogoString(body.phone, 'phone', /^\+?[0-9\s-]{10,16}$/).replace(/[\s-]/g, ''),
        variation_code: requireSogoString(body.variationCode || body.variation_code, 'variationCode', /^[a-zA-Z0-9_.:-]+$/),
      },
    };
  }

  const meterType = requireSogoString(body.meterType || body.meter_type, 'meterType', /^[a-z]+$/i).toLowerCase();
  if (!SOGO_METER_TYPES.has(meterType)) {
    throw new HttpError(400, 'invalid_bills_params', 'meterType must be prepaid or postpaid.');
  }

  return {
    ...base,
    upstreamPath: '/bills/electricity',
    upstreamBody: {
      disco_slug: requireSogoString(body.discoSlug || body.disco_slug, 'discoSlug', /^[a-z0-9-]+$/i).toLowerCase(),
      meter_number: requireSogoString(body.meterNumber || body.meter_number, 'meterNumber', /^[0-9]{6,24}$/),
      meter_type: meterType,
      amount,
    },
  };
}

function sanitizeSogoVerifyMeterBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_bills_params', 'Meter verification payload is required.');
  }

  const meterType = requireSogoString(body.meterType || body.meter_type, 'meterType', /^[a-z]+$/i).toLowerCase();
  if (!SOGO_METER_TYPES.has(meterType)) {
    throw new HttpError(400, 'invalid_bills_params', 'meterType must be prepaid or postpaid.');
  }

  return {
    disco_slug: requireSogoString(body.discoSlug || body.disco_slug, 'discoSlug', /^[a-z0-9-]+$/i).toLowerCase(),
    meter_number: requireSogoString(body.meterNumber || body.meter_number, 'meterNumber', /^[0-9]{6,24}$/),
    meter_type: meterType,
  };
}

function getFirstSogoBillText(records, keys) {
  for (const value of records) {
    const record = asSogoRecord(value);
    const candidates = [record, asSogoRecord(record.data), asSogoRecord(record.bill), asSogoRecord(record.transaction), asSogoRecord(record.payment), asSogoRecord(record.meta)];
    for (const candidate of candidates) {
      for (const key of keys) {
        const text = candidate?.[key];
        if (typeof text === 'string' && text.trim()) return text.trim();
        if (typeof text === 'number' && Number.isFinite(text)) return String(text);
      }
    }
  }
  return '';
}

function getSogoBillAnalyticsProvider(body) {
  if (body.type === 'electricity') return body.upstreamBody?.discoSlug || body.upstreamBody?.network || 'Electricity';
  return body.upstreamBody?.network || body.type || 'Bills';
}

function getSogoBillAnalyticsRecipient(body) {
  if (body.type === 'electricity') return body.upstreamBody?.meterNumber || '';
  return body.upstreamBody?.phone || '';
}

async function recordSogoBillAnalytics({ body, payment, paymentStatus, billRecord, providerPayload }) {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return;

  try {
    const reference = getFirstSogoBillText([billRecord, providerPayload], ['reference', 'ref', 'id', 'transactionId', 'transaction_id', 'orderId', 'order_id']) || body.idempotencyKey;
    const provider = getSogoBillAnalyticsProvider(body);
    const record = sanitizeTransactionAnalyticsBody({
      eventId: `bills:${payment.txHash}:${reference}`,
      walletAddress: payment.walletAddress,
      txHash: payment.txHash,
      category: 'bills',
      status: paymentStatus,
      direction: 'sent',
      networkId: payment.network,
      networkLabel: SOGO_PAYMENT_NETWORK_LABELS[payment.network] || payment.network,
      tokenSymbol: payment.asset,
      tokenAddress: payment.tokenAddress,
      amount: `${payment.amount} ${payment.asset}`,
      amountUsd: Number(payment.amount),
      fiatAmount: `NGN ${body.amount}`,
      platformFee: `${payment.platformFeeAmount} ${payment.asset}`,
      platformFeeUsd: Number(payment.platformFeeAmount),
      provider,
      counterparty: provider,
      reference,
      source: 'backend',
      occurredAt: new Date().toISOString(),
      metadata: {
        billType: body.type,
        recipient: getSogoBillAnalyticsRecipient(body),
        quoteId: body.quote?.id,
        treasuryAddress: payment.treasuryAddress,
        billReference: reference,
      },
    });

    await upsertSupabaseRecord('doxa_wallet_transactions', record, 'event_id');
  } catch (error) {
    console.warn('Bills analytics write failed', {
      message: error instanceof Error ? error.message : String(error),
      txHash: payment?.txHash,
    });
  }
}
function getSogoRouteSegments(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const sogoIndex = segments[0] === 'api' ? 1 : 0;

  if (segments[sogoIndex] !== 'sogo') {
    return [];
  }

  const pathSegments = segments.slice(sogoIndex + 1).map((segment) => decodeURIComponent(segment));
  return pathSegments.length > 0 ? pathSegments : getVercelCatchAllSegments(url);
}

async function handleSogoProxy(req, res, url) {
  assertCors(req);
  const segments = getSogoRouteSegments(url);

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'health') {
    sendJson(req, res, 200, {
      status: 'ok',
      service: 'doxa-sogo-bills-proxy',
      configured: Boolean(config.sogoApiKey),
      collectionConfigured: Boolean(config.sogoBillsTreasuryAddress),
    });
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'bills' && segments[1] === 'catalog') {
    const payload = await requestSogo(`/bills/catalog${url.search || ''}`);
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'bills' && segments[1] === 'data-plans') {
    const network = url.searchParams.get('network');
    const query = network ? `?network=${encodeURIComponent(requireSogoString(network, 'network', /^[a-z0-9-]+$/i).toLowerCase())}` : '';
    const payload = await requestSogo(`/bills/data-plans${query}`);
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'bills' && segments[1] === 'quote') {
    const quote = await buildSogoBillsQuote(url.searchParams.get('amount'), url.searchParams.get('asset') || 'USDC');
    sendJson(req, res, 200, { data: quote });
    return;
  }

  if (req.method === 'POST' && segments.length === 3 && segments[0] === 'bills' && segments[1] === 'electricity' && segments[2] === 'verify-meter') {
    const body = sanitizeSogoVerifyMeterBody(await readJson(req));
    const payload = await requestSogo('/bills/electricity/verify-meter', { method: 'POST', body });
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'POST' && segments.length === 2 && segments[0] === 'bills' && segments[1] === 'pay') {
    const body = sanitizeSogoBillPurchaseBody(await readJson(req));
    const payment = await verifySogoBillsStablePayment({ payment: body.payment, quote: body.quote });
    const payload = await requestSogo(body.upstreamPath, {
      method: 'POST',
      body: body.upstreamBody,
      idempotencyKey: body.idempotencyKey,
    });

    consumedSogoBillPaymentTxHashes.add(payment.txHash);

    const billPayload = payload?.data ?? payload;
    const billRecord = asSogoRecord(billPayload);
    const paymentStatus = normalizeSogoBillPaymentStatus(billRecord, payload);
    await recordSogoBillAnalytics({ body, payment, paymentStatus, billRecord, providerPayload: payload });

    sendJson(req, res, 200, {
      status: paymentStatus,
      message: payload?.message || (paymentStatus === 'completed' ? 'Bill payment completed successfully.' : 'Bill payment submitted successfully.'),
      data: {
        status: paymentStatus,
        bill: Object.keys(billRecord).length > 0 ? { ...billRecord, status: billRecord.status ?? paymentStatus } : { status: paymentStatus },
        payment,
        quote: body.quote,
      },
    });
    return;
  }

  if (req.method === 'GET' && segments.length === 3 && segments[0] === 'bills' && segments[1] === 'transactions') {
    const reference = requireSogoString(segments[2], 'reference', /^[a-zA-Z0-9_.:-]+$/);
    const payload = await requestSogo(`/transactions/${encodeURIComponent(reference)}?type=bill_payment`);
    sendJson(req, res, 200, payload);
    return;
  }

  throw new HttpError(404, 'not_found', 'Bills route not found.');
}
function getVercelCatchAllSegments(url) {
  return url.searchParams
    .getAll('path')
    .flatMap((value) => String(value).split('/'))
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function getPaycrestRouteSegments(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const paycrestIndex = segments[0] === 'api' ? 1 : 0;

  if (segments[paycrestIndex] !== 'paycrest') {
    return [];
  }

  const pathSegments = segments.slice(paycrestIndex + 1).map((segment) => decodeURIComponent(segment));
  return pathSegments.length > 0 ? pathSegments : getVercelCatchAllSegments(url);
}

async function handlePaycrestProxy(req, res, url) {
  assertCors(req);
  const segments = getPaycrestRouteSegments(url);

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'health') {
    sendJson(req, res, 200, {
      status: 'ok',
      service: 'doxa-paycrest-proxy',
      configured: Boolean(config.paycrestApiKey),
    });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'currencies') {
    const payload = await requestPaycrest('/currencies');
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'institutions') {
    const currency = normalizePaycrestCurrency(segments[1]);
    const payload = await requestPaycrest(`/institutions/${encodeURIComponent(currency)}`);
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'tokens') {
    const payload = await requestPaycrest('/tokens');
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'GET' && segments.length === 5 && segments[0] === 'rates') {
    const payload = await requestPaycrest(sanitizePaycrestRateQuery(segments, url), { authenticated: false });
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'POST' && segments.length === 1 && segments[0] === 'verify-account') {
    const body = sanitizePaycrestVerifyAccountBody(await readJson(req));
    const payload = await requestPaycrest('/verify-account', {
      method: 'POST',
      body,
    });
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'orders') {
    const payload = await requestPaycrest(`/sender/orders${url.search || ''}`);
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'POST' && segments.length === 1 && segments[0] === 'orders') {
    const body = sanitizePaycrestOrderBody(await readJson(req));
    const payload = await requestPaycrest('/sender/orders', {
      method: 'POST',
      body,
    });
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'orders') {
    const orderId = requirePaycrestString(segments[1], 'orderId');
    const payload = await requestPaycrest(`/sender/orders/${encodeURIComponent(orderId)}`);
    sendJson(req, res, 200, payload);
    return;
  }


  throw new HttpError(404, 'not_found', 'Paycrest route not found.');
}
function getRailsRouteSegments(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const railsIndex = segments[0] === 'api' ? 1 : 0;

  if (segments[railsIndex] !== 'rails') {
    return [];
  }

  const pathSegments = segments.slice(railsIndex + 1).map((segment) => decodeURIComponent(segment));
  return pathSegments.length > 0 ? pathSegments : getVercelCatchAllSegments(url);
}

async function handleRailsProxy(req, res, url) {
  assertCors(req);
  const segments = getRailsRouteSegments(url);

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'currencies') {
    const payload = await requestRails('/v1/currencies');
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'institutions') {
    const currency = normalizeRailsCurrency(segments[1]);
    const payload = await requestRails(`/v1/institutions/${encodeURIComponent(currency)}`);
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'GET' && segments[0] === 'rates' && (segments.length === 4 || segments.length === 5)) {
    const hasNetworkSegment = segments.length === 5;
    const network = hasNetworkSegment ? normalizeRailsNetwork(segments[1]) : undefined;
    const tokenIndex = hasNetworkSegment ? 2 : 1;
    const token = normalizeRailsToken(segments[tokenIndex]);
    const amount = normalizeRailsAmount(segments[tokenIndex + 1]);
    const fiat = normalizeRailsCurrency(segments[tokenIndex + 2]);
    const payload = await requestRailsRate({ network, token, amount, fiat });
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'POST' && segments.length === 1 && segments[0] === 'verify-account') {
    const body = sanitizeRailsVerifyAccountBody(await readJson(req));
    const payload = await requestRails('/v1/sender/verify-account', {
      method: 'POST',
      authenticated: true,
      body,
    });
    sendJson(req, res, 200, payload);
    return;
  }

  if (req.method === 'POST' && segments.length === 1 && segments[0] === 'orders') {
    const body = sanitizeRailsOrderBody(await readJson(req));
    const payload = await requestRails('/v1/sender/orders', {
      method: 'POST',
      authenticated: true,
      body,
    });
    sendJson(req, res, 200, payload);
    return;
  }

  if (segments.length === 2 && segments[0] === 'orders' && req.method === 'GET') {
    const orderRef = requireRailsString(segments[1], 'orderRef');
    const payload = await requestRails(`/v1/sender/orders/${encodeURIComponent(orderRef)}`, {
      authenticated: true,
    });
    sendJson(req, res, 200, payload);
    return;
  }

  if (segments.length === 3 && segments[0] === 'orders' && segments[2] === 'submitted' && req.method === 'POST') {
    const orderRef = requireRailsString(segments[1], 'orderRef');
    const body = sanitizeRailsSubmittedBody(await readJson(req));
    const payload = await requestRails(`/v1/sender/orders/${encodeURIComponent(orderRef)}/submitted`, {
      method: 'POST',
      authenticated: true,
      body,
    });
    sendJson(req, res, 200, payload);
    return;
  }

  throw new HttpError(404, 'not_found', 'Rails route not found.');
}

function getOnboardRouteSegments(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const onboardIndex = segments[0] === 'api' ? 1 : 0;

  if (segments[onboardIndex] !== 'onboard') {
    return [];
  }

  const pathSegments = segments.slice(onboardIndex + 1).map((segment) => decodeURIComponent(segment));
  return pathSegments.length > 0 ? pathSegments : getVercelCatchAllSegments(url);
}

function assertOnboardConfigured() {
  if (!config.onboardApiKey || !config.onboardApiSecret) {
    throw new HttpError(500, 'onboard_not_configured', 'Set ONBOARD_API_KEY and ONBOARD_API_SECRET on the backend.');
  }
}

function buildOnboardSignatureHeaders(body = {}) {
  const timestamp = Math.ceil(Date.now() / 1000);
  const signaturePayload = `t=${timestamp}&${JSON.stringify(body)}`;
  const signature = createHmac('sha256', config.onboardApiSecret).update(signaturePayload).digest('hex');

  return {
    'x-api-key': config.onboardApiKey,
    'x-signature': signature,
    'x-timestamp': String(timestamp),
  };
}

async function requestOnboard(path, { method = 'GET', body } = {}) {
  assertOnboardConfigured();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const requestBody = method === 'GET' || method === 'HEAD' ? {} : (body ?? {});
  const response = await fetch(`${config.onboardApiBaseUrl}${normalizedPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(method !== 'GET' && method !== 'HEAD' ? { 'Content-Type': 'application/json' } : {}),
      ...buildOnboardSignatureHeaders(requestBody),
    },
    ...(method !== 'GET' && method !== 'HEAD' ? { body: JSON.stringify(requestBody) } : {}),
  });
  const payload = await readResponseJson(response);

  if (!response.ok) {
    const message = payload?.message || payload?.code || `Onboard request failed with ${response.status}`;
    throw new HttpError(response.status || 502, 'onboard_request_failed', message);
  }

  return payload;
}

async function handleOnboardProxy(req, res, url) {
  assertCors(req);
  const segments = getOnboardRouteSegments(url);

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'health') {
    sendJson(req, res, 200, {
      status: 'ok',
      service: 'doxa-onboard-proxy',
      configured: Boolean(config.onboardApiKey && config.onboardApiSecret),
      baseUrl: config.onboardApiBaseUrl,
    });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'info') {
    const payload = await requestOnboard('/exchange/api/info');
    sendJson(req, res, 200, { data: payload });
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'network-tokens') {
    const assetCode = requirePaycrestString(segments[1], 'assetCode').toUpperCase();
    const payload = await requestOnboard(`/ledger/assets/${encodeURIComponent(assetCode)}/network-tokens`);
    sendJson(req, res, 200, { data: payload });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'cash-payout-currencies') {
    const payload = await requestOnboard('/ledger/cash-payments/currencies');
    sendJson(req, res, 200, { data: payload });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'fiat-beneficiaries') {
    const payload = await requestOnboard(`/ledger/fiat-beneficiaries${url.search || ''}`);
    sendJson(req, res, 200, { data: payload });
    return;
  }

  if (req.method === 'POST' && segments.length === 1 && segments[0] === 'fiat-beneficiaries') {
    const body = await readJson(req);
    const payload = await requestOnboard('/ledger/fiat-beneficiaries', { method: 'POST', body });
    sendJson(req, res, 201, { data: payload });
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'fiat-beneficiaries') {
    const beneficiaryId = requirePaycrestString(segments[1], 'beneficiaryId');
    const payload = await requestOnboard(`/ledger/fiat-beneficiaries/${encodeURIComponent(beneficiaryId)}`);
    sendJson(req, res, 200, { data: payload });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'offramp-accounts') {
    const payload = await requestOnboard(`/ledger/offramp-accounts${url.search || ''}`);
    sendJson(req, res, 200, { data: payload });
    return;
  }

  if (req.method === 'POST' && segments.length === 1 && segments[0] === 'offramp-accounts') {
    const body = await readJson(req);
    const payload = await requestOnboard('/ledger/offramp-accounts', { method: 'POST', body });
    sendJson(req, res, 200, { data: payload });
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'offramp-accounts') {
    const offrampAccountId = requirePaycrestString(segments[1], 'offrampAccountId');
    const payload = await requestOnboard(`/ledger/offramp-accounts/${encodeURIComponent(offrampAccountId)}`);
    sendJson(req, res, 200, { data: payload });
    return;
  }

  if (req.method === 'GET' && segments.length === 3 && segments[0] === 'offramp-accounts' && segments[2] === 'funding-address') {
    const offrampAccountId = requirePaycrestString(segments[1], 'offrampAccountId');
    const payload = await requestOnboard(
      `/ledger/offramp-accounts/${encodeURIComponent(offrampAccountId)}/funding-address${url.search || ''}`,
    );
    sendJson(req, res, 200, { data: payload });
    return;
  }

  if (req.method === 'GET' && segments.length === 3 && segments[0] === 'offramp-accounts' && segments[2] === 'transactions') {
    const offrampAccountId = requirePaycrestString(segments[1], 'offrampAccountId');
    const payload = await requestOnboard(
      `/ledger/offramp-accounts/${encodeURIComponent(offrampAccountId)}/transactions${url.search || ''}`,
    );
    sendJson(req, res, 200, { data: payload });
    return;
  }

  throw new HttpError(404, 'not_found', 'Onboard route not found.');
}

const ANALYTICS_WALLET_SOURCES = new Set(['created', 'imported', 'imported_seed', 'imported_private_key', 'recovered', 'unknown']);
const ANALYTICS_TRANSACTION_CATEGORIES = new Set(['transaction', 'token-transfer', 'swap', 'bridge', 'xchange', 'bills']);
const ANALYTICS_TRANSACTION_STATUSES = new Set(['pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled']);
const ANALYTICS_TRANSACTION_DIRECTIONS = new Set(['sent', 'received']);

function getAnalyticsRouteSegments(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const analyticsIndex = segments[0] === 'api' ? 1 : 0;

  if (segments[analyticsIndex] !== 'analytics') {
    return [];
  }

  return segments.slice(analyticsIndex + 1).map((segment) => decodeURIComponent(segment));
}

function sanitizeAnalyticsString(value, maxLength = 180) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function sanitizeAnalyticsAddress(value, fieldName, required = false) {
  const address = sanitizeAnalyticsString(value, 42);
  if (!address) {
    if (required) throw new HttpError(400, 'invalid_analytics_payload', `${fieldName} is required.`);
    return undefined;
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new HttpError(400, 'invalid_analytics_payload', `${fieldName} is invalid.`);
  }

  return address.toLowerCase();
}

function sanitizeAnalyticsHash(value) {
  const hash = sanitizeAnalyticsString(value, 66);
  if (!hash) return undefined;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    throw new HttpError(400, 'invalid_analytics_payload', 'txHash is invalid.');
  }
  return hash.toLowerCase();
}

function sanitizeAnalyticsEnum(value, allowedValues, fallback) {
  const normalized = sanitizeAnalyticsString(value, 40)?.toLowerCase();
  return normalized && allowedValues.has(normalized) ? normalized : fallback;
}

function sanitizeAnalyticsTimestamp(value) {
  const raw = sanitizeAnalyticsString(value, 80);
  if (!raw) return new Date().toISOString();
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function sanitizeAnalyticsAmount(value) {
  const text = sanitizeAnalyticsString(value, 80);
  if (!text) return { amountText: undefined, amountNumeric: undefined };
  const numericMatch = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  const numeric = numericMatch ? Number(numericMatch[0]) : NaN;
  return {
    amountText: text,
    amountNumeric: Number.isFinite(numeric) ? numeric : undefined,
  };
}

function sanitizeAnalyticsUsdAmount(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(numeric)) return undefined;
  return Math.round(numeric * 1e8) / 1e8;
}

const ANALYTICS_STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'USD']);
const ANALYTICS_MAX_REASONABLE_FEE_USD = 10_000;
const ANALYTICS_MAX_FEE_SHARE_OF_VOLUME = 0.25;

function amountTextMentionsStable(amountText) {
  return Boolean(
    ANALYTICS_STABLE_SYMBOLS.has(
      (String(amountText || '').toUpperCase().match(/\b(USDC|USDT|DAI|BUSD|USD)\b/)?.[1] || ''),
    ),
  );
}

function inferStableUsdAmount(amountText, tokenSymbol, explicitUsd) {
  const explicit = sanitizeAnalyticsUsdAmount(explicitUsd);
  if (explicit !== undefined) return explicit;

  const parsed = sanitizeAnalyticsAmount(amountText);
  if (parsed.amountNumeric === undefined) return undefined;

  const symbol = sanitizeAnalyticsString(tokenSymbol, 32)?.toUpperCase();
  const mentionsStable = ANALYTICS_STABLE_SYMBOLS.has(symbol || '') || amountTextMentionsStable(parsed.amountText);

  return mentionsStable ? parsed.amountNumeric : undefined;
}

// Platform fee text is often denominated in the swap input token (including meme coins).
// Never infer USD from fee text using the transaction token symbol alone.
function inferPlatformFeeUsdAmount(platformFeeText, tokenSymbol, explicitUsd, amountUsd) {
  const explicit = sanitizeAnalyticsUsdAmount(explicitUsd);
  if (explicit !== undefined) {
    return sanitizePlatformFeeUsd(explicit, amountUsd);
  }

  const parsed = sanitizeAnalyticsAmount(platformFeeText);
  if (parsed.amountNumeric === undefined) return undefined;

  // Only treat fee text as USD when the fee string itself is clearly USD/stable-denominated.
  if (!amountTextMentionsStable(parsed.amountText)) {
    return undefined;
  }

  return sanitizePlatformFeeUsd(parsed.amountNumeric, amountUsd);
}

function sanitizePlatformFeeUsd(feeUsd, amountUsd) {
  const fee = sanitizeAnalyticsUsdAmount(feeUsd);
  if (fee === undefined || fee < 0) return undefined;

  const volume = sanitizeAnalyticsUsdAmount(amountUsd);
  if (fee > ANALYTICS_MAX_REASONABLE_FEE_USD) {
    return undefined;
  }

  if (volume != null && volume > 0 && fee > volume * ANALYTICS_MAX_FEE_SHARE_OF_VOLUME && fee > 1) {
    return undefined;
  }

  return fee;
}

function resolveDashboardPlatformFeeUsd({ category, platformFeeUsd, amountUsd, countsTowardVolume }) {
  if (!countsTowardVolume) return 0;

  let feeUsd = Number(platformFeeUsd) || 0;
  const volumeUsd = Number(amountUsd) || 0;
  const sanitized = sanitizePlatformFeeUsd(feeUsd, volumeUsd);
  feeUsd = sanitized === undefined ? 0 : sanitized;

  // Historical swap/bridge rows often omit platform_fee_usd; estimate the 0.3% Doxa fee.
  if (feeUsd <= 0 && volumeUsd > 0 && (category === 'swap' || category === 'bridge')) {
    feeUsd = Math.round(volumeUsd * 0.003 * 1e8) / 1e8;
  }

  return feeUsd;
}

function sanitizeAnalyticsMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function sanitizeWalletAnalyticsBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_analytics_payload', 'Wallet analytics payload is required.');
  }

  return {
    wallet_address: sanitizeAnalyticsAddress(body.walletAddress || body.wallet_address, 'walletAddress', true),
    source: sanitizeAnalyticsEnum(body.source, ANALYTICS_WALLET_SOURCES, 'unknown'),
    is_backed_up: typeof body.isBackedUp === 'boolean' ? body.isBackedUp : typeof body.is_backed_up === 'boolean' ? body.is_backed_up : undefined,
    platform: sanitizeAnalyticsString(body.platform, 40),
    app_version: sanitizeAnalyticsString(body.appVersion || body.app_version, 40),
    client_created_at: sanitizeAnalyticsTimestamp(body.createdAt || body.clientCreatedAt || body.client_created_at),
    metadata: sanitizeAnalyticsMetadata(body.metadata),
  };
}

function sanitizeTransactionAnalyticsBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_analytics_payload', 'Transaction analytics payload is required.');
  }

  const walletAddress = sanitizeAnalyticsAddress(body.walletAddress || body.wallet_address, 'walletAddress', true);
  const txHash = sanitizeAnalyticsHash(body.txHash || body.tx_hash || body.hash);
  const category = sanitizeAnalyticsEnum(body.category, ANALYTICS_TRANSACTION_CATEGORIES, 'transaction');
  const eventId = sanitizeAnalyticsString(body.eventId || body.event_id, 220) || `${walletAddress}:${category}:${txHash || randomUUID()}`;
  const amount = sanitizeAnalyticsAmount(body.amount || body.amountText || body.amount_text);
  const tokenSymbol = sanitizeAnalyticsString(body.tokenSymbol || body.token_symbol, 32)?.toUpperCase();
  const platformFeeText = sanitizeAnalyticsString(body.platformFee || body.platformFeeText || body.platform_fee_text, 80);
  const amountUsd = inferStableUsdAmount(
    amount.amountText,
    tokenSymbol,
    body.amountUsd ?? body.amount_usd,
  );
  const explicitPlatformFeeUsd = sanitizeAnalyticsUsdAmount(
    body.platformFeeUsd ?? body.platform_fee_usd ?? body.feeUsd ?? body.fee_usd,
  );
  const platformFeeUsd = inferPlatformFeeUsdAmount(
    platformFeeText,
    tokenSymbol,
    explicitPlatformFeeUsd,
    amountUsd,
  );

  return {
    event_id: eventId,
    wallet_address: walletAddress,
    tx_hash: txHash,
    category,
    status: sanitizeAnalyticsEnum(body.status, ANALYTICS_TRANSACTION_STATUSES, 'completed'),
    direction: sanitizeAnalyticsEnum(body.direction, ANALYTICS_TRANSACTION_DIRECTIONS, undefined),
    network_id: sanitizeAnalyticsString(body.networkId || body.network_id, 80),
    network_label: sanitizeAnalyticsString(body.networkLabel || body.network_label, 120),
    token_symbol: tokenSymbol,
    token_address: sanitizeAnalyticsAddress(body.tokenAddress || body.token_address, 'tokenAddress', false),
    amount_text: amount.amountText,
    amount_numeric: amount.amountNumeric,
    amount_usd: amountUsd,
    fiat_amount_text: sanitizeAnalyticsString(body.fiatAmount || body.fiatAmountText || body.fiat_amount_text, 80),
    platform_fee_text: platformFeeText,
    platform_fee_usd: platformFeeUsd,
    provider: sanitizeAnalyticsString(body.provider, 120),
    counterparty: sanitizeAnalyticsString(body.counterparty, 180),
    reference: sanitizeAnalyticsString(body.reference, 180),
    explorer_url: sanitizeAnalyticsString(body.explorerUrl || body.explorer_url, 260),
    source: sanitizeAnalyticsString(body.source, 60),
    occurred_at: sanitizeAnalyticsTimestamp(body.occurredAt || body.occurred_at || body.timestamp),
    metadata: sanitizeAnalyticsMetadata(body.metadata),
  };
}

async function upsertSupabaseRecord(tableName, record, onConflict) {
  assertAnalyticsConfigured();
  const url = `${config.supabaseUrl}/rest/v1/${tableName}?on_conflict=${onConflict}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(record),
  });
  const payload = await readResponseJson(response);

  if (!response.ok) {
    console.error('Supabase analytics request failed', {
      tableName,
      status: response.status,
      message: payload?.message || payload?.error || payload,
    });
    throw new HttpError(502, 'analytics_write_failed', 'Unable to record analytics right now.');
  }

  return payload;
}

async function querySupabase(pathWithQuery, { pageSize = 1000, maxRows = 20000 } = {}) {
  assertAnalyticsConfigured();
  const rows = [];
  let offset = 0;

  while (offset < maxRows) {
    const end = Math.min(offset + pageSize - 1, maxRows - 1);
    const separator = pathWithQuery.includes('?') ? '&' : '?';
    const url = `${config.supabaseUrl}/rest/v1/${pathWithQuery}${separator}limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: config.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
        Range: `${offset}-${end}`,
      },
    });
    const payload = await readResponseJson(response);

    if (!response.ok) {
      console.error('Supabase analytics query failed', {
        pathWithQuery,
        status: response.status,
        message: payload?.message || payload?.error || payload,
      });
      throw new HttpError(502, 'analytics_read_failed', 'Unable to load analytics right now.');
    }

    const batch = Array.isArray(payload) ? payload : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function assertAnalyticsDashboardAccess(req) {
  if (!config.analyticsDashboardSecret) {
    throw new HttpError(500, 'analytics_dashboard_not_configured', 'Set DOXA_ANALYTICS_DASHBOARD_SECRET on the backend.');
  }

  const headerValue = String(req.headers['x-doxa-analytics-secret'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '') || '');
  const expected = Buffer.from(config.analyticsDashboardSecret);
  const actual = Buffer.from(headerValue);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpError(401, 'unauthorized', 'Invalid analytics dashboard credentials.');
  }
}

function parseAnalyticsDays(value, fallback = 30) {
  const days = Number(value);
  if (!Number.isFinite(days)) return fallback;
  return Math.min(Math.max(Math.trunc(days), 1), 365);
}

function startOfUtcDay(daysAgo) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString();
}

function toDayKey(value) {
  return String(value || '').slice(0, 10);
}

const ANALYTICS_STATUS_RANK = {
  completed: 60,
  processing: 50,
  pending: 40,
  refunded: 30,
  cancelled: 20,
  canceled: 20,
  failed: 10,
};

function getAnalyticsTransactionDedupeKey(tx) {
  const wallet = String(tx.wallet_address || '').toLowerCase();
  const category = String(tx.category || 'transaction').toLowerCase();
  const hash = String(tx.tx_hash || '').toLowerCase().replace(/^0x/, '');
  const reference = String(tx.reference || '').toLowerCase();
  const eventId = String(tx.event_id || '').toLowerCase();

  if (hash) return `hash:${wallet}:${category}:${hash}`;
  if (reference) return `ref:${wallet}:${category}:${reference}`;
  if (eventId) return `event:${eventId}`;
  return `row:${wallet}:${category}:${tx.occurred_at || ''}:${tx.amount_text || ''}`;
}

function getAnalyticsStatusRank(status) {
  const normalized = String(status || 'completed').toLowerCase().trim();
  return ANALYTICS_STATUS_RANK[normalized] ?? 0;
}

function preferAnalyticsTransaction(current, candidate) {
  if (!current) return candidate;

  const statusDelta = getAnalyticsStatusRank(candidate.status) - getAnalyticsStatusRank(current.status);
  if (statusDelta !== 0) return statusDelta > 0 ? candidate : current;

  const candidateTime = Date.parse(String(candidate.occurred_at || '')) || 0;
  const currentTime = Date.parse(String(current.occurred_at || '')) || 0;
  if (candidateTime !== currentTime) return candidateTime > currentTime ? candidate : current;

  const candidateUsd = Number(candidate.amount_usd) || 0;
  const currentUsd = Number(current.amount_usd) || 0;
  if (candidateUsd !== currentUsd) return candidateUsd > currentUsd ? candidate : current;

  return current;
}

function dedupeAnalyticsTransactions(transactions) {
  const byKey = new Map();

  for (const tx of transactions || []) {
    if (!tx || typeof tx !== 'object') continue;
    const key = getAnalyticsTransactionDedupeKey(tx);
    byKey.set(key, preferAnalyticsTransaction(byKey.get(key), tx));
  }

  return Array.from(byKey.values());
}

function buildAnalyticsAssetLabel(tx, metadata = {}, billType = null, summaryAmount = null) {
  const category = String(tx.category || 'transaction').toLowerCase();
  const tokenSymbol = sanitizeAnalyticsString(tx.token_symbol, 32);
  const amountText = sanitizeAnalyticsString(tx.amount_text, 120);

  if (category === 'bills') {
    const billLabel =
      billType === 'airtime'
        ? 'Airtime'
        : billType === 'data'
          ? 'Data'
          : billType === 'electricity'
            ? 'Electricity'
            : 'Bill';
    return tokenSymbol ? `${billLabel} · ${tokenSymbol}` : billLabel;
  }

  if (category === 'swap') {
    const fromSymbol = sanitizeAnalyticsString(metadata.fromSymbol || metadata.from_token, 32);
    const toSymbol = sanitizeAnalyticsString(metadata.toSymbol || metadata.to_token, 32);
    if (summaryAmount) return summaryAmount;
    if (fromSymbol && toSymbol) return `${fromSymbol} → ${toSymbol}`;
    return tokenSymbol || amountText || 'Swap';
  }

  if (category === 'bridge') {
    if (summaryAmount) return summaryAmount;
    return tokenSymbol || amountText || 'Bridge';
  }

  if (category === 'xchange') {
    return tokenSymbol || sanitizeAnalyticsString(metadata.titleToken, 32) || amountText || 'Xchange';
  }

  if (category === 'token-transfer' || category === 'transaction') {
    return tokenSymbol || amountText || 'Transfer';
  }

  return tokenSymbol || amountText || null;
}

function parsePaycrestFeeNumber(value) {
  const numeric = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function isPaycrestFeeCountingStatus(status) {
  const normalized = String(status || '').toLowerCase().trim();
  return ['settled', 'fulfilled', 'completed', 'success'].includes(normalized);
}

async function fetchPaycrestSenderStatsFeeEarnings() {
  if (!config.paycrestApiKey) return null;
  try {
    const statsPayload = await requestPaycrest('/sender/stats');
    const stats = statsPayload?.data && typeof statsPayload.data === 'object' ? statsPayload.data : statsPayload;
    const total = parsePaycrestFeeNumber(stats?.totalFeeEarnings ?? stats?.total_fee_earnings);
    return total > 0 ? Math.round(total * 1e8) / 1e8 : null;
  } catch (error) {
    console.warn('Unable to fetch Paycrest sender stats for analytics', error?.message || error);
    return null;
  }
}

async function fetchPaycrestSenderFeesSince(sinceIso) {
  if (!config.paycrestApiKey) return null;

  const sinceMs = Date.parse(sinceIso);
  let page = 1;
  let feeUsd = 0;
  const maxPages = 50;
  const statsTotal = await fetchPaycrestSenderStatsFeeEarnings();

  try {
    while (page <= maxPages) {
      const payload = await requestPaycrest(`/sender/orders?page=${page}&pageSize=100`);
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
      const orders = Array.isArray(data?.orders)
        ? data.orders
        : Array.isArray(data)
          ? data
          : Array.isArray(payload?.orders)
            ? payload.orders
            : [];

      if (!orders.length) break;

      for (const order of orders) {
        const createdMs = Date.parse(
          order.createdAt || order.created_at || order.updatedAt || order.updated_at || '',
        );
        if (Number.isFinite(sinceMs) && Number.isFinite(createdMs) && createdMs < sinceMs) {
          continue;
        }
        if (!isPaycrestFeeCountingStatus(order.status)) continue;
        feeUsd += parsePaycrestFeeNumber(order.senderFee ?? order.sender_fee);
      }

      const pageSize = Number(data?.pageSize) || orders.length;
      const total = Number(data?.total);
      if (orders.length < pageSize) break;
      if (Number.isFinite(total) && page * pageSize >= total) break;
      page += 1;
    }

    const orderSum = Math.round(feeUsd * 1e8) / 1e8;
    // Prefer Paycrest dashboard totals when our settled-order sum matches/exceeds them
    // (avoids overcounting pending/legacy statuses) or when the window likely covers all history.
    if (statsTotal != null) {
      if (orderSum <= 0) return statsTotal;
      if (orderSum >= statsTotal) return statsTotal;
      return orderSum;
    }
    return orderSum;
  } catch (error) {
    console.warn('Unable to sum Paycrest order fees for analytics', error?.message || error);
    return statsTotal;
  }
}

function reconcileDashboardPaycrestFees(summary, paycrestFeeUsd) {
  if (paycrestFeeUsd == null || !Number.isFinite(paycrestFeeUsd)) return summary;

  const xchangeFeeFromDb =
    (Number(summary.totals?.xchangeBuy?.feeUsd) || 0) + (Number(summary.totals?.xchangeSell?.feeUsd) || 0);
  const feeGap = Math.max(0, paycrestFeeUsd - xchangeFeeFromDb);
  if (feeGap <= 0) return summary;

  const buyCount = Number(summary.totals?.xchangeBuy?.count) || 0;
  const sellCount = Number(summary.totals?.xchangeSell?.count) || 0;
  const totalXchangeCount = buyCount + sellCount;
  const buyShare = totalXchangeCount > 0 ? buyCount / totalXchangeCount : 0.5;
  const buyGap = Math.round(feeGap * buyShare * 1e8) / 1e8;
  const sellGap = Math.round((feeGap - buyGap) * 1e8) / 1e8;

  const feeSeries = Array.isArray(summary.series?.feeUsdByDay)
    ? summary.series.feeUsdByDay.map((point, index, list) =>
        index === list.length - 1
          ? { ...point, value: Math.round(((Number(point.value) || 0) + feeGap) * 1e8) / 1e8 }
          : point,
      )
    : summary.series?.feeUsdByDay;

  return {
    ...summary,
    totals: {
      ...summary.totals,
      feeUsd: Math.round(((Number(summary.totals.feeUsd) || 0) + feeGap) * 1e8) / 1e8,
      xchangeBuy: {
        ...summary.totals.xchangeBuy,
        feeUsd: Math.round(((Number(summary.totals.xchangeBuy?.feeUsd) || 0) + buyGap) * 1e8) / 1e8,
      },
      xchangeSell: {
        ...summary.totals.xchangeSell,
        feeUsd: Math.round(((Number(summary.totals.xchangeSell?.feeUsd) || 0) + sellGap) * 1e8) / 1e8,
      },
    },
    series: {
      ...summary.series,
      feeUsdByDay: feeSeries,
    },
  };
}

function aggregateDashboardMetrics({ wallets, transactions, downloads, days }) {
  const uniqueTransactions = dedupeAnalyticsTransactions(transactions);
  const dayKeys = Array.from({ length: days }, (_, index) => toDayKey(startOfUtcDay(days - 1 - index)));
  const walletsByDay = Object.fromEntries(dayKeys.map((day) => [day, 0]));
  const txByDay = Object.fromEntries(dayKeys.map((day) => [day, 0]));
  const volumeByDay = Object.fromEntries(dayKeys.map((day) => [day, 0]));
  const feesByDay = Object.fromEntries(dayKeys.map((day) => [day, 0]));
  const emptyDayMap = () => Object.fromEntries(dayKeys.map((day) => [day, 0]));

  const categoryDayCounts = {
    swap: emptyDayMap(),
    bridge: emptyDayMap(),
    'xchange-buy': emptyDayMap(),
    'xchange-sell': emptyDayMap(),
    bills: emptyDayMap(),
  };
  const categoryDayVolume = {
    swap: emptyDayMap(),
    bridge: emptyDayMap(),
    'xchange-buy': emptyDayMap(),
    'xchange-sell': emptyDayMap(),
    bills: emptyDayMap(),
  };
  const categoryTotals = {
    swap: { count: 0, volumeUsd: 0, feeUsd: 0 },
    bridge: { count: 0, volumeUsd: 0, feeUsd: 0 },
    'xchange-buy': { count: 0, volumeUsd: 0, feeUsd: 0 },
    'xchange-sell': { count: 0, volumeUsd: 0, feeUsd: 0 },
    bills: { count: 0, volumeUsd: 0, feeUsd: 0 },
  };

  const categoryCounts = {};
  const statusCounts = {};
  const networkCounts = {};
  const sourceCounts = {};
  const xchangeModeCounts = { buy: 0, sell: 0, unknown: 0 };

  let volumeUsd = 0;
  let feeUsd = 0;
  let completedCount = 0;

  const isFailedOrCancelledStatus = (status) => {
    const normalized = String(status || '').toLowerCase().trim();
    return normalized === 'failed' || normalized === 'cancelled' || normalized === 'canceled';
  };

  const resolveXchangeMode = (tx) => {
    const metadata = tx.metadata && typeof tx.metadata === 'object' ? tx.metadata : {};
    const mode = String(metadata.mode || metadata.xchangeMode || '').toLowerCase();
    if (mode === 'buy' || mode === 'sell') return mode;
    if (tx.direction === 'received') return 'buy';
    if (tx.direction === 'sent') return 'sell';
    return 'unknown';
  };

  const resolveTrackedCategory = (tx) => {
    const category = tx.category || 'transaction';
    if (category === 'swap' || category === 'bridge' || category === 'bills') return category;
    if (category === 'xchange') {
      const mode = resolveXchangeMode(tx);
      if (mode === 'buy') return 'xchange-buy';
      if (mode === 'sell') return 'xchange-sell';
    }
    return null;
  };

  for (const wallet of wallets) {
    const day = toDayKey(wallet.created_at || wallet.client_created_at);
    if (day in walletsByDay) walletsByDay[day] += 1;
    const source = wallet.source || 'unknown';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }

  for (const tx of uniqueTransactions) {
    const day = toDayKey(tx.occurred_at);
    if (day in txByDay) txByDay[day] += 1;

    const category = tx.category || 'transaction';
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    const status = tx.status || 'completed';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (status === 'completed') completedCount += 1;
    const network = tx.network_label || tx.network_id || 'Unknown';
    networkCounts[network] = (networkCounts[network] || 0) + 1;

    const countsTowardVolume = !isFailedOrCancelledStatus(status);
    const amountUsd = countsTowardVolume ? Number(tx.amount_usd) || 0 : 0;
    const platformFeeUsd = resolveDashboardPlatformFeeUsd({
      category,
      platformFeeUsd: tx.platform_fee_usd,
      amountUsd,
      countsTowardVolume,
    });

    if (countsTowardVolume) {
      volumeUsd += amountUsd;
      feeUsd += platformFeeUsd;
      if (day in volumeByDay) volumeByDay[day] += amountUsd;
      if (day in feesByDay) feesByDay[day] += platformFeeUsd;
    }

    if (category === 'xchange' && countsTowardVolume) {
      const mode = resolveXchangeMode(tx);
      xchangeModeCounts[mode] = (xchangeModeCounts[mode] || 0) + 1;
    }

    const tracked = resolveTrackedCategory(tx);
    if (tracked && countsTowardVolume && day in categoryDayCounts[tracked]) {
      categoryDayCounts[tracked][day] += 1;
      categoryDayVolume[tracked][day] += amountUsd;
      categoryTotals[tracked].count += 1;
      categoryTotals[tracked].volumeUsd += amountUsd;
      categoryTotals[tracked].feeUsd += platformFeeUsd;
    }
  }

  const latestDownloads = {};
  for (const row of downloads) {
    const source = row.source || 'other';
    if (!latestDownloads[source] || new Date(row.recorded_at) > new Date(latestDownloads[source].recordedAt)) {
      latestDownloads[source] = {
        source,
        downloadCount: Number(row.download_count) || 0,
        deltaCount: row.delta_count == null ? null : Number(row.delta_count),
        appUrl: row.app_url || null,
        recordedAt: row.recorded_at,
      };
    }
  }

  const websiteDownloadCount =
    latestDownloads.apk?.downloadCount ??
    latestDownloads.website?.downloadCount ??
    0;
  const totalDownloads =
    (latestDownloads.uptodown?.downloadCount || 0) +
    websiteDownloadCount +
    (latestDownloads.play_store?.downloadCount || 0) +
    (latestDownloads.app_store?.downloadCount || 0) +
    (latestDownloads.other?.downloadCount || 0);

  const toSeries = (map) => dayKeys.map((day) => ({ day, value: map[day] || 0 }));
  const toPie = (map) => Object.entries(map)
    .filter(([, value]) => Number(value) > 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const activityBreakdown = dayKeys.map((day) => ({
    day,
    swap: categoryDayCounts.swap[day] || 0,
    bridge: categoryDayCounts.bridge[day] || 0,
    xchangeBuy: categoryDayCounts['xchange-buy'][day] || 0,
    xchangeSell: categoryDayCounts['xchange-sell'][day] || 0,
    bills: categoryDayCounts.bills[day] || 0,
  }));

  const recentTransactions = uniqueTransactions
    .slice()
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
    .slice(0, 500)
    .map((tx) => {
      const tracked = resolveTrackedCategory(tx);
      const xchangeMode = tx.category === 'xchange' ? resolveXchangeMode(tx) : null;
      const metadata = tx.metadata && typeof tx.metadata === 'object' && !Array.isArray(tx.metadata) ? tx.metadata : {};
      const billTypeRaw = String(metadata.billType || metadata.bill_type || '').toLowerCase();
      const billType = ['airtime', 'data', 'electricity'].includes(billTypeRaw) ? billTypeRaw : null;
      const summaryAmount =
        sanitizeAnalyticsString(metadata.summaryAmount || metadata.summary_amount, 160) || null;
      const assetLabel = buildAnalyticsAssetLabel(tx, metadata, billType, summaryAmount);

      return {
        eventId: tx.event_id,
        occurredAt: tx.occurred_at,
        category: tx.category || 'transaction',
        trackedCategory: tracked,
        xchangeMode: xchangeMode === 'unknown' ? null : xchangeMode,
        status: tx.status || 'completed',
        direction: tx.direction || null,
        networkId: tx.network_id || null,
        networkLabel: tx.network_label || tx.network_id || 'Unknown',
        tokenSymbol: tx.token_symbol || null,
        amountText: tx.amount_text || null,
        amountUsd: Number(tx.amount_usd) || 0,
        platformFeeUsd: resolveDashboardPlatformFeeUsd({
          category: tx.category || 'transaction',
          platformFeeUsd: tx.platform_fee_usd,
          amountUsd: Number(tx.amount_usd) || 0,
          countsTowardVolume: true,
        }),
        walletAddress: tx.wallet_address || null,
        txHash: tx.tx_hash || null,
        explorerUrl: tx.explorer_url || null,
        provider: tx.provider || null,
        reference: tx.reference || null,
        assetLabel,
        billType,
        summaryAmount,
      };
    });

  return {
    rangeDays: days,
    generatedAt: new Date().toISOString(),
    totals: {
      wallets: wallets.length,
      transactions: uniqueTransactions.length,
      completedTransactions: completedCount,
      volumeUsd,
      feeUsd,
      uptodownDownloads: latestDownloads.uptodown?.downloadCount || 0,
      websiteDownloads: websiteDownloadCount,
      totalDownloads,
      androidDownloads:
        latestDownloads.apk?.downloadCount ??
        latestDownloads.website?.downloadCount ??
        latestDownloads.uptodown?.downloadCount ??
        0,
      swap: categoryTotals.swap,
      bridge: categoryTotals.bridge,
      xchangeBuy: categoryTotals['xchange-buy'],
      xchangeSell: categoryTotals['xchange-sell'],
      bills: categoryTotals.bills,
    },
    series: {
      walletsByDay: toSeries(walletsByDay),
      transactionsByDay: toSeries(txByDay),
      volumeUsdByDay: toSeries(volumeByDay),
      feeUsdByDay: toSeries(feesByDay),
      swapByDay: toSeries(categoryDayCounts.swap),
      bridgeByDay: toSeries(categoryDayCounts.bridge),
      xchangeBuyByDay: toSeries(categoryDayCounts['xchange-buy']),
      xchangeSellByDay: toSeries(categoryDayCounts['xchange-sell']),
      billsByDay: toSeries(categoryDayCounts.bills),
      swapVolumeByDay: toSeries(categoryDayVolume.swap),
      bridgeVolumeByDay: toSeries(categoryDayVolume.bridge),
      xchangeBuyVolumeByDay: toSeries(categoryDayVolume['xchange-buy']),
      xchangeSellVolumeByDay: toSeries(categoryDayVolume['xchange-sell']),
      billsVolumeByDay: toSeries(categoryDayVolume.bills),
      activityBreakdown,
    },
    breakdowns: {
      categories: toPie(categoryCounts),
      statuses: toPie(statusCounts),
      networks: toPie(networkCounts),
      walletSources: toPie(sourceCounts),
      xchangeModes: toPie(xchangeModeCounts),
    },
    recentTransactions,
    downloads: {
      latestBySource: Object.values(latestDownloads),
      history: downloads
        .slice()
        .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
        .map((row) => ({
          source: row.source,
          downloadCount: Number(row.download_count) || 0,
          deltaCount: row.delta_count == null ? null : Number(row.delta_count),
          recordedAt: row.recorded_at,
          appUrl: row.app_url || null,
        })),
    },
  };
}

async function buildAnalyticsDashboardSummary(days) {
  const since = startOfUtcDay(days - 1);
  const [wallets, transactions, downloads, paycrestFeeUsd] = await Promise.all([
    querySupabase(`doxa_wallet_creations?select=wallet_address,source,platform,app_version,created_at,client_created_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc`),
    querySupabase(`doxa_wallet_transactions?select=event_id,wallet_address,tx_hash,category,status,direction,network_id,network_label,token_symbol,amount_text,amount_numeric,amount_usd,platform_fee_text,platform_fee_usd,provider,reference,explorer_url,occurred_at,metadata&occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.asc`),
    querySupabase('doxa_app_downloads?select=source,download_count,delta_count,app_url,recorded_at,metadata&order=recorded_at.desc&limit=200'),
    fetchPaycrestSenderFeesSince(since).catch((error) => {
      console.warn('Paycrest fee reconciliation skipped', error?.message || error);
      return null;
    }),
  ]);

  const summary = aggregateDashboardMetrics({
    wallets: Array.isArray(wallets) ? wallets : [],
    transactions: Array.isArray(transactions) ? transactions : [],
    downloads: Array.isArray(downloads) ? downloads : [],
    days,
  });

  return reconcileDashboardPaycrestFees(summary, paycrestFeeUsd);
}

function parseUptodownDownloadCount(html) {
  const patterns = [
    /itemprop=["']interactionCount["'][^>]*content=["'](?:UserDownloads|Downloads):(\d+)/i,
    /"userInteractionCount"\s*:\s*"?(\d+)"?/i,
    /data-downloads=["'](\d+)["']/i,
    /<span>\s*(\d[\d,]*)\s*<\/span>\s*<span>\s*downloads/i,
    /(\d[\d,]*)\s*(?:downloads|descargas)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const count = Number(String(match[1]).replace(/,/g, ''));
    if (Number.isFinite(count) && count >= 0) return count;
  }

  return null;
}

async function fetchUptodownDownloadCount(appUrl) {
  const response = await fetch(appUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'DoxaWalletAnalytics/1.0',
    },
  });
  const html = await response.text();
  if (!response.ok) {
    throw new HttpError(502, 'uptodown_fetch_failed', `Unable to fetch Uptodown page (${response.status}).`);
  }

  const downloadCount = parseUptodownDownloadCount(html);
  if (downloadCount == null) {
    throw new HttpError(502, 'uptodown_parse_failed', 'Could not parse download count from the Uptodown page. Record the count manually.');
  }

  return downloadCount;
}

async function recordAppDownloadSnapshot({ source, downloadCount, appUrl, metadata = {} }) {
  const previousRows = await querySupabase(
    `doxa_app_downloads?select=download_count,recorded_at&source=eq.${encodeURIComponent(source)}&order=recorded_at.desc&limit=1`,
  );
  const previousCount = Array.isArray(previousRows) && previousRows[0] ? Number(previousRows[0].download_count) : null;
  const deltaCount = previousCount == null || !Number.isFinite(previousCount) ? null : downloadCount - previousCount;

  return upsertSupabaseRecord(
    'doxa_app_downloads',
    {
      id: randomUUID(),
      source,
      download_count: downloadCount,
      delta_count: deltaCount,
      app_url: appUrl || undefined,
      recorded_at: new Date().toISOString(),
      metadata,
    },
    'id',
  );
}

async function incrementAndroidDownloadCount(metadata = {}) {
  const previousRows = await querySupabase(
    'doxa_app_downloads?select=download_count&source=eq.apk&order=recorded_at.desc&limit=1',
  );
  const previousCount = Array.isArray(previousRows) && previousRows[0] ? Number(previousRows[0].download_count) : 0;
  const nextCount = (Number.isFinite(previousCount) ? previousCount : 0) + 1;

  return recordAppDownloadSnapshot({
    source: 'apk',
    downloadCount: nextCount,
    appUrl: config.androidApkUrl,
    metadata: {
      method: 'completed_transfer',
      ...metadata,
    },
  });
}

async function handleAndroidApkDownload(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'method_not_allowed', 'Use GET to download the Android APK.');
  }

  if (!config.androidApkUrl) {
    throw new HttpError(503, 'apk_not_configured', 'Set DOXA_ANDROID_APK_URL on the backend.');
  }

  // Range / partial requests are resume helpers, not completed installs.
  if (req.headers.range) {
    throw new HttpError(416, 'range_not_supported', 'Partial downloads are not supported. Retry the full APK download.');
  }

  const upstream = await fetch(config.androidApkUrl, {
    method: req.method,
    headers: {
      Accept: 'application/vnd.android.package-archive,application/octet-stream,*/*',
      'User-Agent': 'DoxaWalletDownloadProxy/1.0',
    },
    redirect: 'follow',
  });

  if (!upstream.ok) {
    throw new HttpError(502, 'apk_fetch_failed', `Unable to fetch the Android build (${upstream.status}).`);
  }

  const contentLengthHeader = upstream.headers.get('content-length');
  const expectedBytes = contentLengthHeader ? Number(contentLengthHeader) : null;
  const contentType = upstream.headers.get('content-type') || 'application/vnd.android.package-archive';
  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': 'attachment; filename="doxa-wallet.apk"',
    'Cache-Control': 'no-store',
  };

  if (Number.isFinite(expectedBytes) && expectedBytes > 0) {
    headers['Content-Length'] = String(expectedBytes);
  }

  setCors(req, res);

  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  if (!upstream.body) {
    throw new HttpError(502, 'apk_fetch_failed', 'The Android build response had no body.');
  }

  res.writeHead(200, headers);

  let transferredBytes = 0;
  let clientAborted = false;

  const onClientClose = () => {
    if (!res.writableEnded) {
      clientAborted = true;
    }
  };
  req.on('aborted', onClientClose);
  res.on('close', onClientClose);

  const upstreamStream = Readable.fromWeb(upstream.body);
  upstreamStream.on('data', (chunk) => {
    transferredBytes += chunk.length;
  });

  try {
    await pipeline(upstreamStream, res);
  } catch (error) {
    clientAborted = true;
    if (!res.headersSent) {
      throw error;
    }
    console.warn('Android APK download stream ended early', {
      transferredBytes,
      expectedBytes,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  } finally {
    req.off('aborted', onClientClose);
    res.off('close', onClientClose);
  }

  const transferLooksComplete =
    !clientAborted &&
    res.writableEnded &&
    (expectedBytes == null ||
      !Number.isFinite(expectedBytes) ||
      expectedBytes <= 0 ||
      transferredBytes >= expectedBytes * 0.99);

  if (!transferLooksComplete) {
    console.warn('Android APK download incomplete; not counted', {
      transferredBytes,
      expectedBytes,
      clientAborted,
    });
    return;
  }

  try {
    await incrementAndroidDownloadCount({
      transferredBytes,
      expectedBytes,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 180) : undefined,
    });
  } catch (error) {
    console.error('Failed to record completed Android download', error);
  }
}

async function handleAnalyticsProxy(req, res, url) {
  assertCors(req);
  const segments = getAnalyticsRouteSegments(url);

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'health') {
    sendJson(req, res, 200, {
      status: 'ok',
      service: 'doxa-analytics-proxy',
      configured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
      dashboardConfigured: Boolean(config.analyticsDashboardSecret),
      uptodownConfigured: Boolean(config.uptodownAppUrl),
    });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'dashboard') {
    assertAnalyticsDashboardAccess(req);
    const days = parseAnalyticsDays(url.searchParams.get('days'), 30);
    const summary = await buildAnalyticsDashboardSummary(days);
    sendJson(req, res, 200, { status: 'ok', data: summary });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'downloads') {
    assertAnalyticsDashboardAccess(req);
    const rows = await querySupabase('doxa_app_downloads?select=*&order=recorded_at.desc&limit=100');
    sendJson(req, res, 200, { status: 'ok', data: rows });
    return;
  }

  if (req.method === 'POST' && segments.length === 1 && segments[0] === 'downloads') {
    assertAnalyticsDashboardAccess(req);
    const body = await readJson(req);
    const source = sanitizeAnalyticsEnum(body.source, new Set(['uptodown', 'play_store', 'app_store', 'apk', 'website', 'other']), 'apk');
    const downloadCountRaw = body.downloadCount ?? body.download_count ?? body.count;
    const downloadCount = Number(String(downloadCountRaw ?? '').replace(/,/g, ''));
    if (!Number.isInteger(downloadCount) || downloadCount < 0) {
      throw new HttpError(400, 'invalid_analytics_payload', 'downloadCount must be a non-negative integer.');
    }

    const payload = await recordAppDownloadSnapshot({
      source,
      downloadCount,
      appUrl: sanitizeAnalyticsString(body.appUrl || body.app_url || config.uptodownAppUrl, 260),
      metadata: sanitizeAnalyticsMetadata(body.metadata),
    });
    sendJson(req, res, 200, { status: 'ok', data: payload });
    return;
  }

  if (req.method === 'POST' && segments.length === 2 && segments[0] === 'downloads' && segments[1] === 'sync-uptodown') {
    assertAnalyticsDashboardAccess(req);
    const body = await readJson(req).catch(() => ({}));
    const appUrl = sanitizeAnalyticsString(body.appUrl || body.app_url || config.uptodownAppUrl, 260);
    if (!appUrl) {
      throw new HttpError(400, 'uptodown_url_missing', 'Set DOXA_UPTODOWN_APP_URL or pass appUrl in the request body.');
    }

    const downloadCount = await fetchUptodownDownloadCount(appUrl);
    const payload = await recordAppDownloadSnapshot({
      source: 'uptodown',
      downloadCount,
      appUrl,
      metadata: { syncedAt: new Date().toISOString(), method: 'page_parse' },
    });
    sendJson(req, res, 200, { status: 'ok', data: payload, downloadCount });
    return;
  }

  if (req.method === 'GET' && segments.length === 0) {
    sendJson(req, res, 200, {
      status: 'ok',
      message: 'Doxa analytics endpoint is active.',
      routes: [
        'GET /analytics/health',
        'GET /analytics/dashboard',
        'GET /analytics/downloads',
        'POST /analytics/downloads',
        'POST /analytics/downloads/sync-uptodown',
        'POST /analytics/wallets',
        'POST /analytics/transactions',
      ],
    });
    return;
  }

  if (req.method === 'POST' && segments.length === 1 && segments[0] === 'wallets') {
    const record = sanitizeWalletAnalyticsBody(await readJson(req));
    const payload = await upsertSupabaseRecord('doxa_wallet_creations', record, 'wallet_address');
    sendJson(req, res, 200, { status: 'ok', data: payload });
    return;
  }

  if (req.method === 'POST' && segments.length === 1 && segments[0] === 'transactions') {
    const record = sanitizeTransactionAnalyticsBody(await readJson(req));
    const payload = await upsertSupabaseRecord('doxa_wallet_transactions', record, 'event_id');
    sendJson(req, res, 200, { status: 'ok', data: payload });
    return;
  }

  throw new HttpError(404, 'not_found', 'Analytics route not found.');
}

function getNotificationsRouteSegments(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] === 'api') segments.shift();
  if (segments[0] === 'notifications') segments.shift();
  return segments;
}

function assertNotificationsRunnerSecret(req) {
  if (!config.notificationsCronSecret) {
    throw new HttpError(500, 'notifications_runner_not_configured', 'Set DOXA_NOTIFICATIONS_CRON_SECRET on the backend.');
  }

  const headerValue = String(req.headers['x-doxa-notifications-cron-secret'] || '');
  const expected = Buffer.from(config.notificationsCronSecret);
  const actual = Buffer.from(headerValue);

  if (!headerValue || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new HttpError(403, 'notifications_runner_forbidden', 'Invalid cron secret for Doxa notifications runner.');
  }
}

function sanitizeNotificationString(value) {
  return String(value || '').trim();
}

async function sendExpoPushNotification(message) {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  const payload = await readResponseJson(response);
  if (!response.ok) {
    console.error('Expo push notification failed', { status: response.status, payload, message });
    throw new HttpError(502, 'expo_push_failed', 'Failed to send push notification through Expo.');
  }

  return payload;
}

async function handleNotificationsProxy(req, res, url) {
  assertCors(req);
  const segments = getNotificationsRouteSegments(url);

  if (req.method === 'POST' && segments.length === 2 && segments[0] === 'price-alerts' && segments[1] === 'register') {
    const body = await readJson(req);
    const expoPushToken = sanitizeNotificationString(body.expoPushToken);
    if (!expoPushToken) {
      throw new HttpError(400, 'invalid_request', 'expoPushToken is required.');
    }

    const rawTokens = Array.isArray(body.tokens) ? body.tokens : [];
    const tokens = rawTokens
      .map((token) => {
        if (!token || typeof token !== 'object') return null;
        const currentPrice = Number(token.currentPrice);
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

        const previousPrice = Number(token.previousPrice);
        return {
          tokenId: sanitizeNotificationString(token.tokenId),
          symbol: sanitizeNotificationString(token.symbol),
          name: sanitizeNotificationString(token.name),
          networkId: sanitizeNotificationString(token.networkId),
          networkLabel: sanitizeNotificationString(token.networkLabel),
          tokenAddress: sanitizeNotificationString(token.tokenAddress).toLowerCase() || undefined,
          currentPrice,
          previousPrice: Number.isFinite(previousPrice) && previousPrice > 0 ? previousPrice : currentPrice,
          priceLabel: sanitizeNotificationString(token.priceLabel),
        };
      })
      .filter(Boolean);

    const record = {
      expo_push_token: expoPushToken,
      wallet_address: sanitizeNotificationString(body.walletAddress),
      platform: sanitizeNotificationString(body.platform),
      app_version: sanitizeNotificationString(body.appVersion),
      // Background scanner always prices in USD.
      currency: 'USD',
      tokens,
      enabled: true,
      last_registered_at: new Date().toISOString(),
      last_updated_at: new Date().toISOString(),
    };

    const payload = await upsertSupabaseRecord('doxa_notification_devices', record, 'expo_push_token');
    sendJson(req, res, 200, { status: 'ok', data: payload, tokenCount: tokens.length });
    return;
  }

  if (req.method === 'POST' && segments.length === 2 && segments[0] === 'devices' && segments[1] === 'disable') {
    const body = await readJson(req);
    const expoPushToken = sanitizeNotificationString(body.expoPushToken);
    if (!expoPushToken) {
      throw new HttpError(400, 'invalid_request', 'expoPushToken is required.');
    }

    const record = {
      expo_push_token: expoPushToken,
      wallet_address: sanitizeNotificationString(body.walletAddress),
      enabled: false,
      last_updated_at: new Date().toISOString(),
    };

    const payload = await upsertSupabaseRecord('doxa_notification_devices', record, 'expo_push_token');
    sendJson(req, res, 200, { status: 'ok', data: payload });
    return;
  }

  if (req.method === 'POST' && segments.length === 2 && segments[0] === 'price-alerts' && segments[1] === 'run') {
    assertNotificationsRunnerSecret(req);
    const { runPriceAlertScan } = await import('./price-alerts-runner.js');
    const result = await runPriceAlertScan();
    sendJson(req, res, 200, { status: 'ok', data: result ?? { ok: true } });
    return;
  }

  if (req.method === 'POST' && segments.length === 2 && segments[0] === 'price-alerts' && segments[1] === 'dispatch') {
    assertNotificationsRunnerSecret(req);
    const body = await readJson(req);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
      throw new HttpError(400, 'invalid_request', 'Expected an array of Expo push messages.');
    }

    const results = await Promise.all(messages.map(async (message) => {
      const payload = {
        to: sanitizeNotificationString(message.to),
        title: sanitizeNotificationString(message.title),
        body: sanitizeNotificationString(message.body),
        data: message.data || {},
        sound: 'default',
        priority: 'high',
        ...(message.channelId ? { channelId: sanitizeNotificationString(message.channelId) } : {}),
      };
      return sendExpoPushNotification(payload);
    }));

    sendJson(req, res, 200, { status: 'ok', delivered: results.length, results });
    return;
  }

  throw new HttpError(404, 'not_found', 'Notifications route not found.');
}
function handleError(req, res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'internal_error';
  const message = error instanceof HttpError ? error.message : 'Something went wrong.';
  const details = error instanceof HttpError ? error.details : undefined;
  if (status >= 500) console.error(error);
  sendJson(req, res, status, { error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const isHealthRoute = url.pathname === '/health' || url.pathname === '/api/health';
    const isAndroidDownloadRoute =
      url.pathname === '/download/android' ||
      url.pathname === '/api/download/android' ||
      url.pathname === '/downloads/android' ||
      url.pathname === '/api/downloads/android';
    const isRailsRoute = url.pathname === '/rails' || url.pathname.startsWith('/rails/') || url.pathname === '/api/rails' || url.pathname.startsWith('/api/rails/');
    const isPaycrestRoute = url.pathname === '/paycrest' || url.pathname.startsWith('/paycrest/') || url.pathname === '/api/paycrest' || url.pathname.startsWith('/api/paycrest/');
    const isOnboardRoute = url.pathname === '/onboard' || url.pathname.startsWith('/onboard/') || url.pathname === '/api/onboard' || url.pathname.startsWith('/api/onboard/');
    const isSogoRoute = url.pathname === '/sogo' || url.pathname.startsWith('/sogo/') || url.pathname === '/api/sogo' || url.pathname.startsWith('/api/sogo/');
    const isAnalyticsRoute = url.pathname === '/analytics' || url.pathname.startsWith('/analytics/') || url.pathname === '/api/analytics' || url.pathname.startsWith('/api/analytics/');
    const isNotificationsRoute = url.pathname === '/notifications' || url.pathname.startsWith('/notifications/') || url.pathname === '/api/notifications' || url.pathname.startsWith('/api/notifications/');
    const isMarketRoute = url.pathname === '/market' || url.pathname.startsWith('/market/') || url.pathname === '/api/market' || url.pathname.startsWith('/api/market/');
    const isHistoryRoute = url.pathname === '/history' || url.pathname.startsWith('/history/') || url.pathname === '/api/history' || url.pathname.startsWith('/api/history/');

    if (req.method === 'OPTIONS') {
      assertCors(req);
      setCors(req, res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && isHealthRoute) {
      sendJson(req, res, 200, { status: 'ok', service: 'doxa-backend' });
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && isAndroidDownloadRoute) {
      await handleAndroidApkDownload(req, res);
      return;
    }

    if (req.method === 'GET' && trySendLegalPage(req, res, url.pathname)) {
      return;
    }

    if (isRailsRoute) {
      await handleRailsProxy(req, res, url);
      return;
    }

    if (isPaycrestRoute) {
      await handlePaycrestProxy(req, res, url);
      return;
    }

    if (isOnboardRoute) {
      await handleOnboardProxy(req, res, url);
      return;
    }

    if (isSogoRoute) {
      await handleSogoProxy(req, res, url);
      return;
    }

    if (isAnalyticsRoute) {
      await handleAnalyticsProxy(req, res, url);
      return;
    }

    if (isNotificationsRoute) {
      await handleNotificationsProxy(req, res, url);
      return;
    }

    if (isMarketRoute) {
      await handleMarketProxy(req, res, url);
      return;
    }

    if (isHistoryRoute) {
      await handleHistoryProxy(req, res, url);
      return;
    }

    throw new HttpError(404, 'not_found', 'Route not found.');
  } catch (error) {
    handleError(req, res, error);
  }
}

export default handleRequest;

const PRICE_ALERT_SCAN_INTERVAL_MS = 5 * 60 * 1000;
let priceAlertScanInFlight = false;

const scheduleBackgroundPriceAlertScans = () => {
  if (!config.notificationsCronSecret || process.env.VERCEL) {
    return;
  }

  const runScheduledScan = async () => {
    if (priceAlertScanInFlight) return;
    priceAlertScanInFlight = true;
    try {
      const { runPriceAlertScan } = await import('./price-alerts-runner.js');
      await runPriceAlertScan();
    } catch (error) {
      console.warn('Scheduled price alert scan failed', error instanceof Error ? error.message : error);
    } finally {
      priceAlertScanInFlight = false;
    }
  };

  // Initial delay so the server can finish bootstrapping before the first scan.
  setTimeout(() => {
    void runScheduledScan();
    setInterval(() => {
      void runScheduledScan();
    }, PRICE_ALERT_SCAN_INTERVAL_MS);
  }, 45_000);
};

if (!process.env.VERCEL && process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer(handleRequest);
  // APK proxy transfers can take several minutes on slow mobile networks.
  server.requestTimeout = 0;
  server.headersTimeout = 120000;
  server.timeout = 0;
  server.listen(config.port, () => {
    console.log(`Doxa backend listening on http://localhost:${config.port}`);
    scheduleBackgroundPriceAlertScans();
  });
}