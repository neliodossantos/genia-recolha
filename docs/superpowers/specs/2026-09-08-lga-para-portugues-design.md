# Design: Interpretação LGA → Português (MVP)

**Data:** 2026-09-08
**Estado:** Aprovado para plano de implementação

## Contexto

Projeto de interpretação gestual angolana (LGA — Língua Gestual Angolana),
com o objetivo final de cobrir dois sentidos de tradução:

1. **LGA → Português** — câmara capta gestos, sistema produz texto/voz em português.
2. **Português → LGA** — texto/voz em português é traduzido e um avatar 3D gesticula em LGA.

Estes dois sentidos são subsistemas suficientemente independentes (visão
computacional + classificação de sequências de um lado; geração de texto +
animação 3D do outro) para justificarem specs e planos de implementação
separados. **Este documento cobre apenas o primeiro sub-projeto: LGA → Português.**

O objetivo do produto é acessibilidade real — não um protótipo académico —
para pessoas surdas em Angola. O autor é solo, a aprender ML durante o
desenvolvimento.

## Objetivo do MVP

Dado vídeo de uma pessoa a gesticular em LGA através da câmara de um
computador ou telemóvel (via browser), reconhecer a palavra/frase gesticulada
dentro de um vocabulário fixo de ~50-100 palavras e frases do quotidiano
(cumprimentos, necessidades básicas, números, etc.), e mostrar o resultado
como texto no ecrã. Inclui gestos estáticos e dinâmicos (em movimento).

**Fora de âmbito para este MVP:**
- Saída em voz (TTS) — fica para uma fase seguinte.
- Frases longas/contínuas fora do vocabulário fixo (gramática LGA completa).
- O sentido inverso (Português → LGA / avatar 3D) — sub-projeto separado.
- App móvel nativa — o MVP é uma app web.

## Restrições e contexto conhecido

- **Não existe dataset de LGA.** Este é o maior risco do projeto — a recolha
  de dados é trabalho crítico que antecede qualquer modelo.
- Há acesso disponível a sinalizantes de LGA (comunidade/associação) para
  colaborar na recolha e validação de dados.
- Autor solo, a aprender ML pelo caminho — as escolhas de arquitetura
  favorecem manter o trabalho de ML "a sério" (treino, iteração de modelos)
  em Python, o ecossistema com mais recursos de aprendizagem.
- Contexto de rede em Angola pode incluir zonas com internet limitada —
  favorece soluções leves em banda larga.

## Arquitetura

```
┌─────────────────────┐         WebSocket          ┌──────────────────────┐
│   Browser (cliente)  │ ── landmarks (JSON) ──────▶│  Backend Python       │
│                      │                             │  (FastAPI)            │
│  - Captura câmara    │◀── palavra reconhecida ────│                       │
│  - MediaPipe.js      │                             │  - Buffer de sequência│
│    (Hands/Holistic)  │                             │  - Modelo LSTM/GRU    │
│  - UI (texto)        │                             │  - Vocabulário fixo   │
└─────────────────────┘                             └──────────────────────┘
                                                              │
                                                     ┌──────────────────┐
                                                     │  Pipeline offline │
                                                     │  (fora do runtime │
                                                     │  de produção)      │
                                                     │  - Recolha vídeo   │
                                                     │  - Extração de     │
                                                     │    landmarks       │
                                                     │  - Treino do       │
                                                     │    modelo          │
                                                     └──────────────────┘
```

### Decisão arquitetural: landmarks no cliente, classificação no servidor

Avaliadas três abordagens:

- **A (escolhida) — Landmarks no browser + classificação no servidor Python.**
  MediaPipe.js extrai pontos-chave da mão/corpo no cliente; só esses pontos
  (não vídeo) são enviados ao backend, que corre o modelo de sequência.
  Vantagens: vídeo nunca sai do dispositivo (privacidade, baixa banda), e o
  treino/iteração de modelos permanece em Python.
- **B — Tudo no browser (TensorFlow.js).** Sem backend, mas exige converter
  modelos treinados em Python para TF.js, introduzindo uma camada de tradução
  que dificulta a depuração para quem está a aprender ML.
- **C — Vídeo enviado ao servidor, processado inteiramente lá.** Mais simples
  conceptualmente, mas pesado em banda (envia vídeo bruto) e pior para
  privacidade num produto real.

### Componentes

1. **Cliente web** — capta vídeo, extrai landmarks via MediaPipe.js, envia
   janelas de landmarks ao backend via WebSocket, mostra o texto reconhecido.
   Não faz inferência de ML pesada.
2. **Backend de inferência** — recebe sequências de landmarks por sessão,
   mantém um buffer, corre o modelo (LSTM/GRU) treinado, aplica um limiar de
   confiança, devolve a palavra prevista.
3. **Pipeline de dados offline** — ferramenta(s) para gravar exemplos com
   sinalizantes, extrair landmarks e produzir o dataset de treino anotado.
   Trabalho crítico que precede a existência de qualquer modelo.
4. **Pipeline de treino** — script(s) Python que treinam o modelo a partir do
   dataset e exportam os pesos para o backend consumir.

## Fluxo de dados (runtime)

1. Browser pede acesso à câmara.
2. A cada frame, MediaPipe.js extrai landmarks (mãos, possivelmente pose do
   tronco) → vetor de coordenadas.
3. O cliente acumula uma janela deslizante (últimos ~1-2 segundos de frames)
   e envia-a ao backend via WebSocket.
4. O backend mantém um buffer por sessão, corre o modelo sobre a janela, e só
   devolve uma previsão se a confiança ultrapassar um limiar definido.
5. Se a confiança for baixa, não mostra nada — evita alternância visual com
   previsões erradas.
6. Ao mostrar uma palavra, o buffer é limpo/decai para não repetir a mesma
   previsão em frames consecutivos.

## Recolha de dados

Fase crítica que antecede o desenvolvimento do modelo:

- Definir com a comunidade a lista concreta das 50-100 palavras/frases-alvo,
  priorizando o quotidiano (cumprimentos, necessidades básicas, números).
- Gravar múltiplos sinalizantes por gesto — depender de uma só pessoa faz o
  modelo aprender o estilo individual em vez de generalizar. Orientação
  aproximada (não regra rígida): 3-5 sinalizantes, 15-30 repetições por
  gesto por pessoa.
- Guardar tanto o vídeo bruto (permite reprocessar se o extrator de
  landmarks mudar) como os landmarks já extraídos (treino mais rápido).
- Anotar cada exemplo com o rótulo da palavra e metadados (sinalizante,
  condições de gravação).

Isto implica construir, antes do classificador em si, uma ferramenta de
recolha (provavelmente uma página web que grava vídeo + landmarks e guia o
sinalizante pela lista de palavras-alvo).

## Modelo

Seguindo a progressão baseline → avançado já identificada para este
problema:

- **Baseline**: Random Forest sobre landmarks de gestos isolados/estáticos,
  para validar o pipeline ponta-a-ponta o mais cedo possível com o mínimo de
  dados.
- **MVP real**: LSTM/GRU sobre sequências de landmarks, para cobrir também
  gestos dinâmicos (necessário dado o âmbito de vocabulário do quotidiano
  aprovado, que inclui movimento).
- Transformer temporal para sequências longas fica fora de âmbito do MVP —
  só relevante se o produto evoluir para frases contínuas fora do
  vocabulário fixo.

## Tratamento de erros e casos limite

- **Sem mão detetada / má iluminação**: usar a confiança de deteção do
  MediaPipe; se baixa, mostrar aviso ao utilizador em vez de tentar
  classificar ruído.
- **Gesto fora do vocabulário**: o classificador só conhece as palavras
  treinadas; a confiança deve ficar baixa nesses casos. Testar isto
  explicitamente com exemplos fora do vocabulário nos dados de validação,
  para não devolver previsões erradas com confiança artificialmente alta.
- **Ligação perdida (WebSocket)**: cliente deteta desconexão, tenta
  reconectar, e informa visualmente o utilizador em vez de ficar preso à
  última previsão mostrada.
- **Latência alta**: se o backend demorar, o cliente indica "a processar"
  em vez de parecer travado.

## Testes / validação

- **Pipeline de recolha**: teste manual — gravar um exemplo e confirmar que
  vídeo, landmarks e rótulo ficam guardados corretamente.
- **Extração de landmarks**: testes automáticos com vídeos de referência,
  confirmando deteção da mão nos frames esperados.
- **Modelo**: divisão treino/validação/teste por *sinalizante* (não por
  vídeo aleatório), para medir generalização a pessoas não vistas no treino,
  não só a gestos não vistos.
- **Ponta a ponta**: conjunto de gravações novas, de um sinalizante fora do
  treino, para validar o sistema completo antes de considerar o MVP pronto.

## Próximos passos

Este design cobre a arquitetura e âmbito do MVP. O plano de implementação
detalhado (fases, tarefas concretas) fica para o passo seguinte via
`writing-plans`. Dado que a recolha de dados é o bloqueador crítico, é
expectável que o plano comece pela ferramenta de recolha, antes de qualquer
código de modelo.
