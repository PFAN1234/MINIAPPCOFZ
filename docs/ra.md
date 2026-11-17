# Realidade aumentada (RA)

Plano: `tasks/plano-ra.md`. Contrato de dados: `docs/contrato-ra.md`. Cadastro e impressão do QR: `docs/admin.md`, seção "Realidade aumentada (QR)".

## Como o fiscal usa

1. No ambiente, toca em **Comparar com o modelo (RA)** (também aparece dentro do Novo registro). O botão só existe quando o ambiente tem geometria e a obra tem modelo 3D publicado.
2. **Abrir câmera.** O Telegram pede a câmera e, no iPhone, o sensor de movimento.
3. **Alinhar**, sem sair do lugar:
   - por cantos: apontar a mira (fixa no centro da imagem) para um canto do ambiente e tocar em **Marcar canto**; dizer na planta qual canto é e se está no piso ou no teto; repetir com outro canto. Tocar na imagem não marca canto. Quando a planta do cômodo está cadastrada, a folha mostra a planta real com os cantos numerados e uma miniatura fica no canto da tela. Enquanto não há alinhamento, a malha de procura mostra o piso estimado pela inclinação do celular;
   - por QR, quando o ambiente tem um cadastrado: **Usar o QR do ambiente** e apontar para ele.
4. **Ajuste fino:** arrastar para os lados gira o modelo, arrastar para cima e para baixo sobe e desce, pinça corrige o tamanho (ângulo de visão da câmera, guardado no aparelho). O contorno amarelo do ambiente deve encaixar nas arestas reais. A malha (chip **Malha**) mostra onde o sistema acha que estão piso, paredes e teto; ela não enxerga o ambiente e não sai na foto com o modelo. **Conferir canto** aponta a mira para um terceiro canto e mede o erro (**Conferir este canto**).
5. **Disparar.** Cada disparo gera duas fotos: a limpa e a com o modelo e a faixa de identificação. **Usar N fotos** leva o par ao registro; o limite de 10 fotos continua valendo.
6. Se andar, **Alinhar de novo**.

Num ambiente retangular, os cantos opostos se confundem: se o modelo aparecer virado (porta ou janela do lado errado), alinhe de novo escolhendo os outros cantos. Ligar a disciplina ARQ ajuda a conferir portas e janelas.

No histórico, o registro com fotos da RA leva o selo **RA**. O banco guarda em `foto.ra` contra qual revisão de cada modelo a comparação foi feita, o método de alinhamento, a pose e o erro do canto conferido.

## Limites

- O celular sabe para onde está virado, não que andou. A posição do modelo é indicativa: serve para ver se o ponto está onde o projeto diz, não para medir.
- Sem oclusão: o modelo aparece por cima de tudo.
- Sem sensor de orientação, a RA abre com aviso e só vale com o celular parado.
- Sem sinal, a RA abre se já tiver sido aberta antes naquele aparelho (os arquivos do 3D e o modelo ficam guardados depois do primeiro uso). No iPhone o Telegram não mantém esse cache do app, só o do modelo.

## Teste do aparelho (RA0)

Tela `/ra-teste`, também pelo link `https://t.me/<bot>/<app>?startapp=ra_teste`. Mostra resolução da câmera, fonte e frequência do sensor, giro acumulado (deixe o celular parado por um minuto), WebGL 2, leitor de QR e a versão da Bot API. Fazer em um Android e em um iPhone, dentro do Telegram, e guardar a captura da tela.

## Aplicar num projeto

1. Aplicar a migration `supabase/migrations/20261113090000_ra.sql`.
2. Gerar e aplicar a geometria: `python scripts/gerar_geometria.py --obra hto` e depois `supabase/seed/hto_geometria.sql` (ver `scripts/README.md`).
3. Publicar os modelos pelo `/admin/` (Modelos 3D). O ARQ publicado tem de ser o mesmo `.frag` usado no ajuste do referencial (`ra_referencial`); se o ARQ for convertido de novo, refazer o ajuste descrito no contrato.
4. Cadastrar os QRs no `/admin/` (opcional).
5. Publicar o app. Enquanto a migration não for aplicada, o app novo funciona como antes e o botão da RA não aparece.

## Outras disciplinas (ELT e demais)

Os modelos entram no referencial do ARQ pela coordenação que a conversão grava em cada `.frag`. Isso basta quando o IFC da disciplina usa as mesmas coordenadas do IFC de arquitetura.

Conferido em 2026-11-13 com os modelos publicados da HTO: o ARQ R06 (hash `497ec6abd4af7884`) tem as mesmas coordenadas e a mesma geometria do `.frag` usado no ajuste; o ELT R03 (hash `f625bb7739d2a982`) cai no lugar só com a coordenação, sem `modelo.matriz` — 82% das descidas verticais de eletroduto ficam a menos de 6 cm da face de uma parede (mediana de 2,6 cm), e um ajuste livre muda a posição em 1 cm. Se o modelo aparecer deslocado (o caso de ANT e TLD em `docs/validacao-hto.md`), gravar a correção em `modelo.matriz` (16 números, ordem de `THREE.Matrix4.elements`), aplicada depois da coordenação.

## Código

- `app/src/ra/pose.ts`: conta do alinhamento (dois cantos, QR, erro do terceiro canto).
- `app/src/ra/orientacao.ts`: sensores (evento do navegador e API do Telegram).
- `app/src/ra/motor.ts`: cena 3D, corte em volta do ambiente e contorno.
- `app/src/ra/camera.ts`, `leitorQr.ts`: câmera, captura do par e leitura do QR.
- `app/src/ra/TelaRA.tsx`: a tela; `DiagnosticoRA.tsx`: teste do aparelho.
- `scripts/gerar_geometria.py`: vínculo ambiente ↔ IfcSpace e geometria.
