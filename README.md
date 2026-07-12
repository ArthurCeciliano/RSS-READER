# RSS Reader

Plataforma self-hosted de leitura de feeds (estilo Feedbro), com ingestão de fontes sem RSS nativo
(Instagram, TikTok) via bridge configurável. Ver o prompt mestre do projeto para a especificação completa.

Este repositório está na **Fase 1**: núcleo (banco, importador OPML, motor de atualização para
RSS/Atom nativo + YouTube, UI com sidebar/pastas/contadores/modo cards/leitor interno).
A Fase 2 (bridge Instagram/TikTok com failover validado, regras, notificações, busca, estatísticas)
ainda não foi implementada — o roteamento para bridge já existe no código (módulo 1), mas não foi
testado contra uma instância real do RSSHub.

## Estrutura

- `backend/` — Fastify + TypeScript + Prisma (PostgreSQL) + BullMQ (Redis). API REST, importador/exportador
  OPML, resolvedor de URL → feed (módulo 1), parser de feeds, worker de ingestão agendada.
- `frontend/` — React + TypeScript + Vite. Tema escuro, sidebar com árvore de pastas, grade de cards,
  leitor interno, configurações.
- `docker-compose.yml` — sobe `postgres`, `redis`, `rsshub`, `migrate` (roda as migrations e sai),
  `app` (API), `worker` (ingestão agendada) e `frontend`.

## Subindo tudo com Docker

Pré-requisito: Docker Desktop instalado e rodando.

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- API: http://localhost:3001
- RSSHub (bridge, base para Instagram/TikTok na Fase 2): http://localhost:1200

O serviço `migrate` roda `prisma migrate deploy` e sai; `app`/`worker` esperam ele terminar com sucesso
antes de subir.

> **Nota:** este docker-compose foi escrito e revisado, mas não pôde ser executado no ambiente onde o
> código foi gerado (sem Docker disponível). Rode `docker compose up --build` e me avise se algo falhar
> — o mais provável é ajuste fino de variável de ambiente ou versão de imagem.

## Deploy no Render (Supabase + Render, sem Docker)

Modelo combinado: 1 Web Service faz tudo (API + worker de ingestão + serve o frontend estático),
mais 1 Key Value (Redis gerenciado do Render). Postgres fica no Supabase.

1. **Key Value** no Render → cria o Redis, copie a *Internal Connection String*.
2. **Web Service** no Render:
   - Root directory: raiz do repo (não `backend`, precisamos das duas pastas)
   - Build command:
     ```
     cd frontend && npm install && npm run build && cd ../backend && npm install && npx prisma generate && npm run build
     ```
   - Start command: `node backend/dist/server.js`
   - Env vars:
     - `DATABASE_URL` → connection string do Supabase
     - `REDIS_URL` → connection string do Key Value
     - `NODE_ENV=production`
   - No build do frontend (mesmo comando acima), como ele é servido pelo próprio backend, **não** defina
     `VITE_API_URL` (ou defina como string vazia) para o client usar caminhos relativos (`/api/...`) em
     vez de apontar para outra URL.

Isso substitui inteiramente o `docker-compose.yml` — ele continua no repo como alternativa para rodar
tudo localmente com Docker, mas não é mais necessário para deploy.

> **Trade-off assumido:** no free tier do Render, o Web Service "dorme" após ~15 min sem tráfego HTTP;
> como o worker roda no mesmo processo, a atualização automática de feeds pausa nesse período e volta
> a rodar assim que alguém acessa o site. Para atualização 24/7 sempre ativa, seria necessário separar
> o worker num Background Worker (pago no Render).

## Rodando localmente sem Docker (dev)

Precisa de Postgres e Redis rodando localmente (ou apontar `DATABASE_URL`/`REDIS_URL` para instâncias
remotas — ex.: Supabase + Redis local).

Por padrão `npm run dev` já sobe o worker no mesmo processo e tenta servir `frontend/dist` (mesmo
comportamento do deploy combinado no Render). Para dev com frontend e worker como processos
separados (hot-reload do Vite, por exemplo), desative os dois no `.env` do backend:
`RUN_WORKER_IN_PROCESS=false` e `SERVE_FRONTEND=false`.

```bash
# backend
cd backend
cp .env.example .env    # ajuste DATABASE_URL/REDIS_URL se necessário
npm install
npx prisma migrate deploy
npm run dev              # API em http://localhost:3001
npm run worker           # em outro terminal: worker de ingestão (só se RUN_WORKER_IN_PROCESS=false)

# frontend
cd frontend
cp .env.example .env
npm install
npm run dev               # http://localhost:5173
```

## Testes

```bash
cd backend
npm test
```

59 testes cobrindo: parser de OPML (validado com o arquivo OPML real de 277 fontes / 43 pastas),
importador OPML (roteamento de Instagram/TikTok/YouTube/Reddit, relatório added/skipped/failed),
exportador OPML (round-trip), normalizador de URL, resolvedor de fonte (módulo 1), parser de
feed RSS/Atom, deduplicação, agendador adaptativo e resolvedor de bridge.

## Checklist de verificação manual — Fase 1

- [ ] `docker compose up --build` sobe todos os serviços sem erro.
- [ ] Abrir http://localhost:5173 mostra o layout: sidebar à esquerda (vazia no início), topbar,
      área de conteúdo vazia.
- [ ] Em Configurações → "Import Feed Subscriptions (as OPML)", importar o arquivo OPML original
      (277 fontes / 43 pastas) e ver a barra de progresso avançar até concluir.
- [ ] Após o import, a sidebar mostra as pastas com os contadores de não lidos, e as fontes
      Instagram/TikTok aparecem classificadas com esse tipo (ícone diferente), não como RSS quebrado.
- [ ] Clicar em "Atualizar agora" (topbar) enfileira os jobs; o worker (`docker compose logs -f worker`)
      mostra `[ingest] <fonte> -> updated/not_modified/failed`.
  - [ ] Um feed RSS nativo real (ex.: g1 Tecnologia) traz itens novos na visão em cards, com imagem,
      fonte e tempo relativo ("20 minutes"), sem duplicar em ciclos seguintes.
- [ ] Clicar num card abre o leitor interno; "Abrir original" leva à URL real; estrela/marcar como
      lido refletem na sidebar (contador cai).
- [ ] Em "Saúde dos feeds", fontes com falha (ex.: URL inválida de propósito) aparecem com status
      degraded/failing e mensagem de erro, sem afetar as demais.
- [ ] Exportar OPML (Configurações) e conferir que fontes Instagram/TikTok voltam com a URL de perfil
      original no `xmlUrl`, não a URL da bridge.
