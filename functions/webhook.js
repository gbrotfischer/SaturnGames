export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ error: 'Webhook secret not configured' }, 400);
  }

  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return jsonResponse({ error: 'Missing Stripe signature' }, 400);
  }

  let event;
  try {
    event = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('Invalid webhook signature', error);
    return jsonResponse({ error: 'Invalid signature' }, 400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      await processCompletedCheckout(env, session);
    } catch (error) {
      console.error('Failed to process checkout completion', error);
      return jsonResponse({ error: 'Failed to process session' }, 500);
    }
  }

  return jsonResponse({ received: true }, 200);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parts = signatureHeader.split(',');
  const timestampPart = parts.find((part) => part.startsWith('t='));
  const signaturePart = parts.find((part) => part.startsWith('v1='));

  if (!timestampPart || !signaturePart) {
    throw new Error('Malformed signature header');
  }

  const timestamp = timestampPart.replace('t=', '');
  const signature = signaturePart.replace('v1=', '');
  const payload = `${timestamp}.${rawBody}`;
  const expectedSignature = await computeHmac(secret, payload);

  if (!timingSafeEqual(signature, expectedSignature)) {
    throw new Error('Signature mismatch');
  }

  return JSON.parse(rawBody);
}

async function computeHmac(secret, payload) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function processCompletedCheckout(env, session) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Service role key required to process checkout');
  }

  const userId = session.metadata?.user_id;
  const gameId = session.metadata?.game_id;
  if (!userId || !gameId) {
    throw new Error('Missing metadata to process checkout');
  }

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  const existingAccess = await fetchExistingAccess(env, headers, userId, gameId);
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

    await fetch(`${env.SUPABASE_URL}/rest/v1/user_game_access?id=eq.${existingAccess.id}`, {
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
    await fetch(`${env.SUPABASE_URL}/rest/v1/user_game_access`, {
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

  await fetch(`${env.SUPABASE_URL}/rest/v1/payment_history`, {
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

async function fetchExistingAccess(env, headers, userId, gameId) {
  const params = new URLSearchParams({ user_id: `eq.${userId}`, game_id: `eq.${gameId}`, select: '*' });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/user_game_access?${params.toString()}`, {
    headers
  });

  if (!response.ok) {
    console.error('Failed to read user_game_access', await response.text());
    return null;
  }

  const [record] = await response.json();
  return record || null;
}
