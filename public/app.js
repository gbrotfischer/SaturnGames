import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4';

const env = window.__ENV || {};
const page = document.body?.dataset?.page || 'home';
const supabaseUrl = env.SUPABASE_URL;
const supabaseAnonKey = env.SUPABASE_ANON_KEY;
const stripePublishableKey = env.STRIPE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  showGlobalStatus('Configurações do Supabase ausentes. Defina SUPABASE_URL e SUPABASE_ANON_KEY.', 'error');
}

const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
let stripe = null;
if (stripePublishableKey && window.Stripe) {
  stripe = window.Stripe(stripePublishableKey);
}

const dom = {
  year: document.querySelector('[data-year]'),
  navItems: document.querySelectorAll('[data-page-link]'),
  signout: document.getElementById('signout'),
  accountToggle: document.getElementById('account-toggle'),
  accountDrawer: document.getElementById('account-drawer'),
  accountOverlay: document.querySelector('[data-close-account]'),
  accountClose: document.getElementById('account-close'),
  accountSummary: document.getElementById('account-summary'),
  accountName: document.getElementById('account-name'),
  accountEmail: document.getElementById('account-email'),
  accountMeta: document.getElementById('session-status'),
  authForms: document.getElementById('auth-forms'),
  signupForm: document.getElementById('signup-form'),
  loginForm: document.getElementById('login-form'),
  magicLink: document.getElementById('magic-link'),
  avatarInitial: document.querySelector('[data-avatar-initial]'),
  avatarPreview: document.querySelector('[data-avatar-preview]'),
  accountOpeners: document.querySelectorAll('[data-open-account]'),
  gamesGrid: document.getElementById('games-grid'),
  gamesStatus: document.getElementById('games-status'),
  licensesList: document.getElementById('licenses-list'),
  licensesStatus: document.getElementById('licenses-status'),
  libraryAuthPrompt: document.getElementById('library-auth-prompt'),
  paymentsBody: document.getElementById('payments-body'),
  paymentsStatus: document.getElementById('payments-status'),
  paymentsAuthPrompt: document.getElementById('payments-auth-prompt'),
  globalStatus: document.getElementById('global-status')
};

dom.year && (dom.year.textContent = new Date().getFullYear());
setActiveNav();
attachCommonListeners();

let currentSession = null;
let gamesCache = [];
const gamesIndex = new Map();
let gamesLoadingPromise = null;

if (supabase) {
  initAuth();
} else {
  console.warn('Supabase não configurado. Recursos autenticados indisponíveis.');
}

if (page === 'store') {
  loadGames();
}

function setActiveNav() {
  dom.navItems.forEach((link) => {
    if (link.dataset.pageLink === page) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

function attachCommonListeners() {
  dom.accountToggle?.addEventListener('click', () => {
    if (dom.accountToggle.getAttribute('aria-expanded') === 'true') {
      closeAccountDrawer();
    } else {
      openAccountDrawer();
    }
  });

  dom.accountClose?.addEventListener('click', closeAccountDrawer);
  dom.accountOverlay?.addEventListener('click', closeAccountDrawer);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAccountDrawer();
    }
  });

  dom.accountOpeners.forEach((button) => {
    button.addEventListener('click', openAccountDrawer);
  });

  dom.signout?.addEventListener('click', async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      showGlobalStatus('Você saiu da conta.', 'success');
      closeAccountDrawer();
    } catch (error) {
      console.error(error);
      showGlobalStatus('Não foi possível sair agora.', 'error');
    }
  });

  dom.signupForm?.addEventListener('submit', async (event) => {
    if (!supabase) return;
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
    if (!supabase) return;
    event.preventDefault();
    const form = event.currentTarget;
    setFormDisabled(form, true);
    const email = form.email.value.trim();
    const password = form.password.value.trim();
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      showGlobalStatus('Login realizado com sucesso!', 'success');
      form.reset();
      closeAccountDrawer();
    } catch (error) {
      console.error(error);
      showGlobalStatus(error.message || 'Não foi possível entrar.', 'error');
    } finally {
      setFormDisabled(form, false);
    }
  });

  dom.magicLink?.addEventListener('click', async () => {
    if (!supabase) return;
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
}

async function initAuth() {
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  await updateAuthState();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    await updateAuthState();
  });
}

async function updateAuthState() {
  const user = currentSession?.user;
  const isAuthenticated = Boolean(user);

  if (dom.signout) {
    dom.signout.hidden = !isAuthenticated;
  }

  updateAvatar(user);

  if (dom.accountSummary) {
    dom.accountSummary.hidden = !isAuthenticated;
  }
  if (dom.authForms) {
    dom.authForms.hidden = isAuthenticated;
  }

  if (isAuthenticated) {
    const email = user.email || 'Conta Saturn';
    const name = email.split('@')[0];
    if (dom.accountEmail) dom.accountEmail.textContent = email;
    if (dom.accountName) dom.accountName.textContent = `Olá, ${name}`;
    if (dom.accountMeta) dom.accountMeta.textContent = user.id;

    if (dom.libraryAuthPrompt) dom.libraryAuthPrompt.hidden = true;
    if (dom.paymentsAuthPrompt) dom.paymentsAuthPrompt.hidden = true;

    await loadProtectedData();
  } else {
    if (dom.accountEmail) dom.accountEmail.textContent = '';
    if (dom.accountName) dom.accountName.textContent = '';
    if (dom.accountMeta) dom.accountMeta.textContent = '';

    if (dom.libraryAuthPrompt) dom.libraryAuthPrompt.hidden = false;
    if (dom.paymentsAuthPrompt) dom.paymentsAuthPrompt.hidden = false;

    if (dom.licensesList) dom.licensesList.innerHTML = '';
    if (dom.licensesStatus) dom.licensesStatus.textContent = '';
    if (dom.paymentsBody) dom.paymentsBody.innerHTML = '';
    if (dom.paymentsStatus) dom.paymentsStatus.textContent = '';
  }
}

async function loadProtectedData() {
  switch (page) {
    case 'store':
      // no extra data needed
      break;
    case 'library':
      await loadLicenses();
      break;
    case 'payments':
      await loadPayments();
      break;
    default:
      break;
  }
}

async function loadGames(force = false) {
  if (!supabase) return [];

  if (!force) {
    if (gamesCache.length > 0) {
      renderGames(gamesCache);
      return gamesCache;
    }
    if (gamesLoadingPromise) {
      return gamesLoadingPromise;
    }
  }

  if (dom.gamesStatus) dom.gamesStatus.textContent = 'Carregando jogos...';
  if (dom.gamesGrid) dom.gamesGrid.innerHTML = '';

  gamesLoadingPromise = (async () => {
    const { data, error } = await supabase
      .from('games')
      .select('id,name,price_cents,currency')
      .order('name');

    if (error) {
      if (dom.gamesStatus) dom.gamesStatus.textContent = 'Erro ao carregar os jogos.';
      showGlobalStatus(error.message || 'Erro ao carregar os jogos.', 'error');
      gamesCache = [];
      gamesIndex.clear();
      return [];
    }

    gamesCache = data ?? [];
    gamesIndex.clear();
    gamesCache.forEach((game) => {
      gamesIndex.set(game.id, game);
    });

    if (dom.gamesStatus) {
      dom.gamesStatus.textContent = gamesCache.length ? '' : 'Nenhum jogo cadastrado ainda.';
    }

    renderGames(gamesCache);
    return gamesCache;
  })();

  const result = await gamesLoadingPromise;
  gamesLoadingPromise = null;
  return result;
}

function renderGames(games) {
  if (!dom.gamesGrid) return;
  dom.gamesGrid.innerHTML = '';
  const fragment = document.createDocumentFragment();
  games.forEach((game) => fragment.appendChild(createGameCard(game)));
  dom.gamesGrid.appendChild(fragment);
}

const fallbackArt = [
  'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1511517006433-842c25d113e0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1516117172878-fd2c41f4a759?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80'
];

function getGameArt(gameId = '') {
  if (!gameId) return fallbackArt[0];
  let hash = 0;
  for (let i = 0; i < gameId.length; i += 1) {
    hash = (hash + gameId.charCodeAt(i) * (i + 11)) % 997;
  }
  return fallbackArt[hash % fallbackArt.length];
}

function createGameCard(game) {
  const card = document.createElement('article');
  card.className = 'game-card';

  const art = document.createElement('div');
  art.className = 'game-card__art';
  art.style.setProperty('--game-art', `url('${getGameArt(game.id)}')`);

  const body = document.createElement('div');
  body.className = 'game-card__body';

  const title = document.createElement('h3');
  title.className = 'game-card__title';
  title.textContent = game.name;

  const price = document.createElement('p');
  price.className = 'game-card__price';
  price.textContent = formatCurrency(game.price_cents, game.currency);

  const meta = document.createElement('p');
  meta.className = 'game-card__meta';
  meta.textContent = 'Cada compra adiciona +1 mês de licença.';

  const action = document.createElement('button');
  action.className = 'button button--primary';
  action.textContent = 'Comprar agora';
  action.addEventListener('click', () => initiateCheckout(game.id));

  body.appendChild(title);
  body.appendChild(meta);
  body.appendChild(price);
  body.appendChild(action);

  card.appendChild(art);
  card.appendChild(body);
  return card;
}

async function initiateCheckout(gameId) {
  if (!stripe) {
    showGlobalStatus('Stripe não está configurado. Informe STRIPE_PUBLISHABLE_KEY.', 'error');
    return;
  }
  if (!currentSession?.access_token) {
    showGlobalStatus('Faça login para comprar um jogo.', 'error');
    openAccountDrawer();
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

async function ensureGamesIndex() {
  if (gamesCache.length === 0 && !gamesLoadingPromise) {
    await loadGames();
  } else if (gamesLoadingPromise) {
    await gamesLoadingPromise;
  }
}

async function loadLicenses() {
  if (!supabase || !currentSession?.user) return;
  if (dom.licensesStatus) dom.licensesStatus.textContent = 'Carregando seus jogos...';
  if (dom.licensesList) dom.licensesList.innerHTML = '';

  await ensureGamesIndex();

  const { data, error } = await supabase
    .from('user_game_access')
    .select('id, game_id, expiration_date, is_active')
    .eq('user_id', currentSession.user.id)
    .order('expiration_date', { ascending: false });

  if (error) {
    if (dom.licensesStatus) dom.licensesStatus.textContent = 'Não foi possível carregar seus jogos.';
    showGlobalStatus(error.message || 'Não foi possível carregar seus jogos.', 'error');
    return;
  }

  if (!data || data.length === 0) {
    if (dom.licensesStatus) dom.licensesStatus.textContent = 'Nenhum jogo ativo. Faça uma compra para liberar um título.';
    return;
  }

  if (dom.licensesStatus) dom.licensesStatus.textContent = '';
  if (!dom.licensesList) return;

  const fragment = document.createDocumentFragment();
  data.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'library-item';

    const art = document.createElement('div');
    art.className = 'library-item__art';
    art.style.setProperty('--game-art', `url('${getGameArt(item.game_id)}')`);

    const details = document.createElement('div');
    details.className = 'library-item__details';

    const title = document.createElement('strong');
    title.textContent = gamesIndex.get(item.game_id)?.name || 'Jogo desconhecido';

    const meta = document.createElement('span');
    meta.className = 'library-item__meta';
    meta.textContent = `Licença expira em ${formatDate(item.expiration_date)}`;

    const badge = document.createElement('span');
    badge.textContent = item.is_active ? 'Ativo' : 'Inativo';
    badge.className = item.is_active ? 'badge badge--success' : 'badge badge--muted';

    details.appendChild(title);
    details.appendChild(meta);
    li.appendChild(art);
    li.appendChild(details);
    li.appendChild(badge);
    fragment.appendChild(li);
  });

  dom.licensesList.appendChild(fragment);
}

async function loadPayments() {
  if (!supabase || !currentSession?.user) return;
  if (dom.paymentsStatus) dom.paymentsStatus.textContent = 'Carregando histórico...';
  if (dom.paymentsBody) dom.paymentsBody.innerHTML = '';

  await ensureGamesIndex();

  const { data, error } = await supabase
    .from('payment_history')
    .select('id, game_id, amount_cents, currency, payment_status, created_at')
    .eq('user_id', currentSession.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    if (dom.paymentsStatus) dom.paymentsStatus.textContent = 'Não foi possível carregar o histórico.';
    showGlobalStatus(error.message || 'Não foi possível carregar o histórico.', 'error');
    return;
  }

  if (!data || data.length === 0) {
    if (dom.paymentsStatus) dom.paymentsStatus.textContent = 'Nenhum pagamento realizado ainda.';
    return;
  }

  if (dom.paymentsStatus) dom.paymentsStatus.textContent = '';
  if (!dom.paymentsBody) return;

  const fragment = document.createDocumentFragment();
  data.forEach((payment) => {
    const tr = document.createElement('tr');

    const gameCell = document.createElement('td');
    gameCell.textContent = gamesIndex.get(payment.game_id)?.name || 'Jogo desconhecido';

    const amountCell = document.createElement('td');
    amountCell.textContent = formatCurrency(payment.amount_cents, payment.currency);

    const statusCell = document.createElement('td');
    statusCell.textContent = formatStatus(payment.payment_status);

    const dateCell = document.createElement('td');
    dateCell.textContent = formatDate(payment.created_at);

    tr.appendChild(gameCell);
    tr.appendChild(amountCell);
    tr.appendChild(statusCell);
    tr.appendChild(dateCell);
    fragment.appendChild(tr);
  });

  dom.paymentsBody.appendChild(fragment);
}

function updateAvatar(user) {
  const fallback = '👤';
  if (!user) {
    dom.avatarInitial && (dom.avatarInitial.textContent = fallback);
    dom.avatarPreview && (dom.avatarPreview.textContent = fallback);
    return;
  }
  const email = user.email || '';
  const initial = email ? email.charAt(0).toUpperCase() : 'S';
  dom.avatarInitial && (dom.avatarInitial.textContent = initial);
  dom.avatarPreview && (dom.avatarPreview.textContent = initial);
}

function openAccountDrawer() {
  if (!dom.accountDrawer) return;
  dom.accountDrawer.setAttribute('aria-hidden', 'false');
  dom.accountDrawer.dataset.state = 'open';
  document.body.classList.add('drawer-open');
  dom.accountToggle?.setAttribute('aria-expanded', 'true');
}

function closeAccountDrawer() {
  if (!dom.accountDrawer) return;
  dom.accountDrawer.setAttribute('aria-hidden', 'true');
  dom.accountDrawer.dataset.state = 'closed';
  document.body.classList.remove('drawer-open');
  dom.accountToggle?.setAttribute('aria-expanded', 'false');
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

function formatStatus(status) {
  if (!status) return 'desconhecido';
  return status.replace(/_/g, ' ');
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

