import { createServer } from 'node:http';
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

const config = {
  port: Number(process.env.DOXA_BACKEND_PORT || process.env.PORT || 8787),
  allowedOrigins: (process.env.DOXA_BACKEND_ALLOWED_ORIGINS || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  railsApiBaseUrl: String(process.env.RAILS_API_BASE_URL || 'https://b2b.usetapp.xyz').trim(),
  railsApiKey: String(process.env.RAILS_API_KEY || '').trim(),
  railsFeeMode: String(process.env.RAILS_FEE_MODE || '').trim().toLowerCase(),
  railsFeePercent: String(process.env.RAILS_FEE_PERCENT || '').trim(),
  railsFeeAmount: String(process.env.RAILS_FEE_AMOUNT || '').trim(),
  railsFeeAddress: String(process.env.RAILS_FEE_ADDRESS || '').trim(),
  paycrestApiBaseUrl: String(process.env.PAYCREST_API_BASE_URL || 'https://api.paycrest.io/v2').trim(),
  paycrestApiKey: String(process.env.PAYCREST_API_KEY || '').trim(),
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
    throw new HttpError(response.status, 'rails_request_failed', message);
  }

  return payload;
}

async function requestRailsRate({ network, token, amount, fiat }) {
  const encodedToken = encodeURIComponent(token);
  const encodedAmount = encodeURIComponent(amount);
  const encodedFiat = encodeURIComponent(fiat);
  const encodedNetwork = network ? encodeURIComponent(network) : '';
  const candidatePaths = network
    ? [
        `/v1/rates/${encodedNetwork}/${encodedToken}/${encodedAmount}/${encodedFiat}`,
        `/v1/rates/${encodedToken}/${encodedAmount}/${encodedFiat}?network=${encodedNetwork}`,
        `/v1/rates/${encodedToken}/${encodedAmount}/${encodedFiat}`,
      ]
    : [`/v1/rates/${encodedToken}/${encodedAmount}/${encodedFiat}`];
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

  if (typeof body.amountIn === 'string' && body.amountIn.trim()) {
    const amountIn = body.amountIn.trim().toLowerCase();
    if (amountIn !== 'fiat' && amountIn !== 'crypto') {
      throw new HttpError(400, 'invalid_paycrest_params', 'amountIn must be fiat or crypto.');
    }
    sanitized.amountIn = amountIn;
  }

  if (typeof body.rate === 'string' && body.rate.trim()) {
    sanitized.rate = normalizePaycrestAmount(body.rate, 'rate');
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
  const supportedAssets = new Set([...PAYCREST_STABLE_TOKENS, ...PAYCREST_FIAT_CURRENCIES]);

  if (!supportedAssets.has(from) || !supportedAssets.has(to)) {
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

  const isFiatToToken = PAYCREST_FIAT_CURRENCIES.has(from) && PAYCREST_STABLE_TOKENS.has(to);
  const requestFrom = isFiatToToken ? to : from;
  const requestTo = isFiatToToken ? from : to;
  const requestAmount = isFiatToToken ? '1' : amount;

  return `/rates/${encodeURIComponent(network)}/${encodeURIComponent(requestFrom)}/${encodeURIComponent(requestAmount)}/${encodeURIComponent(requestTo)}${query.toString() ? `?${query.toString()}` : ''}`;
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
    console.warn('Paycrest API request failed', {
      path,
      status: response.status,
      message: paycrestMessage(payload, 'No Paycrest error message returned.'),
    });
    throw new HttpError(
      response.status,
      'paycrest_request_failed',
      paycrestMessage(payload, 'Unable to complete Paycrest request.'),
      paycrestDetails(payload),
    );
  }

  return payload;
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
    const payload = await requestPaycrest(sanitizePaycrestRateQuery(segments, url));
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