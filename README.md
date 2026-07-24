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