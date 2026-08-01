// Worker: claim queue rows, dispatch to backend, mark complete
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISPATCH_ENDPOINT = (process.env.DOXA_NOTIFICATIONS_DISPATCH_ENDPOINT || process.env.EXPO_PUBLIC_DOXA_NOTIFICATIONS_ENDPOINT || 'http://localhost:8787/notifications').replace(/\/+$/, '');
const CRON_SECRET = process.env.DOXA_NOTIFICATIONS_CRON_SECRET;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !CRON_SECRET) {
  console.error('Missing required env vars. Ensure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DOXA_NOTIFICATIONS_CRON_SECRET are set.');
  process.exitCode = 1;
  process.exit();
}

const supabaseRpc = async (fnName, body = {}) => {
  const url = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${fnName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase RPC ${fnName} failed: ${res.status} ${text}`);
  }

  return res.json();
};

const dispatchToBackend = async (payload) => {
  const url = `${DISPATCH_ENDPOINT}/price-alerts/dispatch`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DOXA-NOTIFICATIONS-CRON-SECRET': CRON_SECRET,
    },
    body: JSON.stringify({ payload }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dispatch endpoint failed: ${res.status} ${text}`);
  }

  return res.text();
};

async function run() {
  let processed = 0;

  while (true) {
    // Claim one row
    const claimed = await supabaseRpc('claim_doxa_price_alerts_dispatch', {});
    if (!Array.isArray(claimed) || claimed.length === 0) {
      if (processed === 0) console.log('No dispatch items found.');
      break;
    }

    const row = claimed[0];
    console.log('Processing dispatch id=', row.id);

    try {
      await dispatchToBackend(row.payload || {});
      await supabaseRpc('complete_doxa_price_alerts_dispatch', { dispatch_id: row.id });
      console.log('Dispatched and completed id=', row.id);
      processed += 1;
    } catch (err) {
      console.error('Failed to process id=', row.id, err instanceof Error ? err.message : err);
      // Do not mark complete so it can be retried later
      break;
    }
  }

  return processed;
}

run()
  .then((count) => {
    console.log(`Worker finished. processed=${count}`);
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error('Worker failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
