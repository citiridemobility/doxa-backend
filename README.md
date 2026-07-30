# Doxa Backend

This backend proxies provider calls that must not expose secret API keys in the Expo app.

## Paycrest Xchange Buy/Sell

Flow:

```txt
Doxa app -> /paycrest/currencies, /paycrest/institutions, /paycrest/tokens, /paycrest/rates
Doxa app -> POST /paycrest/verify-account -> account name lookup
Buy:  Doxa app -> POST /paycrest/orders -> generated fiat payment instructions
Sell: Doxa app -> POST /paycrest/orders -> generated stablecoin receive address
Sell: Doxa wallet sends stablecoin to the receive address and passes the user wallet as refundAddress
Doxa app -> GET /paycrest/orders/:id -> poll payout/refund status
```

For sell orders, the user's wallet address is sent as `source.refundAddress`. If payout cannot be completed after the user has sent funds, the order can refund crypto back to that source wallet according to the provider's order status flow.


## Sogo Bills

Flow:

```txt
Doxa app -> GET /sogo/bills/catalog and /sogo/bills/data-plans
Doxa app -> GET /sogo/bills/quote?amount=500&asset=USDC -> signed stablecoin quote
Doxa wallet sends quoted USDC or USDT plus the Doxa platform fee to the configured treasury wallet
Doxa app -> POST /sogo/bills/pay -> backend verifies the stablecoin transfer on-chain, then submits the bill payment
```

Required backend env:

```env
SOGO_API_BASE_URL=https://api.sogo.africa/v1
SOGO_API_KEY=your_sogo_secret_api_key
SOGO_BILLS_QUOTE_SECRET=your_long_random_quote_secret
SOGO_BILLS_TREASURY_ADDRESS=your_stablecoin_collection_wallet
# Optional fallbacks used only when the live stablecoin/NGN quote endpoint is unavailable.
SOGO_BILLS_STABLE_NGN_RATE=1500
SOGO_BILLS_USDC_NGN_RATE=1500
SOGO_BILLS_USDT_NGN_RATE=1500
# Optional RPC overrides for on-chain payment verification.
SOGO_BILLS_RPC_BNB_CHAIN_URL=https://...
SOGO_BILLS_RPC_ETHEREUM_URL=https://...
SOGO_BILLS_RPC_BASE_URL=https://...
SOGO_BILLS_RPC_ARBITRUM_URL=https://...
```

The Sogo API key needs `bills:read`, `bills:write`, and `crypto:read` scopes for live quoting and bill payment. Bills payments support USDC and USDT on BNB Chain, Ethereum, Base, and Arbitrum. If `crypto:read` is not enabled yet, set `SOGO_BILLS_STABLE_NGN_RATE` or the asset-specific fallback rate so the backend can still quote Bills orders.

Expo app env:

```env
EXPO_PUBLIC_SOGO_BILLS_ENDPOINT=https://your-backend-domain/sogo
EXPO_PUBLIC_DOXA_BILLS_TREASURY_ADDRESS=your_stablecoin_collection_wallet
```

## Market Charts Proxy

The token details chart should call the Doxa backend instead of CoinGecko/GeckoTerminal directly from the app. This avoids browser CORS failures, keeps API keys server-side, and centralizes rate-limit caching.

Routes:

```txt
GET /market/health
GET /market/charts?symbol=CROSS&networkId=bnb-chain&contractAddress=0x...&range=1D&currency=usd&evmChainId=56
GET /market/token-prices?platformId=binance-smart-chain&contractAddresses=0x...,0x...&currency=usd
```

Backend env:

```env
# Optional but recommended for better rate limits.
COINGECKO_API_KEY=your_coingecko_demo_key
COINGECKO_PRO_API_KEY=your_coingecko_pro_key
# Optional provider URL overrides.
COINGECKO_PUBLIC_API_BASE_URL=https://api.coingecko.com/api/v3
COINGECKO_PRO_API_BASE_URL=https://pro-api.coingecko.com/api/v3
GECKOTERMINAL_API_BASE_URL=https://api.geckoterminal.com/api/v2
DEXSCREENER_API_BASE_URL=https://api.dexscreener.com
```

Expo app env:

```env
# Optional. If omitted, the app derives /market from the configured Doxa backend endpoint, e.g. /paycrest or /sogo.
EXPO_PUBLIC_MARKET_DATA_ENDPOINT=https://your-backend-domain/market
```
## Transaction History Proxy

The app can fetch transaction history through the Doxa backend so browser origin restrictions do not block Alchemy RPC calls.

Routes:

```txt
GET /history/health
GET /history/alchemy-transfers?walletAddress=0x...&networkId=bnb-chain
```

Backend env:

```env
ALCHEMY_API_KEY=your_alchemy_api_key
```

Expo app env:

```env
# Optional. If omitted, the app derives /history from the configured Doxa backend endpoint, e.g. /paycrest, /sogo, or /market.
EXPO_PUBLIC_TRANSACTION_HISTORY_ENDPOINT=https://your-backend-domain/history
```
## Supabase Metrics Analytics

Run `backend/supabase/doxa_metrics_schema.sql` in the Supabase SQL editor before enabling the analytics endpoint. The schema stores wallet creation events and sanitized transaction metrics for swaps, bridges, Xchange, Bills, sends, and token transfers.

Required backend env:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

Expo app env:

```env
EXPO_PUBLIC_DOXA_ANALYTICS_ENDPOINT=https://your-backend-domain/analytics
```

Routes:

```txt
GET  /analytics/health
POST /analytics/wallets
POST /analytics/transactions
```

Only non-custodial metrics are sent. The app never sends seed phrases, private keys, wallet passwords, biometric data, or raw authentication material to the backend. RLS is enabled on the metrics tables; `anon` and `authenticated` are revoked, and only the backend `service_role` can insert/update/read metrics through explicit policies.

## Local
```bash
npm run backend
```

Set the Expo app endpoint:

```env
EXPO_PUBLIC_PAYCREST_XCHANGE_ENDPOINT=http://localhost:8787/paycrest
```

Existing app env files can keep `EXPO_PUBLIC_PAYCREST_ONRAMP_ENDPOINT`; the app uses it as a fallback. For a physical phone on the same Wi-Fi, use your computer LAN IP instead of localhost.

## Required Backend Env

```env
PAYCREST_API_BASE_URL=https://api.paycrest.io/v2
# The backend normalizes https://api.paycrest.io and /v1 values to Paycrest v2, but production should still use /v2 explicitly.
PAYCREST_API_KEY=your_paycrest_api_key
DOXA_BACKEND_ALLOWED_ORIGINS=*
```

Do not paste env keys with wrapping quotes or the variable name in the value field. In Vercel/Railway, the `PAYCREST_API_KEY` value should be only the raw key string, not `PAYCREST_API_KEY=...` and not `"..."`.

## Legacy Rails Routes

The backend still contains legacy `/rails/*` proxy routes, but the current Xchange buy and sell UI uses `/paycrest/*`.

## Deploy To Vercel

Deploy the `backend` folder as the Vercel project root, then set the backend env values above in the Vercel project settings.

Health check:

```bash
curl https://your-vercel-project.vercel.app/health
```

Expo production endpoint:

```env
EXPO_PUBLIC_PAYCREST_XCHANGE_ENDPOINT=https://your-vercel-project.vercel.app/paycrest
```

Restart/rebuild the Expo app so the public env values are bundled.