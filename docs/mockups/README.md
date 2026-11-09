# Mockup do Mini App — proposta 2

## Demonstração em GIF

[Abrir a demonstração animada atualizada](demo-mini-app-v2.gif) · [Ver roteiro em imagens](demo-preview-v2.png)

GIF vertical de 600 × 1080, duração de 35,65 segundos, repetição contínua e tamanho de 5.969.255 bytes. Mostra: Geral → lista de obras → HTO → modelo federado → retorno à HTO → histórico do Apto. 101 → novo registro → pendências → encerrar pendência. Inclui as telas 5 e 6 do `mini-app-v2.png`, com toque na primeira pendência para abrir seu detalhe. A passagem do formulário para a lista de pendências é uma transição editorial entre fluxos demonstrativos. Termina na tela de encerramento, sem simular envio ou conclusão da pendência.

Foram conferidos visualmente os nove estados e decodificados todos os 88 quadros do GIF; duração, dimensões e repetição foram verificadas. Montagem com Pillow 13.0.0, preservando as imagens de origem e a [primeira versão do GIF](demo-mini-app.gif).

Para reproduzir a partir da raiz do projeto:

```bash
python3 -m venv /tmp/botrelatorio-gif-env
/tmp/botrelatorio-gif-env/bin/pip install -r docs/mockups/reproduce/requirements-demo.txt
/tmp/botrelatorio-gif-env/bin/python docs/mockups/reproduce/build_demo.py
```

## Entrada pelo Telegram

![Entrada pelo tópico Geral e seleção de obra](entrada-telegram-v2.png)

Proposta atual: mensagem do bot fixada no tópico **Geral**, com botão **Abrir Diário da obra**. O botão abre a tela inicial **Obras**, com HTO, Infraestruturas, Rancho e Telhados e Coberturas. A pessoa escolhe a obra antes de acessar os ambientes e o modelo federado. Nenhuma obra é pré-selecionada. Fechar o Mini App retorna ao Telegram. Nenhuma mensagem foi enviada ou fixada nesta etapa.

Implementação futura: usar botão de URL com link `t.me` do Mini App abrindo o início, sem destino automático HTO, conforme [Direct Link Mini Apps](https://core.telegram.org/bots/webapps#direct-link-mini-apps). Não confundir com botão `web_app` restrito a conversa privada. A seleção da obra não substitui autorização no servidor e não dá acesso automático às mensagens do grupo. A publicação dos registros dependerá do bot configurado.

Gerado com `image_gen`. [Imagem atual](entrada-telegram-v2.png) · [Prompt completo](prompt-entrada-telegram-v2.txt). A [versão anterior](entrada-telegram-v1.png), com entrada direta pela HTO, foi substituída por esta proposta e permanece apenas como histórico.

## Telas do aplicativo

Data: 2026-11-06. Mockup visual estático, com dados ilustrativos; não representa aplicação implementada nem publicação real no Telegram.

A integração IFC/planta 2D foi pausada a pedido do usuário. O fluxo proposto usa seleção por lista: obra/grupo → frente → pavimento → ambiente → histórico ou novo registro.

Ao abrir HTO, a proposta 2 inclui o cartão **Visualizar modelo federado**, antes da seleção de ambiente. Esse acesso é independente da integração IFC/planta 2D, que continua pausada. Nesta etapa, o cartão é uma proposta visual de navegação.

![Prancha com seis telas](mini-app-v2.png)

1. Frentes da obra: organização do grupo CO-FZ, incluindo HTO, Infraestruturas, Rancho e Telhados e Coberturas.
2. HTO: acesso ao modelo federado, pavimento e lista de ambientes.
3. Histórico do ambiente: foto, legenda, autoria e estado de publicação do registro.
4. Novo registro: câmera/galeria, tipo, legenda e exemplo de armazenamento local sem conexão.
5. Pendências: abertas/resolvidas, com ambiente e evidência original.
6. Encerrar pendência: ação do gestor com foto de comprovação separada da foto original.

## Tela 7 — modelo federado

### Transição HTO → modelo federado e projetos complementares

![Transição da página HTO para o modelo federado](hto-modelo-federado-v1.png)

A proposta atual mostra a página inicial HTO e a abertura do visualizador lado a lado. O seletor usa somente as siglas de três letras presentes na referência `Screenshot 2026-11-06 072441.png`: **ARQ, ELT, HID, ESG, DRE, PCI, VES, TLD e ANT**. As nove opções aparecem simultaneamente em uma grade; apenas ARQ está selecionado no exemplo, compatível com a imagem de arquitetura. A presença das siglas no mockup não indica importação dos respectivos arquivos.

Gerado com a ferramenta integrada `image_gen`. [Imagem da transição](hto-modelo-federado-v1.png) · [Prompt completo](prompt-hto-modelo-federado-v1.txt).

### Primeira proposta do visualizador

Proposta complementar acessada por **HTO → Visualizar modelo federado**, usando a terceira imagem fornecida (`Screenshot 2026-11-06 063757.png`) como referência visual da edificação.

![Tela do modelo federado](modelo-federado-v1.png)

Inclui filtro por pavimento, tela cheia, zoom, giro, deslocamento, enquadramento e seleção dos modelos ARQ/ANT/TLD. O exemplo mostra apenas ARQ ligado, coerente com a captura de arquitetura. A imagem foi recomposta pelo `image_gen`; os controles são propostas visuais, sem implementação ou validação de federação nesta etapa.

Artefato: [modelo-federado-v1.png](modelo-federado-v1.png). Prompt completo usado na ferramenta integrada: [prompt-modelo-federado-v1.txt](prompt-modelo-federado-v1.txt).

Referências fornecidas pelo usuário: `Screenshot 2026-11-06 061618.png` (tópicos do grupo) e `Screenshot 2026-11-06 061729.png` (registros HTO e fotos). As pendências, estados e controles na proposta são exemplos de interface, sem afirmar defeitos reais, sincronização ou encerramento desses serviços. As fotos na prancha foram recompostas pela ferramenta de geração para referência visual.

Gerado com a ferramenta integrada `image_gen`, via skill `imagegen`. Prompt da atualização: [prompt-mini-app-v2.txt](prompt-mini-app-v2.txt). Artefato atual: [mini-app-v2.png](mini-app-v2.png). Primeira versão preservada: [mini-app-v1.png](mini-app-v1.png), com [prompt original](prompt-mini-app-v1.txt).
