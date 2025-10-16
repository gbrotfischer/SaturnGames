# SaturnGames

Portal web para gerenciamento de assinaturas de jogos construído com HTML, CSS e JavaScript puro. Ele integra Supabase para autenticação, catálogo de jogos, licenças e histórico de pagamentos, além de Stripe Checkout para concluir compras com pagamento seguro. O projeto compila para arquivos estáticos (`dist/`) e expõe funções serverless compatíveis com Cloudflare Pages para criar sessões de checkout e processar webhooks do Stripe.

## Pré-requisitos

- [Node.js 18+](https://nodejs.org/) (usa `fetch` nativo e módulos CommonJS).
- Conta e projeto configurado no [Supabase](https://supabase.com/).
- Conta Stripe com os produtos/planos criados no modo desejado (teste ou produção).

## Variáveis de ambiente

Crie um arquivo `.env` na raiz seguindo o modelo abaixo:

```bash
PORT=3000
BASE_URL=http://localhost:3000
SUPABASE_URL=https://<seu-projeto>.supabase.co
SUPABASE_ANON_KEY=seu_anon_key
SUPABASE_SERVICE_ROLE_KEY=seu_service_role_key
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

> **Importante:**
> - A chave `SUPABASE_SERVICE_ROLE_KEY` e as chaves secretas do Stripe **jamais** devem ser expostas no frontend. Elas são utilizadas apenas pelas funções serverless (`functions/`) ou pelo `server.js` local para processar webhooks e criar sessões de checkout.
> - `BASE_URL` é opcional; quando ausente, o domínio do próprio request é usado para montar as URLs de retorno do Stripe.

## Executando localmente

```bash
npm install
npm run build        # gera dist/ com os assets prontos para deploy
npm run start        # opcional para rodar o servidor Node local
```

O servidor local iniciará em `http://localhost:3000`, servindo os arquivos de `public/` e expondo os mesmos endpoints utilizados em produção (útil para integração com o Stripe CLI):

- `GET /env.js`: entrega as configurações públicas (Supabase anon e chave pública do Stripe) para o frontend.
- `POST /api/create-checkout-session`: cria uma sessão de checkout do Stripe validando o usuário com Supabase.
- `POST /webhook`: endpoint para receber eventos do Stripe (ex.: `checkout.session.completed`).

## Fluxo de autenticação e compras

1. **Cadastro/Login**: o frontend usa `supabase.auth.signUp`, `signInWithPassword` ou `signInWithOtp` diretamente através do SDK carregado via CDN.
2. **Carregamento do catálogo**: uma consulta pública à tabela `public.games` preenche o grid de jogos.
3. **Checkout**: ao clicar em “Comprar e renovar acesso”, o frontend envia `gameId` e o `access_token` da sessão do Supabase para `/api/create-checkout-session`. O backend valida o usuário e cria a sessão no Stripe.
4. **Redirecionamento**: o usuário é encaminhado ao Stripe Checkout com `stripe.redirectToCheckout`.
5. **Webhook**: quando o Stripe confirma o pagamento (`checkout.session.completed`), o backend:
   - Busca/atualiza o registro em `public.user_game_access`, estendendo a licença por mais 1 mês.
   - Registra o evento em `public.payment_history`.
6. **Atualização do frontend**: ao retornar para o portal, o frontend consulta `user_game_access` e `payment_history` do usuário autenticado e atualiza a interface.

## Configuração do Stripe Webhook

Para testes locais, use o [Stripe CLI](https://stripe.com/docs/stripe-cli) para encaminhar eventos ao servidor:

```bash
stripe listen --forward-to localhost:3000/webhook
```

Cadastre o endpoint público correspondente no painel do Stripe e copie o `STRIPE_WEBHOOK_SECRET` informado.

## Deploy no Cloudflare Pages

1. **Build command:** `npm run build`
2. **Build output directory:** `dist`
3. **Functions:** mantenha habilitado o suporte a Functions (a pasta `functions/` já está no repositório).
4. **Variáveis de ambiente:** configure todas as chaves do `.env` diretamente nas configurações do projeto no Cloudflare Pages. O processo de build gera `dist/env.js` com as variáveis públicas e as funções utilizam as variáveis secretas em tempo de execução.
5. **Stripe webhook:** use o domínio do Pages (`https://<seu-projeto>.pages.dev/webhook`) ou seu domínio customizado para registrar o webhook `checkout.session.completed` no Stripe.

> Caso precise rodar o projeto no modo “Preview”, o comando `npm run build` finaliza imediatamente e evita que o job fique pendurado aguardando `npm run start`.

## Estrutura de pastas

```
.
├── functions/        # Funções serverless compatíveis com Cloudflare Pages
│   ├── api/create-checkout-session.js  # Cria sessões de checkout do Stripe
│   └── webhook.js                      # Processa webhooks checkout.session.completed
├── public/
│   ├── app.js          # Lógica do frontend: Supabase Auth, catálogo, checkout, licenças e pagamentos
│   ├── index.html      # Página principal do portal Saturn Games
│   ├── styles.css      # Estilos globais com visual futurista/neon
│   └── success.html    # Página exibida após retorno do Stripe
├── scripts/build.js    # Copia public/ para dist/ e gera env.js com variáveis públicas
├── server.js           # Servidor HTTP opcional para desenvolvimento local
├── package.json
└── README.md
```

## Customização

- **Visual**: ajuste as variáveis CSS em `public/styles.css` para alterar cores, efeitos e layout.
- **Catálogo**: mantenha os jogos atualizados diretamente na tabela `public.games` do Supabase.
- **Features adicionais**: utilize a API do Supabase (REST ou SDK) para complementar com chat em tempo real, perfis públicos ou uploads via Storage.

## Boas práticas

- Nunca exponha a `service_role_key` em clientes públicos. O arquivo `env.js` serve apenas dados seguros.
- Utilize HTTPS em produção para cumprir os requisitos do Stripe Checkout.
- Habilite políticas de RLS nas tabelas `user_game_access` e `payment_history` limitando a leitura ao `auth.uid()`.
- Implemente monitoramento de erros tanto no frontend (capturando mensagens no console) quanto no backend.

Aproveite para construir novas experiências de jogos com o Saturn Games! 🎮
