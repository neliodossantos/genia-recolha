# Design: Recolha de gestos LGA com Nuxt + Supabase + Cloudflare R2

**Data:** 2026-09-19
**Estado:** Aprovado para plano de implementação
**Substitui:** o frontend estático (`frontend/`) e os endpoints de recolha do FastAPI (`backend/`) descritos em `2026-09-08-lga-para-portugues-design.md` (secção "Recolha de dados"). O resto daquela spec (modelo, reconhecimento) mantém-se.

## Objetivo

Substituir a ferramenta de recolha atual (HTML/JS vanilla + FastAPI + SQLite local) por uma aplicação Nuxt publicada na web, com melhor experiência e design, que permita a vários sinalizantes gravar de qualquer dispositivo (telemóvel incluído) e guarde os dados na cloud. A recolha passa a funcionar só com o frontend e serviços geridos; o backend Python só volta a ser necessário para o treino.

## Porquê mudar

- A ferramenta atual só funciona com câmara em `localhost`; outros dispositivos exigem HTTPS. Publicar no Cloudflare resolve isto.
- Os dados ficam numa máquina local; a cloud permite vários sinalizantes em simultâneo e backups.
- A UI atual é mínima e teve falhas de usabilidade (ficar preso em "a carregar", avanço automático de palavra).

## Fora de âmbito

- Treino de modelos, inferência e reconhecimento (sub-projeto seguinte).
- Sentido Português → LGA.
- App móvel nativa (a app web é mobile-first).
- Migração dos dados de teste atuais em `backend/data/`.
- Remoção do código FastAPI existente: fica no repositório como base para o treino; os endpoints de recolha ficam obsoletos.

## Decisões

| Tema | Decisão |
|---|---|
| Frontend | Nuxt 3 + TypeScript, Nuxt UI (Tailwind), modo claro/escuro, mobile-first |
| Autenticação | Supabase Auth com username + palavra-passe (email sintético `<username>@lga.local`, sem verificação de email) |
| Base de dados | Supabase Postgres com RLS |
| Vídeos e landmarks | Cloudflare R2 (ficheiros `.webm` e `.json`) |
| Hospedagem | Nuxt no Cloudflare (preset Nitro `cloudflare-pages`), R2 ligado por binding (sem chaves S3) |
| Vídeo | Comprimido no browser (~480p, bitrate reduzido) |

## Arquitetura

```
Browser (Nuxt 3)
  ├─ MediaPipe HandLandmarker  → landmarks por frame
  ├─ MediaRecorder             → vídeo .webm comprimido
  ├─ Supabase JS               → login, vocabulário, progresso
  └─ POST /api/recordings ─────► Nitro server route (Cloudflare)
                                   ├─ valida JWT do Supabase
                                   ├─ valida palavra/tamanhos
                                   ├─ grava vídeo + landmarks no R2 (binding)
                                   └─ insere linha em recordings (com o JWT do utilizador, sujeita a RLS)
```

Unidades:
1. **App Nuxt (`web/`):** páginas, composables e componentes; sem lógica de negócio no servidor além da rota de upload.
2. **Supabase:** Auth, tabelas e políticas RLS, definidos em migrações SQL versionadas em `web/supabase/migrations/`.
3. **Rota `POST /api/recordings`:** único ponto que escreve no R2. O caminho dos ficheiros é gerado no servidor (`<user_id>/<recording_id>.webm` e `.json`); o cliente nunca escolhe caminhos.
4. **Composables puros e testáveis:** `useLandmarkBuffer`, `pickNextWord`, `useRecorder`.

## Modelo de dados (Postgres)

```sql
profiles(
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  role text not null default 'signer',   -- 'signer' | 'admin'
  created_at timestamptz not null default now()
)

vocabulary(
  id serial primary key,
  word text unique not null,
  position int not null,
  active boolean not null default true
)

recordings(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  word_id int not null references vocabulary(id),
  video_key text not null,
  landmarks_key text not null,
  duration_ms int not null,
  width int, height int, mime text, user_agent text,
  created_at timestamptz not null default now()
)
```

**RLS**
- `profiles`: cada utilizador lê o seu perfil; admin lê todos.
- `vocabulary`: leitura para utilizadores autenticados; escrita só admin.
- `recordings`: `insert` só com `user_id = auth.uid()` e palavra ativa; `select` das próprias linhas; admin lê todas. Sem `update` nem `delete` para signers.

**Progresso:** query `select word_id, count(*) from recordings group by word_id`, filtrada por RLS ao utilizador.

## Fluxo de uma gravação

1. Login/registo (username + palavra-passe).
2. Carregar `vocabulary` e a contagem por palavra do utilizador.
3. Palavra atual em destaque. "Gravar" inicia contagem decrescente de 3 s, depois `MediaRecorder` + MediaPipe em paralelo.
4. Landmarks guardados como `{ t, hands: [{ handedness, points: [{x,y,z}] }] }`, com `t` em ms relativos ao início da gravação (resolve o problema de timestamps absolutos e de lateralidade descartada apontado na revisão anterior).
5. Ao parar, o cliente envia `multipart/form-data` (`word_id`, `duration_ms`, `width`, `height`, `video`, `landmarks`) para `POST /api/recordings` com o JWT no header `Authorization`.
6. O servidor valida (secção seguinte), grava no R2 e insere a linha. Se a inserção falhar, apaga os objetos do R2 (sem ficheiros órfãos).
7. O contador local da palavra sobe (1/20, 2/20…). **A palavra só muda quando o utilizador carrega em "Próxima palavra".**

## Validação na rota de upload

- JWT válido (verificado com o Supabase); caso contrário 401.
- `word_id` existe e está ativo; caso contrário 400.
- Vídeo: tipo `video/webm`, máximo 10 MB; landmarks: JSON válido com máximo 2 MB; `duration_ms` máximo 15 000.
- Chaves de objetos geradas no servidor a partir de `user_id` e de um UUID novo.

## Interface

- **Entrar/Registar:** cartão único com username e palavra-passe.
- **Gravação:** palavra grande, câmara com landmarks sobrepostos, progresso da palavra e progresso global, botão de gravar grande com contagem decrescente, botão "Próxima palavra", ecrã de conclusão quando todas as palavras atingem a meta (20 por palavra).
- **Progresso:** tabela por palavra (feitas/meta).
- **Admin:** totais por signer e por palavra, exportação dos metadados (CSV) e das chaves R2.

## Tratamento de erros

- Câmara negada ou indisponível, ou contexto não seguro: mensagem específica com instruções; nunca fica preso em "a carregar".
- Falha ao carregar o MediaPipe/modelo: aviso com o erro e botão de tentar de novo.
- Falha no upload: o clip fica em memória com botão "Tentar de novo"; nada se perde até o utilizador sair da página.
- Tipo MIME não suportado (ex. Safari): escolher formato com `MediaRecorder.isTypeSupported`; se nenhum servir, avisar.
- Botão de gravar desativado durante o envio para impedir gravações sobrepostas.

## Testes

- **Vitest:** `pickNextWord`, `useLandmarkBuffer` (incl. timestamps relativos e lateralidade), contadores de progresso (reaproveitando os testes atuais quando possível).
- **Rota de upload:** testes com JWT válido/inválido, palavra inexistente, ficheiros grandes, falha de inserção com limpeza do R2 (R2 e Supabase simulados).
- **RLS:** testes contra Supabase local (`supabase start`): signer só vê e insere os seus dados; admin vê tudo; signer não consegue update/delete.
- **Manual:** verificação ponta a ponta com câmara real em desktop e telemóvel, depois de publicado com HTTPS.

## Segurança e privacidade

- Vídeos de pessoas reais: bucket R2 privado, sem listagem pública; acesso apenas via admin.
- Username livre, mas sem dados pessoais obrigatórios; nomes de ficheiro usam UUIDs.
- Segredos (Supabase service key, se necessária) só como variáveis de ambiente do Cloudflare, nunca no cliente.

## Custos (aproximados, a confirmar)

- Supabase gratuito chega para Auth e metadados (as linhas são pequenas; landmarks ficam no R2).
- R2: ~10 GB gratuitos, depois ~0,015 $/GB por mês, sem custo de saída de dados.

## Próximos passos

Plano de implementação via `writing-plans`. Ordem provável: projeto Nuxt e migrações Supabase, autenticação, rota de upload com R2, composables e testes, ecrã de gravação, progresso e admin, publicação no Cloudflare.
