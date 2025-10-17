export async function onRequestPost(context) {
  const { env, request } = context;
  const stripeSecret = env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return jsonResponse({ error: 'Stripe secret key not configured.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (_error) {
    body = null;
  }

  const gameId = body?.gameId;
  const accessToken = body?.accessToken;

  if (!gameId || !accessToken) {
    return jsonResponse({ error: 'Missing gameId or accessToken' }, 400);
  }

  const user = await fetchSupabaseUser(env, accessToken);
  if (!user) {
    return jsonResponse({ error: 'Invalid Supabase session' }, 401);
  }

  const game = await fetchGame(env, gameId);
  if (!game) {
    return jsonResponse({ error: 'Game not found' }, 404);
  }

  try {
    const session = await createStripeCheckoutSession({ env, user, game, request, stripeSecret });
    return jsonResponse({ sessionId: session.id }, 200);
  } catch (error) {
    console.error('Stripe checkout error', error);
    return jsonResponse({ error: 'Failed to create Stripe checkout session' }, 502);
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function fetchSupabaseUser(env, accessToken) {
  const url = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return null;
  }

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function fetchGame(env, gameId) {
  const url = env.SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !(serviceRole || anonKey)) {
    return null;
  }

  const headers = {
    apikey: serviceRole || anonKey,
    Authorization: `Bearer ${serviceRole || anonKey}`
  };

  const params = new URLSearchParams({ id: `eq.${gameId}`, select: 'id,name,price_cents,currency' });
  const response = await fetch(`${url}/rest/v1/games?${params.toString()}`, { headers });
  if (!response.ok) {
    console.error('Failed to fetch game', await response.text());
    return null;
  }

  const [game] = await response.json();
  return game || null;
}

async function createStripeCheckoutSession({ env, user, game, request, stripeSecret }) {
  const params = new URLSearchParams();
  const origin = env.BASE_URL || new URL(request.url).origin;

  params.append('mode', 'payment');
  params.append('success_url', `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${origin}/?canceled=1`);
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
      Authorization: `Bearer ${stripeSecret}`,
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
