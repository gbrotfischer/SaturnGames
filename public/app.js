import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4';

const env = window.__ENV || {};
const supabaseUrl = env.SUPABASE_URL;
const supabaseAnonKey = env.SUPABASE_ANON_KEY;
const stripePublishableKey = env.STRIPE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  showGlobalStatus('Configurações do Supabase ausentes. Defina SUPABASE_URL e SUPABASE_ANON_KEY.', 'error');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
let stripe = null;
if (stripePublishableKey && window.Stripe) {
  stripe = window.Stripe(stripePublishableKey);
}

const dom = {
  year: document.getElementById('year'),
  signupForm: document.getElementById('signup-form'),
  loginForm: document.getElementById('login-form'),
  magicLink: document.getElementById('magic-link'),
  signout: document.getElementById('signout'),
  profileSection: document.getElementById('profile'),
  profileEmail: document.getElementById('profile-email'),
  sessionStatus: document.getElementById('session-status'),
  authSection: document.getElementById('auth'),
  gamesGrid: document.getElementById('games-grid'),
  gamesStatus: document.getElementById('games-status'),
  licensesSection: document.getElementById('licenses'),
  licensesStatus: document.getElementById('licenses-status'),
  licensesList: document.getElementById('licenses-list'),
  paymentsSection: document.getElementById('payments'),
  paymentsStatus: document.getElementById('payments-status'),
  paymentsBody: document.getElementById('payments-body'),
  globalStatus: document.getElementById('global-status')
};

dom.year.textContent = new Date().getFullYear();

let currentSession = null;

async function init() {
  attachEventListeners();
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  await updateAuthState();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    await updateAuthState();
  });

  await loadGames();
}

function attachEventListeners() {
  dom.signupForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setFormDisabled(form, true);
    const email = form.email.value.trim();
    const password = form.password.value.trim();

    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      showGlobalStatus('Conta criada! Verifique seu email para confirmar o cadastro.', 'success');
      form.reset();
    } catch (error) {
      console.error(error);
      showGlobalStatus(error.message || 'Não foi possível criar a conta.', 'error');
    } finally {
      setFormDisabled(form, false);
    }
  });

  dom.loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setFormDisabled(form, true);
    const email = form.email.value.trim();
    const password = form.password.value.trim();

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      form.reset();
      showGlobalStatus('Login realizado com sucesso!', 'success');
    } catch (error) {
      console.error(error);
      showGlobalStatus(error.message || 'Não foi possível entrar.', 'error');
    } finally {
      setFormDisabled(form, false);
    }
  });

  dom.magicLink?.addEventListener('click', async () => {
    const email = prompt('Informe seu email para receber o link mágico:');
    if (!email) return;
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
      if (error) throw error;
      showGlobalStatus('Link mágico enviado! Verifique sua caixa de entrada.', 'success');
    } catch (error) {
      console.error(error);
      showGlobalStatus(error.message || 'Não foi possível enviar o link mágico.', 'error');
    }
  });

  dom.signout?.addEventListener('click', async () => {
    try {
      await supabase.auth.signOut();
      showGlobalStatus('Você saiu da conta.', 'success');
    } catch (error) {
      console.error(error);
      showGlobalStatus('Não foi possível sair agora.', 'error');
    }
  });
}

async function updateAuthState() {
  if (currentSession?.user) {
    dom.profileSection.hidden = false;
    dom.authSection.hidden = true;
    dom.licensesSection.hidden = false;
    dom.paymentsSection.hidden = false;
    dom.profileEmail.textContent = currentSession.user.email || 'Jogador';
    dom.sessionStatus.textContent = `ID do usuário: ${currentSession.user.id}`;
    await loadUserData();
  } else {
    dom.profileSection.hidden = true;
    dom.authSection.hidden = false;
    dom.licensesSection.hidden = true;
    dom.paymentsSection.hidden = true;
    dom.profileEmail.textContent = '';
    dom.sessionStatus.textContent = '';
    dom.licensesList.innerHTML = '';
    dom.paymentsBody.innerHTML = '';
  }
}

async function loadGames() {
  dom.gamesStatus.textContent = 'Carregando jogos...';
  dom.gamesGrid.innerHTML = '';

  const { data, error } = await supabase
    .from('games')
    .select('id,name,price_cents,currency')
    .order('name');

  if (error) {
    dom.gamesStatus.textContent = 'Erro ao carregar os jogos.';
    showGlobalStatus(error.message, 'error');
    return;
  }

  if (!data || data.length === 0) {
    dom.gamesStatus.textContent = 'Nenhum jogo cadastrado ainda.';
    return;
  }

  dom.gamesStatus.textContent = '';
  data.forEach((game) => dom.gamesGrid.appendChild(createGameCard(game)));
}

function createGameCard(game) {
  const card = document.createElement('div');
  card.className = 'game-card';

  const title = document.createElement('h3');
  title.className = 'game-card__title';
  title.textContent = game.name;

  const price = document.createElement('p');
  price.className = 'game-card__price';
  price.textContent = formatCurrency(game.price_cents, game.currency);

  const action = document.createElement('button');
  action.className = 'button button--primary';
  action.textContent = 'Comprar e renovar acesso';
  action.addEventListener('click', () => initiateCheckout(game.id));

  card.appendChild(title);
  card.appendChild(price);
  card.appendChild(action);

  return card;
}

async function initiateCheckout(gameId) {
  if (!stripe) {
    showGlobalStatus('Stripe não está configurado. Informe STRIPE_PUBLISHABLE_KEY.', 'error');
    return;
  }

  if (!currentSession?.access_token) {
    showGlobalStatus('Faça login para comprar um jogo.', 'error');
    return;
  }

  try {
    showGlobalStatus('Redirecionando para o checkout seguro...', 'success');
    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, accessToken: currentSession.access_token })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Não foi possível iniciar o checkout.');
    }
    const { error } = await stripe.redirectToCheckout({ sessionId: payload.sessionId });
    if (error) {
      throw error;
    }
  } catch (error) {
    console.error(error);
    showGlobalStatus(error.message || 'Erro ao iniciar o checkout.', 'error');
  }
}

async function loadUserData() {
  await Promise.all([loadLicenses(), loadPayments()]);
}

async function loadLicenses() {
  if (!currentSession?.user) return;
  dom.licensesStatus.textContent = 'Carregando seus jogos...';
  dom.licensesList.innerHTML = '';

  const { data, error } = await supabase
    .from('user_game_access')
    .select('id, game_id, expiration_date, is_active')
    .eq('user_id', currentSession.user.id)
    .order('expiration_date', { ascending: false });

  if (error) {
    dom.licensesStatus.textContent = 'Não foi possível carregar seus jogos.';
    showGlobalStatus(error.message, 'error');
    return;
  }

  if (!data || data.length === 0) {
    dom.licensesStatus.textContent = 'Nenhum jogo ativo. Faça uma compra para liberar um título.';
    return;
  }

  dom.licensesStatus.textContent = '';
  const fragments = document.createDocumentFragment();
  data.forEach((item) => {
    const li = document.createElement('li');
    const details = document.createElement('div');
    details.innerHTML = `<strong>${item.game_id}</strong><br />Expira em: ${formatDate(item.expiration_date)}`;

    const badge = document.createElement('span');
    badge.textContent = item.is_active ? 'Ativo' : 'Inativo';
    badge.className = item.is_active ? 'badge badge--success' : 'badge badge--muted';

    li.appendChild(details);
    li.appendChild(badge);
    fragments.appendChild(li);
  });

  dom.licensesList.appendChild(fragments);
}

async function loadPayments() {
  if (!currentSession?.user) return;
  dom.paymentsStatus.textContent = 'Carregando histórico...';
  dom.paymentsBody.innerHTML = '';

  const { data, error } = await supabase
    .from('payment_history')
    .select('id, game_id, amount_cents, currency, payment_status, created_at')
    .eq('user_id', currentSession.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    dom.paymentsStatus.textContent = 'Não foi possível carregar o histórico.';
    showGlobalStatus(error.message, 'error');
    return;
  }

  dom.paymentsStatus.textContent = '';
  if (!data || data.length === 0) {
    dom.paymentsStatus.textContent = 'Nenhum pagamento realizado ainda.';
    return;
  }

  const fragments = document.createDocumentFragment();
  data.forEach((payment) => {
    const tr = document.createElement('tr');

    const gameCell = document.createElement('td');
    gameCell.textContent = payment.game_id;

    const amountCell = document.createElement('td');
    amountCell.textContent = formatCurrency(payment.amount_cents, payment.currency);

    const statusCell = document.createElement('td');
    statusCell.textContent = payment.payment_status || 'desconhecido';

    const dateCell = document.createElement('td');
    dateCell.textContent = formatDate(payment.created_at);

    tr.appendChild(gameCell);
    tr.appendChild(amountCell);
    tr.appendChild(statusCell);
    tr.appendChild(dateCell);
    fragments.appendChild(tr);
  });

  dom.paymentsBody.appendChild(fragments);
}

function formatCurrency(valueInCents, currency = 'usd') {
  const amount = (valueInCents || 0) / 100;
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount);
  } catch (_error) {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDate(dateString) {
  if (!dateString) return 'Sem data';
  const date = new Date(dateString);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function setFormDisabled(form, disabled) {
  Array.from(form.elements).forEach((el) => {
    el.disabled = disabled;
  });
}

let statusTimeout = null;
function showGlobalStatus(message, type = 'success') {
  if (!dom.globalStatus) return;
  dom.globalStatus.textContent = message;
  dom.globalStatus.dataset.type = type;
  dom.globalStatus.hidden = false;
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => {
    dom.globalStatus.hidden = true;
  }, 5000);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
