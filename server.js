const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PUBLIC_DIR = path.resolve(path.join(__dirname, 'public'));
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

loadLocalEnv();

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = url.parse(req.url);
    if (req.method === 'GET' && parsedUrl.pathname === '/env.js') {
      return serveEnv(res);
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/api/create-checkout-session') {
      return await handleCreateCheckoutSession(req, res);
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/webhook') {
      return await handleStripeWebhook(req, res);
    }

    return serveStatic(req, res, parsedUrl.pathname);
  } catch (error) {
    console.error('Unexpected server error', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`SaturnGames server listening on http://localhost:${PORT}`);
});

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  content.split(/\r?\n/).forEach((line) => {
    if (!line || line.trim().startsWith('#')) {
      return;
    }
    const idx = line.indexOf('=');
    if (idx === -1) {
      return;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function serveEnv(res) {
  const clientEnv = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    STRIPE_PUBLISHABLE_KEY,
    BASE_URL
  };

  res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
  res.end(`window.__ENV = ${JSON.stringify(clientEnv)};`);
}

async function handleCreateCheckoutSession(req, res) {
  if (!STRIPE_SECRET_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Stripe secret key not configured.' }));
  }

  const body = await readJsonBody(req);
  const { gameId, accessToken } = body || {};

  if (!gameId || !accessToken) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing gameId or accessToken' }));
  }

  const user = await fetchSupabaseUser(accessToken);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid Supabase session' }));
  }

  const game = await fetchGame(gameId);
  if (!game) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Game not found' }));
  }

  try {
    const session = await createStripeCheckoutSession({ user, game });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessionId: session.id }));
  } catch (error) {
    console.error('Stripe checkout error', error);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to create Stripe checkout session' }));
  }
}

async function handleStripeWebhook(req, res) {
  if (!STRIPE_WEBHOOK_SECRET) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Webhook secret not configured' }));
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['stripe-signature'];
  if (!signature) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing Stripe signature' }));
  }

  let event;
  try {
    event = verifyStripeSignature(rawBody, signature);
  } catch (error) {
    console.error('Invalid webhook signature', error);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid signature' }));
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      await processCompletedCheckout(session);
    } catch (error) {
      console.error('Failed to process checkout completion', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Failed to process session' }));
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ received: true }));
}

async function readJsonBody(req) {
  const data = await readRawBody(req);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', reject);
  });
}

async function fetchSupabaseUser(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function fetchGame(gameId) {
  if (!SUPABASE_URL || !(SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY)) {
    return null;
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY}`
  };

  const params = new URLSearchParams({ id: `eq.${gameId}`, select: 'id,name,price_cents,currency' });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/games?${params.toString()}`, {
    headers
  });

  if (!response.ok) {
    console.error('Failed to fetch game', await response.text());
    return null;
  }

  const [game] = await response.json();
  return game;
}

async function createStripeCheckoutSession({ user, game }) {
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${BASE_URL}/?canceled=1`);
  params.append('customer_email', user.email || '');
  params.append('metadata[user_id]', user.id);
  params.append('metadata[game_id]', game.id);
  params.append('line_items[0][price_data][currency]', game.currency || 'usd');
  params.append('line_items[0][price_data][product_data][name]', game.name);
  params.append('line_items[0][price_data][unit_amount]', `${game.price_cents}`);
  params.append('line_items[0][quantity]', '1');
  params.append('allow_promotion_codes', 'true');

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Stripe API error: ${body}`);
  }

  return response.json();
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const sigParts = signatureHeader.split(',');
  const timestampPart = sigParts.find((part) => part.startsWith('t='));
  const signaturePart = sigParts.find((part) => part.startsWith('v1='));

  if (!timestampPart || !signaturePart) {
    throw new Error('Malformed signature header');
  }

  const timestamp = timestampPart.replace('t=', '');
  const signature = signaturePart.replace('v1=', '');
  const payload = `${timestamp}.${rawBody}`;
  const computed = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(payload).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(computed, 'hex'))) {
    throw new Error('Signature mismatch');
  }

  return JSON.parse(rawBody);
}

async function processCompletedCheckout(session) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Service role key required to process checkout');
  }

  const userId = session.metadata?.user_id;
  const gameId = session.metadata?.game_id;

  if (!userId || !gameId) {
    throw new Error('Missing metadata to process checkout');
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  const existingAccess = await fetchExistingAccess(headers, userId, gameId);
  const now = new Date();
  let startDate = now.toISOString();
  let expirationDate = new Date(now);

  if (existingAccess) {
    startDate = existingAccess.start_date || startDate;
    const currentExpiration = existingAccess.expiration_date ? new Date(existingAccess.expiration_date) : null;
    if (currentExpiration && currentExpiration > now) {
      expirationDate = currentExpiration;
    }
    expirationDate.setMonth(expirationDate.getMonth() + 1);

    await fetch(`${SUPABASE_URL}/rest/v1/user_game_access?id=eq.${existingAccess.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expiration_date: expirationDate.toISOString(),
        is_active: true,
        payment_id: session.id
      })
    });
  } else {
    expirationDate.setMonth(expirationDate.getMonth() + 1);
    await fetch(`${SUPABASE_URL}/rest/v1/user_game_access`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: userId,
        game_id: gameId,
        start_date: startDate,
        expiration_date: expirationDate.toISOString(),
        payment_id: session.id,
        is_active: true
      })
    });
  }

  await fetch(`${SUPABASE_URL}/rest/v1/payment_history`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      user_id: userId,
      game_id: gameId,
      payment_session_id: session.id,
      payment_intent_id: session.payment_intent || null,
      amount_cents: session.amount_total || null,
      currency: session.currency || null,
      payment_method: session.payment_method_types ? session.payment_method_types.join(',') : null,
      payment_status: session.payment_status,
      raw_payload: session
    })
  });
}

async function fetchExistingAccess(headers, userId, gameId) {
  const params = new URLSearchParams({ user_id: `eq.${userId}`, game_id: `eq.${gameId}`, select: '*' });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/user_game_access?${params.toString()}`, {
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('Failed to read user_game_access', text);
    return null;
  }

  const [record] = await response.json();
  return record || null;
}

function serveStatic(req, res, pathname = '/') {
  const cleanedPath = path.normalize(pathname).replace(/^\.\.(\/|\\|$)/, '').replace(/^[\/]+/, '');
  let filePath = path.join(PUBLIC_DIR, cleanedPath || 'index.html');
  filePath = path.resolve(filePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Access denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }

    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Server error');
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
}
