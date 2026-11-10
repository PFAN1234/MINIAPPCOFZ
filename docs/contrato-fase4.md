# Fase 4 — contrato do novo registro (online)

Base: `docs/esquema-fase2.md` (RPC `concluir_registro`, bucket `fotos`) e `docs/contrato-fase3.md` (camada de dados, fixture). Referência visual: `docs/mockups/mini-app-v2.png` (tela 4). O login real continua na fase 6, então tudo é desenvolvido e testado com a fixture. A implementação Supabase segue o contrato e é testada de ponta a ponta na fase 6.

A fase 5 (sinal instável) vai pôr este envio numa fila. Por isso o envio é uma função **idempotente e retomável**: os ids são gerados uma única vez no início, e repetir o envio inteiro com os mesmos ids nunca duplica nada.

## A. Dados, compressão e envio

### Compressão (`app/src/util/imagem.ts`)

```ts
export interface FotoPreparada { id: string; blob: Blob; largura: number; altura: number; bytes: number }
export function dimensoesAlvo(largura: number, altura: number, ladoMaximo?: number): { largura: number; altura: number } // padrão 1920; nunca amplia
export async function prepararFoto(arquivo: File, opcoes?: { ladoMaximo?: number; qualidade?: number }): Promise<FotoPreparada>
```

- Decodifica com `createImageBitmap(arquivo, { imageOrientation: 'from-image' })`, que aplica a rotação do EXIF. Se o navegador não tiver essa função, usa `<img>` como alternativa.
- Desenha em canvas (`OffscreenCanvas`, se existir) no tamanho de `dimensoesAlvo` e gera JPEG com qualidade 0,8.
- A recodificação descarta todo o EXIF, inclusive a localização. Um teste de ponta a ponta confere isso com um JPEG que tem GPS.
- O `id` vem de `crypto.randomUUID()`.
- Arquivo que não decodifica (HEIC sem suporte, arquivo corrompido) gera um erro com a mensagem "Não foi possível ler esta foto. Tente outra ou tire pela câmera."

### `capturado_em`

É o menor `lastModified` entre os arquivos escolhidos, limitado a agora, e vale agora se não houver nenhum. O servidor recusa datas mais de 5 min no futuro.

### Repositório (acréscimos a `Repositorio`)

```ts
enviarFoto(caminho: { obraId: string; registroId: string; fotoId: string }, blob: Blob): Promise<void>
concluirRegistro(dados: NovoRegistro): Promise<{ id: string }>
interface NovoRegistro {
  id: string; ambienteId: string; tipo: 'servico' | 'pendencia'; legenda: string; capturadoEm: string // ISO
  fotos: { id: string; largura: number; altura: number; bytes: number }[] // na ordem escolhida
}
```

- **Supabase, `enviarFoto`:**
  - `storage.from('fotos').upload('<obraId>/<registroId>/<fotoId>.jpg', blob, { upsert: true, contentType: 'image/jpeg' })`;
  - o reenvio do mesmo arquivo é permitido pela política `fotos_update`, enquanto a foto não está vinculada a um registro;
  - quando a foto já está vinculada, o erro de reenvio de um registro já concluído é tratado no orquestrador (ver abaixo).
- **Supabase, `concluirRegistro`:**
  - `rpc('concluir_registro', { p_id, p_ambiente_id, p_tipo, p_legenda, p_capturado_em, p_fotos })`;
  - os erros do Postgres viram `ErroEnvio` com a mensagem do servidor (já em português) e um `tipo`: `sessao` (28000), `permissao` (42501), `nao_encontrado` (P0002), `conflito` (23505), `validacao` (22023) e `rede`, este quando a requisição não chega ao servidor.
- **Fixture:** guarda os registros e os blobs em memória, com URL por `URL.createObjectURL`, e aplica as mesmas validações da RPC: tipo, legenda de 1 a 1000 caracteres após o `trim`, 1 a 10 fotos com ids distintos, foto enviada antes de concluir e idempotência pelo `id`. Autor fixo, "Você (teste)".

### Leitura com fotos e publicação

`RegistroResumo` ganha:
- `fotos: { id: string; path: string; largura: number; altura: number }[]`, ordenadas por `ordem`;
- `publicacao: 'pendente' | 'enviando' | 'publicado' | 'incerto' | 'falhou' | null`.

No Supabase, as fotos e as publicações são buscadas em **consultas separadas**, com `.in('registro_id', ids)`, e não por *embed*. Isso evita ambiguidade de relacionamento no PostgREST. `urlsImagens` passa a aceitar o bucket:

```ts
urlsImagens(paths: string[], bucket?: 'plantas' | 'fotos'): Promise<Record<string, string>> // padrão 'plantas'
```

Na fixture, as fotos de exemplo dos registros já existentes podem reutilizar recortes da planta. Os registros novos usam as URLs de objeto.

### Orquestrador (`app/src/dados/envio.ts`)

```ts
export interface Rascunho { id: string; obraId: string; ambienteId: string; tipo: 'servico' | 'pendencia'; legenda: string; capturadoEm: string; fotos: FotoPreparada[] }
export function criarRascunho(...): Rascunho // gera o id do registro uma única vez
export async function enviarRegistro(repo: Repositorio, r: Rascunho, aoProgredir?: (p: { enviadas: number; total: number }) => void): Promise<void>
```

1. Envia as fotos em sequência (no máximo 2 ao mesmo tempo), chamando `aoProgredir`.
2. Chama `concluirRegistro`.
3. **Retomada:** se o upload de uma foto falhar com erro de permissão, porque a foto já está vinculada (registro concluído numa tentativa anterior cuja resposta se perdeu), segue direto para `concluirRegistro`. A RPC devolve o registro existente.
4. Erro de rede ou `sessao` sobe como `ErroEnvio` para a tela, e o usuário pode tentar de novo com o mesmo rascunho (mesmos ids).

### Hook

`useNovoRegistro()` (react-query `useMutation`): no sucesso, invalida `['registros']`, `['obra', slug]` e `['ambiente', slug, codigo]`.

## B. Telas

- **Rota** `/obras/:slug/ambientes/:codigo/novo`, que é **Novo registro**. A flag `recursos.novoRegistro` passa a valer `true`. O botão "Novo registro" do Ambiente leva a essa rota.
- **Campos e controles:**
  - cabeçalho com o ambiente e o pavimento;
  - botões "Câmera" (`<input type="file" accept="image/*" capture="environment">`) e "Galeria" (`<input type="file" accept="image/*" multiple>`);
  - até 10 fotos;
  - miniaturas com botão remover e indicação de "preparando…" enquanto a foto comprime;
  - tipo **Serviço / Pendência**, obrigatório e sem padrão;
  - legenda obrigatória, de 1 a 1000 caracteres, com contador.

  A compressão começa logo que a foto é escolhida.
- **Botão "Salvar registro":**
  - habilitado só quando estiver válido;
  - durante o envio, mostra o progresso ("Enviando fotos 2 de 3…" e depois "Concluindo…");
  - o formulário fica bloqueado durante o envio.
- **Sucesso:** volta ao Ambiente na aba Histórico (substituindo a rota do formulário no histórico) e mostra o aviso "Registro salvo".
- **Erro:** a mensagem aparece e o botão vira "Tentar de novo", reaproveitando o mesmo rascunho.
- **Saída com formulário preenchido:** ao sair pelo BackButton ou pelo Voltar, o app pede confirmação ("Descartar este registro?"). O rascunho em IndexedDB fica para a fase 5.
- Telegram: enquanto o formulário estiver preenchido, `enableClosingConfirmation()`. O wrapper `telegram.ts` ganha essa função e `disableClosingConfirmation()`, sem efeito fora do Telegram.
- **Histórico** (Ambiente, Registros, Pendências e Últimos registros):
  - cada item mostra a primeira foto em miniatura, com "+N" quando houver mais, o tipo, a legenda, o autor, o horário e o estado de publicação;
  - os estados de publicação são:
    - "Aguardando publicação" para `pendente` e `enviando`;
    - "Publicado no tópico" para `publicado`;
    - "Publicação com problema" para `incerto` e `falhou`.
  - Tocar na miniatura abre um visualizador em tela cheia, com as fotos do registro, deslizar ou botões anterior/próxima e botão fechar. As URLs vêm de `urlsImagens(paths, 'fotos')`.

## C. Verificação

- **Vitest:**
  - `dimensoesAlvo`: retrato, paisagem e imagem menor que o limite;
  - `capturado_em`: mínimo, futuro limitado e sem arquivos;
  - orquestrador com repositório falso:
    - ordem upload → concluir;
    - progresso;
    - retomada quando a foto já está vinculada;
    - repetir não duplica;
    - erro de rede preserva o rascunho;
  - fixture: validações e idempotência;
  - tela Novo registro:
    - botão desabilitado até ficar válido;
    - envio com sucesso volta ao Histórico com o registro novo;
    - erro mostra "Tentar de novo";
    - confirmação ao sair.
  - Para a tela, `prepararFoto` é substituída por mock, porque o jsdom não tem canvas.
- **Playwright** (fixture):
  - Ambiente → Novo registro → escolher uma foto de teste (`app/e2e/fixtures/com-gps.jpg`, JPEG pequeno com EXIF de GPS gerado no teste ou versionado) → Pendência → legenda → Salvar → o Histórico mostra o registro com a miniatura e "Aguardando publicação";
  - o blob enviado é JPEG, tem lado maior ≤ 1920 e **não contém** o marcador EXIF/GPS (procurar `Exif` nos bytes).
- O build de produção continua sem a fixture.
