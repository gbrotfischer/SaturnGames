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
  authTabs: document.querySelectorAll('[data-auth-tab]'),
  authPanels: document.querySelectorAll('[data-auth-panel]'),
  authSwitchers: document.querySelectorAll('[data-switch-auth]'),
  signupStage: document.getElementById('signup-stage'),
  signupForm: document.getElementById('signup-form'),
  loginForm: document.getElementById('login-form'),
  magicLink: document.getElementById('magic-link'),
  signupConfirmation: document.getElementById('signup-confirmation'),
  signupConfirmationEmail: document.getElementById('signup-confirmation-email'),
  avatarInitial: document.querySelector('[data-avatar-initial]'),
  avatarPreview: document.querySelector('[data-avatar-preview]'),
  accountOpeners: document.querySelectorAll('[data-open-account]'),
  gamesGrid: document.getElementById('games-grid'),
  gamesStatus: document.getElementById('games-status'),
  homeFavorites: document.getElementById('home-favorites'),
  homeFavoritesStatus: document.getElementById('home-favorites-status'),
  homeGamesCount: document.getElementById('home-games-count'),
  licensesList: document.getElementById('licenses-list'),
  licensesStatus: document.getElementById('licenses-status'),
  libraryAuthPrompt: document.getElementById('library-auth-prompt'),
  paymentsBody: document.getElementById('payments-body'),
  paymentsStatus: document.getElementById('payments-status'),
  paymentsAuthPrompt: document.getElementById('payments-auth-prompt'),
  gameEyebrow: document.getElementById('game-eyebrow'),
  gameTitle: document.getElementById('game-title'),
  gameSubtitle: document.getElementById('game-subtitle'),
  gamePrice: document.getElementById('game-price'),
  gameDescription: document.getElementById('game-description'),
  gameTags: document.getElementById('game-tags'),
  gameCover: document.getElementById('game-cover'),
  gameGallery: document.getElementById('game-gallery'),
  gameHighlights: document.getElementById('game-highlights'),
  gameBuy: document.getElementById('game-buy'),
  gameDownload: document.getElementById('game-download'),
  gameStatus: document.getElementById('game-status'),
  gameOwnership: document.getElementById('game-ownership'),
  globalStatus: document.getElementById('global-status')
};

dom.year && (dom.year.textContent = new Date().getFullYear());
setActiveNav();
attachCommonListeners();

let currentSession = null;
let gamesCache = [];
const gamesIndex = new Map();
let gamesLoadingPromise = null;
let currentGameId = null;
let currentGameLicense = null;

if (supabase) {
  initAuth();
} else {
  console.warn('Supabase não configurado. Recursos autenticados indisponíveis.');
}

if (page === 'games') {
  loadGames();
} else if (page === 'home') {
  initHomePage();
} else if (page === 'game') {
  initGameDetailPage();
}

function setActiveNav() {
  const activeKey = page === 'game' ? 'games' : page;
  dom.navItems.forEach((link) => {
    if (link.dataset.pageLink === activeKey) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

function attachCommonListeners() {
  Array.from(dom.authTabs || []).forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.authTab || 'login';
      switchAuthTab(target);
    });
  });

  Array.from(dom.authSwitchers || []).forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.switchAuth || 'login';
      switchAuthTab(target);
    });
  });

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

  dom.gameBuy?.addEventListener('click', () => {
    if (!currentGameId) return;
    initiateCheckout(currentGameId);
  });

  dom.gameDownload?.addEventListener('click', (event) => {
    event.preventDefault();
    handleGameDownload();
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
    const confirmPassword = form.confirmPassword?.value?.trim();

    if (confirmPassword !== undefined && password !== confirmPassword) {
      showGlobalStatus('As senhas não conferem. Tente novamente.', 'error');
      setFormDisabled(form, false);
      return;
    }

    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      showGlobalStatus('Conta criada! Verifique seu email para confirmar o cadastro.', 'success');
      showSignupConfirmation(email);
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

  switchAuthTab('login');
}

function switchAuthTab(target = 'login') {
  const normalized = target === 'register' ? 'register' : 'login';
  resetSignupPanel();

  Array.from(dom.authTabs || []).forEach((tab) => {
    const isActive = tab.dataset.authTab === normalized;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  Array.from(dom.authPanels || []).forEach((panel) => {
    const isMatch = panel.dataset.authPanel === normalized;
    panel.hidden = !isMatch;
  });
}

function resetSignupPanel() {
  if (dom.signupStage) {
    dom.signupStage.hidden = false;
  }
  if (dom.signupConfirmation) {
    dom.signupConfirmation.hidden = true;
  }
  if (dom.signupConfirmationEmail) {
    dom.signupConfirmationEmail.textContent = '';
  }
}

function showSignupConfirmation(email) {
  if (dom.signupConfirmationEmail) {
    dom.signupConfirmationEmail.textContent = email;
  }
  if (dom.signupStage) {
    dom.signupStage.hidden = true;
  }
  if (dom.signupConfirmation) {
    dom.signupConfirmation.hidden = false;
  }
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

    if (dom.signupConfirmation?.hidden !== false) {
      switchAuthTab('login');
    }
  }

  await loadProtectedData();
}

async function loadProtectedData() {
  switch (page) {
    case 'games':
      // no extra data needed
      break;
    case 'game':
      await updateGameAccessState();
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
  if (!supabase) {
    if (dom.gamesStatus) dom.gamesStatus.textContent = 'Configure o Supabase para listar os jogos.';
    return [];
  }

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

async function initGameDetailPage() {
  const params = new URLSearchParams(window.location.search);
  const gameId = params.get('id');

  if (!gameId) {
    setGameStatus('Selecione um jogo válido no catálogo para ver os detalhes.', 'error');
    return;
  }

  currentGameId = gameId;
  currentGameLicense = null;

  if (!supabase) {
    setGameStatus('Configure o Supabase para exibir os dados oficiais deste jogo.', 'error');
    if (dom.gameBuy) dom.gameBuy.disabled = true;
    if (dom.gameDownload) dom.gameDownload.disabled = true;
    return;
  }

  setGameStatus('Carregando informações do jogo...', 'info');

  await loadGames();

  const game = gamesIndex.get(gameId);
  if (!game) {
    setGameStatus('Não encontramos este jogo. Volte ao catálogo e escolha outra opção.', 'error');
    return;
  }

  renderGameDetail(game);
  setGameStatus('');
  await updateGameAccessState();
}

async function initHomePage() {
  if (dom.homeFavoritesStatus) {
    dom.homeFavoritesStatus.textContent = supabase
      ? 'Carregando catálogo...'
      : 'Configure o Supabase para exibir os jogos disponíveis.';
  }

  if (!supabase) {
    if (dom.homeGamesCount) dom.homeGamesCount.textContent = '0';
    return;
  }

  const games = await loadGames();

  if (dom.homeGamesCount) {
    dom.homeGamesCount.textContent = games.length.toString();
  }

  if (!dom.homeFavorites) return;

  if (!games.length) {
    if (dom.homeFavoritesStatus) {
      dom.homeFavoritesStatus.textContent = 'Nenhum jogo cadastrado ainda.';
    }
    dom.homeFavorites.innerHTML = '';
    return;
  }

  if (dom.homeFavoritesStatus) {
    dom.homeFavoritesStatus.textContent = '';
  }

  const favorites = games.slice(0, 4);
  dom.homeFavorites.innerHTML = '';
  const fragment = document.createDocumentFragment();
  favorites.forEach((game) => fragment.appendChild(createHomeFavoriteCard(game)));
  dom.homeFavorites.appendChild(fragment);
}

const galleryPool = [
  'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1511517006433-842c25d113e0?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1516117172878-fd2c41f4a759?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1518397387277-7843fa893f1e?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1526413232644-8a50dd7e3221?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1600180758890-6d9f4f1b0c18?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1542759564-1613d27b6d77?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1510172951991-856a654063f9?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1517430816045-df4b7de11d1d?auto=format&fit=crop&w=1600&q=80'
];

const fallbackArt = galleryPool;

const descriptionSnippets = [
  'Desbloqueie interações ao vivo com comandos do chat e trilhas sincronizadas.',
  'Ferramentas prontas para reações instantâneas e telas especiais durante a live.',
  'Focado em retenção: ativa polls, alertas e efeitos responsivos em segundos.',
  'Ideal para criadores que precisam de automações com baixa latência e alta estabilidade.'
];

const tagPool = [
  'Triggers em segundos',
  'Overlay dinâmico',
  'Analytics ao vivo',
  'Suporte prioritário',
  'Compatível com TikTok',
  'Eventos sonoros',
  'Votações interativas',
  'Pronto para OBS'
];

const detailHighlights = [
  {
    icon: '⚡',
    title: 'Resposta instantânea',
    description: 'Triggers conectados ao chat TikTok com latência ultrabaixa controlada pelo Motor Saturn.'
  },
  {
    icon: '🎮',
    title: 'Painel para streamers',
    description: 'Configure desafios, metas e animações com poucos cliques e visualize métricas ao vivo.'
  },
  {
    icon: '🔒',
    title: 'Licença rastreável',
    description: 'Stripe e Supabase mantêm auditoria completa de cada compra e extensão de acesso.'
  }
];

function getGameGallery(gameId = '') {
  if (galleryPool.length === 0) return [];
  let hash = 0;
  for (let i = 0; i < gameId.length; i += 1) {
    hash = (hash + gameId.charCodeAt(i) * (i + 17)) % 9973;
  }
  const slides = [];
  const baseIndex = hash % galleryPool.length;
  const totalSlides = Math.min(4, galleryPool.length);
  for (let i = 0; i < totalSlides; i += 1) {
    slides.push(galleryPool[(baseIndex + i) % galleryPool.length]);
  }
  return slides;
}

function getGameArt(gameId = '') {
  const gallery = getGameGallery(gameId);
  if (!gallery.length) return galleryPool[0];
  return gallery[0];
}

function getGameDescription(gameId = '') {
  if (!descriptionSnippets.length) return '';
  let hash = 0;
  for (let i = 0; i < gameId.length; i += 1) {
    hash = (hash + gameId.charCodeAt(i) * (i + 7)) % 7919;
  }
  return descriptionSnippets[hash % descriptionSnippets.length];
}

function getGameTags(gameId = '') {
  if (tagPool.length === 0) return [];
  let hash = 0;
  for (let i = 0; i < gameId.length; i += 1) {
    hash = (hash + gameId.charCodeAt(i) * (i + 5)) % 8861;
  }
  const tags = new Set();
  let offset = 0;
  while (tags.size < 3 && offset < tagPool.length) {
    const index = (hash + offset) % tagPool.length;
    tags.add(tagPool[index]);
    offset += 1;
  }
  return Array.from(tags);
}

function createGameCard(game) {
  const card = document.createElement('article');
  card.className = 'store-card';
  card.dataset.gameId = game.id;

  card.addEventListener('click', (event) => {
    if (event.target.closest('button') || event.target.closest('.store-card__control') || event.target.closest('.store-card__dot')) {
      return;
    }
    window.location.href = `/game.html?id=${encodeURIComponent(game.id)}`;
  });

  const carousel = createGameCarousel(game);

  const body = document.createElement('div');
  body.className = 'store-card__body';

  const title = document.createElement('h3');
  title.className = 'store-card__title';
  const titleLink = document.createElement('a');
  titleLink.href = `/game.html?id=${encodeURIComponent(game.id)}`;
  titleLink.textContent = game.name;
  titleLink.addEventListener('click', (event) => event.stopPropagation());
  title.appendChild(titleLink);

  const tags = document.createElement('div');
  tags.className = 'store-card__tags';
  getGameTags(game.id).forEach((label) => {
    const chip = document.createElement('span');
    chip.className = 'store-card__tag';
    chip.textContent = label;
    tags.appendChild(chip);
  });

  const description = document.createElement('p');
  description.className = 'store-card__description';
  description.textContent = getGameDescription(game.id);

  const meta = document.createElement('p');
  meta.className = 'store-card__meta';
  meta.textContent = 'Cada compra adiciona +1 mês de licença ativa no seu painel.';

  const footer = document.createElement('div');
  footer.className = 'store-card__footer';

  const price = document.createElement('p');
  price.className = 'store-card__price';
  price.textContent = formatCurrency(game.price_cents, game.currency);

  const action = document.createElement('button');
  action.className = 'button button--primary';
  action.type = 'button';
  action.textContent = 'Comprar agora';
  action.addEventListener('click', (event) => {
    event.stopPropagation();
    initiateCheckout(game.id);
  });

  const note = document.createElement('p');
  note.className = 'store-card__note';
  note.textContent = 'Compatível com o Motor de Escuta Saturn, pronto para TikTok Live.';

  footer.appendChild(price);
  footer.appendChild(action);

  body.appendChild(title);
  if (tags.childElementCount) {
    body.appendChild(tags);
  }
  body.appendChild(description);
  body.appendChild(meta);
  body.appendChild(footer);
  body.appendChild(note);

  card.appendChild(carousel);
  card.appendChild(body);
  return card;
}

function renderGameDetail(game) {
  if (dom.gameEyebrow) dom.gameEyebrow.textContent = 'Licença oficial Saturn Games';
  if (dom.gameTitle) dom.gameTitle.textContent = game.name;
  if (dom.gameSubtitle) {
    dom.gameSubtitle.textContent = 'Sincronize gifts, metas e triggers do chat com latência ultrabaixa.';
  }
  if (dom.gamePrice) dom.gamePrice.textContent = formatCurrency(game.price_cents, game.currency);
  if (dom.gameDescription) dom.gameDescription.textContent = getGameDescription(game.id);
  if (dom.gameTags) renderGameTags(game);
  if (dom.gameBuy) dom.gameBuy.disabled = false;
  if (dom.gameDownload) dom.gameDownload.disabled = true;
  updateGameCover(getGameArt(game.id), game.name);
  renderGameGallery(getGameGallery(game.id), game.name);
  renderGameHighlights();
  document.title = `${game.name} · Saturn Games`;
}

function renderGameTags(game) {
  if (!dom.gameTags) return;
  dom.gameTags.innerHTML = '';
  const fragment = document.createDocumentFragment();
  getGameTags(game.id).forEach((label) => {
    const chip = document.createElement('span');
    chip.className = 'game-hero__tag';
    chip.textContent = label;
    fragment.appendChild(chip);
  });
  dom.gameTags.appendChild(fragment);
}

function updateGameCover(imageUrl, gameName = '') {
  if (!dom.gameCover || !imageUrl) return;
  dom.gameCover.style.setProperty('--game-cover', `url('${imageUrl}')`);
  if (gameName) {
    dom.gameCover.setAttribute('aria-label', `Arte principal do jogo ${gameName}`);
  }
}

function renderGameGallery(images, gameName = '') {
  if (!dom.gameGallery) return;
  dom.gameGallery.innerHTML = '';
  if (!images || images.length === 0) return;
  const fragment = document.createDocumentFragment();
  images.forEach((src, index) => {
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'game-hero__thumb';
    thumb.style.setProperty('--thumb-image', `url('${src}')`);
    thumb.setAttribute('aria-label', `Mostrar imagem ${index + 1} do jogo`);
    thumb.addEventListener('click', () => updateGameCover(src, gameName));
    fragment.appendChild(thumb);
  });
  dom.gameGallery.appendChild(fragment);
}

function renderGameHighlights() {
  if (!dom.gameHighlights) return;
  dom.gameHighlights.innerHTML = '';
  const fragment = document.createDocumentFragment();
  detailHighlights.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'game-hero__highlight';
    const icon = document.createElement('span');
    icon.className = 'game-hero__highlight-icon';
    icon.textContent = item.icon;
    const content = document.createElement('div');
    content.className = 'game-hero__highlight-content';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const description = document.createElement('p');
    description.textContent = item.description;
    content.appendChild(title);
    content.appendChild(description);
    li.appendChild(icon);
    li.appendChild(content);
    fragment.appendChild(li);
  });
  dom.gameHighlights.appendChild(fragment);
}

function createGameCarousel(game) {
  const gallery = getGameGallery(game.id);
  const images = gallery.length ? gallery : [getGameArt(game.id)];
  const carousel = document.createElement('div');
  carousel.className = 'store-card__carousel';
  carousel.dataset.count = String(images.length);
  carousel.dataset.index = '0';
  carousel.setAttribute('tabindex', '0');

  const viewport = document.createElement('div');
  viewport.className = 'store-card__viewport';
  viewport.setAttribute('role', 'group');
  viewport.setAttribute('aria-label', `Galeria do jogo ${game.name}`);

  const track = document.createElement('div');
  track.className = 'store-card__track';
  track.style.setProperty('--slide-count', images.length);

  images.forEach((src, index) => {
    const slide = document.createElement('div');
    slide.className = 'store-card__slide';
    slide.style.setProperty('--slide-image', `url('${src}')`);
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-label', `Imagem ${index + 1} de ${images.length}`);
    track.appendChild(slide);
  });

  viewport.appendChild(track);
  carousel.appendChild(viewport);

  if (images.length > 1) {
    const prev = document.createElement('button');
    prev.className = 'store-card__control store-card__control--prev';
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Ver imagem anterior');
    prev.innerHTML = '&#10094;';
    prev.addEventListener('click', () => shiftCarousel(carousel, -1));

    const next = document.createElement('button');
    next.className = 'store-card__control store-card__control--next';
    next.type = 'button';
    next.setAttribute('aria-label', 'Ver próxima imagem');
    next.innerHTML = '&#10095;';
    next.addEventListener('click', () => shiftCarousel(carousel, 1));

    const dots = document.createElement('div');
    dots.className = 'store-card__dots';

    images.forEach((_, index) => {
      const dot = document.createElement('button');
      dot.className = 'store-card__dot';
      dot.type = 'button';
      dot.setAttribute('aria-label', `Mostrar imagem ${index + 1}`);
      dot.addEventListener('click', () => setCarouselIndex(carousel, index));
      dots.appendChild(dot);
    });

    carousel.appendChild(prev);
    carousel.appendChild(next);
    carousel.appendChild(dots);
  }

  setCarouselIndex(carousel, 0, false);

  carousel.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      shiftCarousel(carousel, -1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      shiftCarousel(carousel, 1);
    }
  });

  return carousel;
}

function setCarouselIndex(carousel, nextIndex, animate = true) {
  const count = Number(carousel.dataset.count || '0');
  if (!count) return;
  const track = carousel.querySelector('.store-card__track');
  if (!track) return;
  const sanitized = ((Number(nextIndex) % count) + count) % count;
  carousel.dataset.index = String(sanitized);
  if (!animate) {
    track.classList.add('store-card__track--no-animate');
    requestAnimationFrame(() => {
      track.classList.remove('store-card__track--no-animate');
    });
  }
  track.style.transform = `translateX(-${sanitized * 100}%)`;
  carousel.querySelectorAll('.store-card__slide').forEach((slide, slideIndex) => {
    slide.classList.toggle('is-active', slideIndex === sanitized);
  });
  carousel.querySelectorAll('.store-card__dot').forEach((dot, dotIndex) => {
    dot.classList.toggle('is-active', dotIndex === sanitized);
  });
}

function setGameStatus(message = '', tone = 'info') {
  if (!dom.gameStatus) return;
  dom.gameStatus.textContent = message;
  dom.gameStatus.dataset.tone = message ? tone : '';
  dom.gameStatus.hidden = !message;
}

async function updateGameAccessState() {
  if (page !== 'game' || !dom.gameOwnership) return;

  if (!currentGameId) {
    dom.gameOwnership.textContent = '';
    dom.gameOwnership.dataset.state = '';
    if (dom.gameDownload) dom.gameDownload.disabled = true;
    return;
  }

  if (!supabase) {
    dom.gameOwnership.textContent = 'Configure o Supabase para validar licenças.';
    dom.gameOwnership.dataset.state = 'error';
    if (dom.gameDownload) dom.gameDownload.disabled = true;
    return;
  }

  if (!currentSession?.user) {
    currentGameLicense = null;
    dom.gameOwnership.textContent = 'Entre para verificar se já possui este jogo.';
    dom.gameOwnership.dataset.state = 'muted';
    if (dom.gameDownload) dom.gameDownload.disabled = true;
    if (dom.gameBuy) dom.gameBuy.textContent = 'Comprar agora';
    return;
  }

  dom.gameOwnership.textContent = 'Verificando sua licença...';
  dom.gameOwnership.dataset.state = 'loading';
  if (dom.gameDownload) dom.gameDownload.disabled = true;

  try {
    const { data, error } = await supabase
      .from('user_game_access')
      .select('id, expiration_date, is_active')
      .eq('user_id', currentSession.user.id)
      .eq('game_id', currentGameId)
      .order('expiration_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    currentGameLicense = data || null;
  } catch (error) {
    console.error(error);
    dom.gameOwnership.textContent = 'Não foi possível consultar sua licença agora.';
    dom.gameOwnership.dataset.state = 'error';
    showGlobalStatus('Não foi possível verificar a licença deste jogo.', 'error');
    return;
  }

  if (!currentGameLicense) {
    dom.gameOwnership.textContent = 'Licença ainda não adquirida. Clique em “Comprar agora” para garantir acesso.';
    dom.gameOwnership.dataset.state = 'muted';
    if (dom.gameDownload) dom.gameDownload.disabled = true;
    if (dom.gameBuy) dom.gameBuy.textContent = 'Comprar agora';
    return;
  }

  const expires = currentGameLicense.expiration_date
    ? formatDate(currentGameLicense.expiration_date)
    : 'sem data definida';

  if (currentGameLicense.is_active) {
    dom.gameOwnership.textContent = `Licença ativa. Expira em ${expires}.`;
    dom.gameOwnership.dataset.state = 'success';
    if (dom.gameDownload) dom.gameDownload.disabled = false;
    if (dom.gameBuy) dom.gameBuy.textContent = 'Renovar licença';
  } else {
    dom.gameOwnership.textContent = `Sua última licença expirou em ${expires}. Renove para continuar jogando.`;
    dom.gameOwnership.dataset.state = 'muted';
    if (dom.gameDownload) dom.gameDownload.disabled = true;
    if (dom.gameBuy) dom.gameBuy.textContent = 'Renovar licença';
  }
}

async function handleGameDownload() {
  if (page !== 'game') {
    window.location.href = '/library.html';
    return;
  }

  if (!currentGameId) {
    showGlobalStatus('Selecione um jogo antes de baixar os recursos.', 'error');
    return;
  }

  if (!currentSession?.user) {
    showGlobalStatus('Faça login para baixar os recursos deste jogo.', 'error');
    openAccountDrawer();
    return;
  }

  if (!supabase) {
    showGlobalStatus('Configure o Supabase para liberar downloads.', 'error');
    return;
  }

  if (!currentGameLicense || !currentGameLicense.is_active) {
    await updateGameAccessState();
  }

  if (!currentGameLicense || !currentGameLicense.is_active) {
    showGlobalStatus('É necessário ter uma licença ativa para baixar este jogo.', 'error');
    return;
  }

  showGlobalStatus('Abrindo sua biblioteca para iniciar o download.', 'success');
  window.location.href = `/library.html?game=${encodeURIComponent(currentGameId)}`;
}


function shiftCarousel(carousel, delta) {
  const count = Number(carousel.dataset.count || '0');
  if (!count) return;
  const index = Number(carousel.dataset.index || '0');
  setCarouselIndex(carousel, index + delta);
}

function createHomeFavoriteCard(game) {
  const card = document.createElement('article');
  card.className = 'home-favorite-card';

  const art = document.createElement('div');
  art.className = 'home-favorite-card__art';
  art.style.setProperty('--game-art', `url('${getGameArt(game.id)}')`);

  const body = document.createElement('div');
  body.className = 'home-favorite-card__body';

  const title = document.createElement('h3');
  title.className = 'home-favorite-card__title';
  title.textContent = game.name;

  const price = document.createElement('p');
  price.className = 'home-favorite-card__price';
  price.textContent = formatCurrency(game.price_cents, game.currency);

  const meta = document.createElement('p');
  meta.className = 'home-favorite-card__meta';
  meta.textContent = 'Licença +1 mês por compra confirmada.';

  const action = document.createElement('button');
  action.className = 'button button--primary';
  action.type = 'button';
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

