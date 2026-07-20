# Doxa Backend

This backend proxies provider calls that must not expose secret API keys in the Expo app.

## Rails Xchange Off-ramp

Flow:

```txt
Doxa app -> /rails/currencies, /rails/institutions, /rails/rates
Doxa app -> POST /rails/verify-account -> Rails account name lookup
Doxa app -> POST /rails/orders -> Rails returns EVM Gateway createOrder params
Doxa wallet -> approve Gateway + createOrder on-chain
Doxa app -> POST /rails/orders/:orderRef/submitted -> Rails tracks payout status
```

## Paycrest Xchange On-ramp

Flow:

```txt
Doxa app -> /paycrest/currencies, /paycrest/institutions, /paycrest/tokens, /paycrest/rates
Doxa app -> POST /paycrest/verify-account -> Paycrest account name lookup
Doxa app -> POST /paycrest/orders -> Paycrest returns fiat payment instructions
User pays the returned provider account -> Paycrest settles crypto to the user's wallet
Doxa app -> GET /paycrest/orders/:id -> poll order status
```

## Local

```bash
npm run backend
```

Set the Expo app endpoints:

```env
EXPO_PUBLIC_RAILS_OFFRAMP_ENDPOINT=http://localhost:8787/rails
EXPO_PUBLIC_PAYCREST_ONRAMP_ENDPOINT=http://localhost:8787/paycrest
```

For a physical phone on the same Wi-Fi, use your computer LAN IP instead of localhost.

## Required Backend Env

```env
RAILS_API_BASE_URL=https://b2b.usetapp.xyz
RAILS_API_KEY=your_rails_api_key
PAYCREST_API_BASE_URL=https://api.paycrest.io/v2
PAYCREST_API_KEY=your_paycrest_api_key
DOXA_BACKEND_ALLOWED_ORIGINS=*
```

Optional Doxa off-ramp fee settings:

```env
RAILS_FEE_MODE=percent
RAILS_FEE_PERCENT=0.3
RAILS_FEE_ADDRESS=0xYourTreasuryAddress
```

## Deploy To Vercel

Deploy the `backend` folder as the Vercel project root, then set the backend env values above in the Vercel project settings.

Health check:

```bash
curl https://your-vercel-project.vercel.app/health
```

Expo production endpoints:

```env
EXPO_PUBLIC_RAILS_OFFRAMP_ENDPOINT=https://your-vercel-project.vercel.app/rails
EXPO_PUBLIC_PAYCREST_ONRAMP_ENDPOINT=https://your-vercel-project.vercel.app/paycrest
```

Restart/rebuild the Expo app so the public env values are bundled.
