import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
  return payload?.message || payload?.error?.message || payload?.error || payload?.errorMessage || payload?.data?.message || fallback;
}

function paycrestDetails(payload) {
  if (!payload || typeof payload !== 'object') return undefined;

  const details = payload.errors || payload.details || payload.data?.errors || payload.data?.details;
  if (details !== undefined) return details;

  const data = payload.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data).filter(([key]) => !['message', 'status'].includes(key));
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

  if (typeof body.reference === 'string' && body.reference.trim()) {
    sanitized.reference = body.reference.trim().slice(0, 128);
  }

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
const SOGO_USDC_DECIMALS = 6;
const SOGO_BILLS_PLATFORM_FEE_BPS = 50n;
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
    throw new HttpError(400, 'invalid_bills_params', 'This USDC payment network is not supported for Bills yet.');
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

function getConfiguredSogoUsdcAddress(network) {
  const address = config.sogoBillsUsdcAddresses[network];
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new HttpError(500, 'sogo_bills_usdc_not_configured', `USDC is not configured for ${network}.`);
  }
  return address.toLowerCase();
}

function getConfiguredSogoUsdcDecimals(network) {
  const decimals = config.sogoBillsUsdcDecimals[network];
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new HttpError(500, 'sogo_bills_usdc_not_configured', `USDC decimals are not configured for ${network}.`);
  }
  return decimals;
}

function decimalStringToRawUnits(value, decimals, fieldName = 'quote.usdcAmount') {
  const amount = requireSogoString(value, fieldName).replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(amount)) {
    throw new HttpError(400, 'invalid_bills_quote', 'The Bills USDC amount is invalid.');
  }

  const [wholePart, fractionalPart = ''] = amount.split('.');
  if (fractionalPart.length > decimals) {
    throw new HttpError(400, 'invalid_bills_quote', 'The Bills USDC amount precision is not supported on this network. Refresh and try again.');
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
  const billRawAmount = decimalStringToRawUnits(quote.usdcAmount, decimals);
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

function getConfiguredSogoBillsRate() {
  const numeric = getSogoNumericValue(config.sogoBillsUsdcNgnRate);
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

function getSignedQuotePayload(quote) {
  return {
    id: quote.id,
    asset: quote.asset,
    fiat: quote.fiat,
    fiatAmount: quote.fiatAmount,
    rate: quote.rate,
    usdcAmount: quote.usdcAmount,
    usdcAmountRaw: quote.usdcAmountRaw,
    decimals: quote.decimals,
    issuedAt: quote.issuedAt,
    expiresAt: quote.expiresAt,
  };
}

function signSogoBillsQuote(quote) {
  return createHmac('sha256', getSogoQuoteSigningSecret())
    .update(JSON.stringify(getSignedQuotePayload(quote)))
    .digest('hex');
}

function verifySogoBillsQuote(quote) {
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) {
    throw new HttpError(400, 'invalid_bills_quote', 'A Bills quote is required.');
  }

  const signature = requireSogoString(quote.signature, 'quote.signature', /^[a-f0-9]{64}$/i);
  const expected = signSogoBillsQuote(quote);
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new HttpError(400, 'invalid_bills_quote', 'The Bills quote is no longer valid. Refresh and try again.');
  }

  const expiresAt = Date.parse(requireSogoString(quote.expiresAt, 'quote.expiresAt'));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(400, 'expired_bills_quote', 'The Bills quote has expired. Refresh and try again.');
  }

  const usdcAmountRaw = BigInt(requireSogoString(quote.usdcAmountRaw, 'quote.usdcAmountRaw', /^[0-9]+$/));
  if (usdcAmountRaw <= 0n) {
    throw new HttpError(400, 'invalid_bills_quote', 'The Bills quote amount is invalid.');
  }

  return {
    ...getSignedQuotePayload(quote),
    signature,
  };
}

async function buildSogoBillsQuote(amount) {
  const fiatAmount = normalizeSogoAmount(amount);
  let effectiveNgnPerUsdc = 0;

  try {
    const ratePayload = await requestSogo('/crypto/assets/usdc/rate?amount=1');
    effectiveNgnPerUsdc = getSogoRateValue(ratePayload);

    if (!effectiveNgnPerUsdc) {
      console.warn('Sogo USDC rate response did not include a usable NGN rate', { ratePayload });
    }
  } catch (error) {
    console.warn('Sogo USDC rate request failed; checking configured Bills fallback rate', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (!effectiveNgnPerUsdc) {
    effectiveNgnPerUsdc = getConfiguredSogoBillsRate();
  }

  if (!effectiveNgnPerUsdc) {
    throw new HttpError(502, 'bills_quote_unavailable', 'Unable to fetch a USDC quote for this bill right now.');
  }

  const rawAmount = BigInt(Math.ceil((fiatAmount / effectiveNgnPerUsdc) * 10 ** SOGO_USDC_DECIMALS));
  const quote = {
    id: randomUUID(),
    asset: 'USDC',
    fiat: 'NGN',
    fiatAmount: formatNgnAmount(fiatAmount),
    rate: String(effectiveNgnPerUsdc),
    usdcAmount: decimalRawToString(rawAmount, SOGO_USDC_DECIMALS),
    usdcAmountRaw: rawAmount.toString(),
    decimals: SOGO_USDC_DECIMALS,
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
    throw new HttpError(502, 'bills_payment_verification_unavailable', 'Unable to verify the USDC payment on-chain right now.');
  }

  return payload.result;
}

function addressFromTopic(topic) {
  const value = String(topic || '').toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(value)) return '';
  return `0x${value.slice(-40)}`;
}

async function verifySogoBillsUsdcPayment({ payment, quote }) {
  assertSogoBillsCollectionConfigured();

  if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
    throw new HttpError(400, 'invalid_bills_payment', 'USDC payment details are required.');
  }

  const network = normalizeSogoPaymentNetwork(payment.network);
  const rpcUrl = config.sogoBillsRpcUrls[network];
  const txHash = requireSogoString(payment.txHash, 'payment.txHash', /^0x[a-fA-F0-9]{64}$/).toLowerCase();
  const walletAddress = requireSogoString(payment.walletAddress, 'payment.walletAddress', /^0x[a-fA-F0-9]{40}$/).toLowerCase();
  const tokenAddress = requireSogoString(payment.tokenAddress, 'payment.tokenAddress', /^0x[a-fA-F0-9]{40}$/).toLowerCase();
  const treasuryAddress = config.sogoBillsTreasuryAddress.toLowerCase();
  const configuredUsdcAddress = getConfiguredSogoUsdcAddress(network);

  if (tokenAddress !== configuredUsdcAddress) {
    throw new HttpError(400, 'invalid_bills_payment', 'The selected USDC token is not supported for Bills on this network.');
  }

  if (consumedSogoBillPaymentTxHashes.has(txHash)) {
    throw new HttpError(409, 'bills_payment_already_used', 'This USDC payment has already been used for a bill.');
  }

  const receipt = await requestJsonRpc(rpcUrl, 'eth_getTransactionReceipt', [txHash]);
  if (!receipt) {
    throw new HttpError(409, 'bills_payment_pending', 'The USDC payment is not confirmed yet. Wait a moment and try again.');
  }

  if (String(receipt.status).toLowerCase() !== '0x1') {
    throw new HttpError(400, 'bills_payment_failed', 'The USDC payment failed on-chain.');
  }

  const configuredDecimals = getConfiguredSogoUsdcDecimals(network);
  const { billRawAmount, platformFeeRawAmount, totalRawAmount } = getSogoBillsPaymentBreakdown(quote, configuredDecimals);
  if (payment.amount !== undefined) {
    const reportedRawAmount = decimalStringToRawUnits(String(payment.amount), configuredDecimals, 'payment.amount');
    if (reportedRawAmount < totalRawAmount) {
      throw new HttpError(400, 'bills_payment_not_found', 'Doxa could not confirm the full USDC payment for this bill and platform fee.');
    }
  }

  const matchingTransfer = (receipt.logs || []).find((log) => {
    const topics = Array.isArray(log?.topics) ? log.topics : [];
    if (String(log?.address || '').toLowerCase() !== tokenAddress) return false;
    if (String(topics[0] || '').toLowerCase() !== ERC20_TRANSFER_TOPIC) return false;
    if (addressFromTopic(topics[1]) !== walletAddress) return false;
    if (addressFromTopic(topics[2]) !== treasuryAddress) return false;

    try {
      return BigInt(log.data || '0x0') >= totalRawAmount;
    } catch {
      return false;
    }
  });

  if (!matchingTransfer) {
    throw new HttpError(400, 'bills_payment_not_found', 'Doxa could not confirm the required USDC payment for this bill.');
  }

  return {
    network,
    txHash,
    walletAddress,
    tokenAddress,
    treasuryAddress,
    amount: decimalRawToString(totalRawAmount, configuredDecimals),
    billAmount: decimalRawToString(billRawAmount, configuredDecimals),
    platformFeeAmount: decimalRawToString(platformFeeRawAmount, configuredDecimals),
    platformFeeRate: '0.5%',
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
    const quote = await buildSogoBillsQuote(url.searchParams.get('amount'));
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
    const payment = await verifySogoBillsUsdcPayment({ payment: body.payment, quote: body.quote });
    const payload = await requestSogo(body.upstreamPath, {
      method: 'POST',
      body: body.upstreamBody,
      idempotencyKey: body.idempotencyKey,
    });

    consumedSogoBillPaymentTxHashes.add(payment.txHash);

    const billPayload = payload?.data ?? payload;
    const billRecord = asSogoRecord(billPayload);
    const paymentStatus = normalizeSogoBillPaymentStatus(billRecord, payload);

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
    const isRailsRoute = url.pathname === '/rails' || url.pathname.startsWith('/rails/') || url.pathname === '/api/rails' || url.pathname.startsWith('/api/rails/');
    const isPaycrestRoute = url.pathname === '/paycrest' || url.pathname.startsWith('/paycrest/') || url.pathname === '/api/paycrest' || url.pathname.startsWith('/api/paycrest/');
    const isSogoRoute = url.pathname === '/sogo' || url.pathname.startsWith('/sogo/') || url.pathname === '/api/sogo' || url.pathname.startsWith('/api/sogo/');

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

    if (isRailsRoute) {
      await handleRailsProxy(req, res, url);
      return;
    }

    if (isPaycrestRoute) {
      await handlePaycrestProxy(req, res, url);
      return;
    }

    if (isSogoRoute) {
      await handleSogoProxy(req, res, url);
      return;
    }

    throw new HttpError(404, 'not_found', 'Route not found.');
  } catch (error) {
    handleError(req, res, error);
  }
}

export default handleRequest;

if (!process.env.VERCEL && process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer(handleRequest);
  server.listen(config.port, () => {
    console.log(`Doxa backend listening on http://localhost:${config.port}`);
  });
}