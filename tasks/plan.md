# Mini App Telegram — piloto HTO

> **Atualização 2026-11-09:** a ordem de implementação foi revista em `tasks/plano-app.md`. O visualizador do modelo federado e a planta clicável passam para a última fase; antes vêm navegação por lista, registros, pendências, modo sem conexão e publicação no tópico da obra. A stack escolhida é Supabase (Postgres, RLS, Storage, Edge Functions) e frontend React/Vite na Vercel, no lugar de FastAPI. A publicação vai para o tópico de cada obra no supergrupo CO-FZ. Onde este documento divergir, prevalece `tasks/plano-app.md`.

## Objetivo confirmado

Permitir que a equipe percorra obra → andar → planta 2D → ambiente → modelo federado 3D isolado e registre fotos com legenda e tipo: serviço em execução ou pendência. O histórico pertence ao ambiente e uma cópia é publicada no grupo da obra. Pendências são encerradas por gestor com foto de comprovação. O acesso é autorizado por obra. Registros feitos com sinal instável aguardam envio.

O piloto usa os documentos HTO. A estrutura deve comportar outras obras. A primeira versão não inclui operação integral do 3D sem internet, responsáveis e prazos de pendência, nem migração automática das fotos antigas dos grupos.

## Primeiro marco: planta e ambiente real

1. Inventariar PDFs e IFCs, preservar originais e produzir evidências reproduzíveis em `artifacts/validation/`.
2. Resolver unidades e transformações de cada modelo. Não corrigir diferenças apenas pelo atributo Elevation do pavimento. Registrar transformação de federação e origem local de renderização por revisão.
3. Calibrar a planta do térreo com espaços IFC; usar o Apto. 101 se a correspondência geométrica for validada. O nome numérico de um IfcSpace não equivale ao número do apartamento.
4. Preparar o recorte do ambiente com elementos reais das disciplinas disponíveis. Volume IfcSpace serve para seleção e delimitação, mas não substitui paredes, pisos e instalações.
5. Criar a fatia navegável obra HTO → térreo → planta → ambiente → 3D. Validar no portal Maestri em dimensões móveis e depois no Telegram em aparelho real.

Aceite: toque no interior do ambiente abre o recorte correspondente; ambientes vizinhos não são selecionados por engano; o banheiro permanece separado do apartamento; a geometria carrega sob demanda sem enviar o IFC completo ao celular. Comprovar a federação em pontos distribuídos, incluindo ao menos um ponto de controle não usado no ajuste. Alinhamento ainda não confirmado deve impedir publicar o conjunto como federado.

## Decisões para implementar

- **Plantas:** manter o PDF original e gerar derivados por revisão. Sobrepor polígonos clicáveis em coordenadas normalizadas da página; calibrar cada viewport de planta separadamente. Revisão humana dos vínculos antes de liberar à equipe. Guardar nome operacional próprio, GUID do espaço, modelo e revisão; nomes genéricos não são identificadores de negócio.
- **Modelos:** processamento fora do celular com IfcOpenShell. Gerar malhas leves GLB e metadados por ambiente/disciplina, com origem local comum para evitar perda de precisão. Fazer corte geométrico pelo contorno do ambiente e extensão vertical explicitamente conferida; incluir faces de limite necessárias à compreensão. Elementos que cruzam ambientes devem ser recortados, e não exibidos inteiros. Se uma disciplina não possuir elementos no recorte, informar isso sem fabricar conteúdo.
- **Aplicação:** frontend TypeScript com React, visualização Three.js e camada 2D SVG sobre derivado da planta. API Python/FastAPI, PostgreSQL para relações e estado, armazenamento de objetos para documentos, malhas e fotos. Processamento IFC em worker separado da API. Essas são escolhas propostas para a implementação; ainda não há aplicação instalada.
- **Identidade:** validar `Telegram.WebApp.initData` no servidor, incluindo assinatura e validade temporal. Autorizar cada consulta e gravação pela participação na obra. Token do bot apenas no servidor. Equipe cria registros; gestor administra acesso e encerra pendências.
- **Registros:** uma ou mais fotos, legenda obrigatória, ambiente, tipo, autor e horários de captura/envio. Identificador gerado no cliente permite repetir uploads sem criar outro registro. Foto de encerramento pertence à pendência original; manter histórico e autor do encerramento.
- **Conexão instável:** IndexedDB para rascunhos e fotos pendentes. Confirmar gravação local antes de mostrar “aguardando envio”. Retomar ao abrir o app e ao recuperar conexão; oferecer tentativa manual. Distinguir salvo no aparelho, salvo no servidor e publicado no grupo. Detectar falta de espaço e falhas de persistência. Não prometer envio com o app fechado nem armazenamento local infalível.
- **Telegram:** gravar o registro no servidor antes de publicar. Fila transacional de saída com acompanhamento de tentativas; falha no grupo não apaga o registro. A Bot API não garante publicação exatamente uma vez em respostas ambíguas: registrar estado incerto e permitir reconciliação pelo gestor em vez de repetir indefinidamente. Publicação inclui obra, andar, ambiente, tipo, legenda, autor e link de retorno ao registro.
- **Revisões:** manter histórico ligado à revisão original. Novos IFCs/PDFs exigem revalidar vínculos e recortes antes de ativar. Nunca religar registros somente por nome ou número de espaço.

## Interfaces mínimas

- Entidades: Obra, Participação (equipe/gestor), Pavimento, Revisão de documentos, Ambiente, Vínculo planta/IFC, Recorte 3D, Registro, Foto, Encerramento e Publicação Telegram.
- Consultas autenticadas: obras permitidas, pavimentos, planta com polígonos, ambiente com recortes disponíveis, histórico e pendências abertas.
- Comandos autenticados: iniciar upload, concluir registro com chave de idempotência e encerrar pendência com comprovação. O servidor valida que foto, ambiente e participação pertencem à mesma obra.
- Administração: importar documentos, revisar a calibração e os nomes, ativar revisão, vincular grupo e autorizar pessoas. Segredos e IDs reais de implantação serão configurados fora dos documentos versionados.

## Validação e implantação

- Conferir escala, orientação, contorno e correspondência em ambientes afastados no PDF; testar zoom e seleção nas bordas e nos espaços adjacentes.
- Conferir coordenadas horizontais e verticais entre disciplinas; não confundir modelo georreferenciado com modelo já alinhado. Documentar erros de geometria e espaços não processados.
- Medir tamanho transferido, tempo até primeiro quadro e memória do recorte. Fixar orçamento de desempenho após a medição em celular representativo; nenhuma meta foi medida ainda.
- Testar negativa de acesso entre obras, sessão inválida, upload interrompido, reenvio idempotente, falta de espaço local, reabertura com rascunho, falha de publicação e tentativa de encerramento por equipe.
- No portal Maestri, verificar telas móveis e UA iOS/Android. Em aparelho real, verificar câmera/permissões, Telegram WebView, recuperação de rascunho e desempenho 3D. Emulação de viewport não comprova comportamento nativo.
- Antes de operação real: bot e grupo de teste, HTTPS, armazenamento com backup e acesso restrito, observação de falhas de importação/upload/publicação e reversão para a revisão anterior de documentos.

## Modelos de trabalho

Preferência do usuário: GPT-6 Astra com esforço high para planejamento e tarefas complexas; GPT-6.1 Sol ou Terra com esforço high para programação e tarefas simples. Definir explicitamente esses parâmetros em agentes delegados.

## Referências técnicas

- [Telegram Mini Apps — identidade e integração](https://core.telegram.org/bots/webapps).
- [IfcOpenShell — processamento geométrico](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html).
- [MDN — limites e remoção de armazenamento local](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

Detalhes encontrados nos documentos e limitações da calibração devem ser lidos em `docs/validacao-hto.md`. A execução é acompanhada em `tasks/todo.md`.
