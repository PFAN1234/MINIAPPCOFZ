# Validação do piloto HTO

Data: 2026-11-05. Estado: diagnóstico exploratório; federação ainda não validada para publicação à equipe.

## Documentos e ambiente piloto

Os originais são duas plantas PDF de arquitetura, revisões R05, e três modelos IFC2X3: ARQ R05, ANT R01 e TLD R00, em `DOCS HTO/`. Os inventários, textos, imagens e scripts de reprodução estão em `artifacts/validation/`.

O APTO. 101 do térreo corresponde geometricamente ao IfcSpace `0vfo$Cu9vBkhdNguKiGtzT`, cujo Name é `23`. O nome numérico do espaço não é o número do apartamento. A associação se apoia na área IFC de 23,8788 m² versus 23,88 m² na planta, no retângulo interno de 6,03 × 3,96 m e na vizinhança: apartamento 102, despensa e banheiro 101. A aprovação operacional do vínculo continua sendo uma etapa humana antes de liberar o ambiente à equipe.

O banheiro é um espaço separado: GUID `08arOxA3r6oAwA$PXqJ0ly`, Name `14`, área 5,244 m². Seu limite interior em Y termina em 293,914274675714 m; o apartamento começa em 294,114274675714 m. Portanto há 0,20 m entre os interiores. A região de seleção do apartamento deve preservar essa separação.

## Calibração PDF → IFC

A planta do térreo usa origem no canto superior esquerdo, em pontos PDF (1/72 polegada). Para a frame `footprint_world_xy_m` do inventário ARQ:

```text
pdf_x = 22,677821011674272 × ifc_y − 5800,472963677355
pdf_y = 22,677821011674272 × ifc_x − 3613,1408682403426
```

A transformação foi ajustada com dois cantos opostos do apartamento medidos visualmente. Um canto independente do vestiário masculino apresentou residual de 0,131 ponto PDF, abaixo da incerteza manual assumida de ±0,5 ponto. A escala é coerente com 1:125. O resultado é exploratório, sem precisão topográfica certificada, e vale apenas para essa viewport dessa revisão. O primeiro pavimento exige calibração própria.

Evidências: `artifacts/validation/pdf/registration-ground.json`, `pilot-candidate.json` e as sobreposições geradas por `reproduce/calibrate_ground.py`. O retângulo aproximado de `pilot-candidate.json` serve como alvo de clique inicial; o contorno derivado do IfcSpace em `registration-ground.json` é a referência geométrica mais precisa disponível.

## Transformação candidata entre disciplinas

As unidades dos três modelos são metros. A geometria ARQ inventariada já inclui a cadeia de placements, mas não soma o deslocamento WCS do contexto. A geometria ANT/TLD produzida com `use-world-coords` contém coordenadas de engenharia grandes. Não somar novamente os deslocamentos de site/building ou o WCS.

Para vetores coluna homogêneos, a transformação candidata da frame ARQ usada no inventário para a frame ANT/TLD é:

```text
[-0.6615518497771224   0.7498994266276429  0   553092.4079999995]
[-0.7498994266276429  -0.6615518497771224  0  9583895.954       ]
[ 0                   0                   1        0           ]
[ 0                   0                   0        1           ]
```

A rotação coincide com a orientação espacial de ANT/TLD e é coerente com TrueNorth de ARQ; a translação vem do WCS ARQ. Para trazer malhas ANT/TLD à frame ARQ, aplicar a inversa dessa matriz. O Z permanece inalterado. Não há IfcMapConversion formal nos inventários, nem comprovação de CRS por essas coincidências.

O relatório original `artifacts/validation/ifc/alignment-evidence.json` encontrou 13 coincidências em XY entre pontos médios de faces de placas ANT e limites dos espaços, com tolerância de 1 mm e amostras distribuídas. Isso sustenta a hipótese horizontal de ANT. O relatório original só apresenta coincidências: não constitui uma amostragem completa de acertos e erros, controle independente de TLD, checagem de interferências ou validação vertical.

## Alturas e limites físicos

O térreo tem Z composto igual a zero em ARQ, ANT e TLD. No primeiro pavimento, a matriz composta ARQ dá 4,000 m e as matrizes ANT/TLD dão aproximadamente 3,965 m. A diferença de 35 mm não justifica somar 35 mm globalmente: isso modificaria o térreo que já coincide. A revisão também encontrou elementos TLD superiores compatíveis com ambos os referenciais de altura, exigindo inspeção por elemento.

O IfcSpace do apartamento vai de Z=0 a 3,50 m, mas esse volume não determina sozinho o piso acabado ou o forro. Há duas portas ARQ do quarto com origem de placement em Z=0,385 m (GUIDs `1jamuaR2HAD8Pw8c89i9fS` e `2T3U3$Mtv4EPhg1Z3zkDzf`). O forro `1wGxdLCv517eQKi_CKaP5U` tem referência em Z=2,985 m e nome com H=2,60 m, coerente com 2,985−0,385=2,60. Placements e nomes são indícios; as faces convertidas precisam confirmar as superfícies físicas.

Placas TLD em Z=0,785 m são compatíveis com 0,40 m acima do piso candidato. Uma placa ANT em Z=1,88 m é compatível com 1,50 m acima de 0,38 m; a diferença local para 0,385 m é 5 mm. Não aplicar compensação artificial nem tratar essas alturas de instalação como pontos homólogos certificados.

## Critérios para avançar

O recorte técnico pode ser produzido para inspeção enquanto o status continua `candidate/not_validated`. Deve conter malhas reais das disciplinas, recortar elementos que atravessam o limite e guardar origem local comum, eixos, matrizes, GUIDs, revisão, tamanho e falhas de conversão. Ausência de elementos no recorte deve ser explícita.

Para publicar como federado, ainda é necessário:

- Validar pontos homólogos distribuídos de cada disciplina, incluindo TLD, com ao menos um ponto não usado em eventual ajuste.
- Conferir Z em superfícies físicas e referências correspondentes, separando diferenças de projeto das diferenças de coordenadas.
- Conferir visualmente piso, paredes, portas, forro, corte e exclusão de interiores vizinhos.
- Revisar e aprovar o vínculo operacional APTO. 101 ↔ GUID e manter a revisão de documentos associada.

Uma inversa numericamente correta ou um elemento dentro do apartamento comprova o cálculo/ocupação, mas não substitui um controle independente de alinhamento. O checklist em `tasks/todo.md` deve manter aberta a transformação de federação validada até esses critérios serem cumpridos.
