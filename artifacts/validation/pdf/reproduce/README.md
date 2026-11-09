# Reprodução da inspeção dos PDFs

Executar a partir da raiz do projeto, preservando a posição desta pasta. Originais são somente lidos. Dependência usada: PyMuPDF 1.26.7; Python 3.14.

```bash
python3 -m venv /tmp/botrelatorio-pdf-env
/tmp/botrelatorio-pdf-env/bin/pip install -r artifacts/validation/pdf/reproduce/requirements.txt
/tmp/botrelatorio-pdf-env/bin/python artifacts/validation/pdf/reproduce/inspect_pdfs.py
/tmp/botrelatorio-pdf-env/bin/python artifacts/validation/pdf/reproduce/calibrate_ground.py
```

O segundo script requer `artifacts/validation/ifc/CE01-14PE01-ARQ-R05-inspection.json`, gerado na inspeção IFC. O primeiro gera inventário dos dois PDFs, texto, previews completos e dois recortes. A seleção piloto está descrita em `../pilot-candidate.json`; a calibração e o GUID definitivo estão em `../registration-ground.json`.

Foram inspecionadas visualmente as duas páginas, os recortes APTO101/Vestiário e a sobreposição global dos 53 espaços do térreo. O inventário identifica 453/445 spans e 44/43 candidatos estritos a rótulos de ambientes; estes últimos são heurísticos. A planta combina textos extraíveis com imagens raster. Os textos não definem limites dos ambientes.

A calibração usa dois cantos opostos do APTO101 medidos no raster e um canto independente do Vestiário Masc., respeitando a orientação com troca de eixos. Escala resultante 22,677821 pt/m, coerente com escala impressa 1:125; residual do controle 0,131 pt, abaixo da incerteza manual assumida de ±0,5 pt. Esses números documentam a calibração exploratória; não garantem precisão topográfica nem validade para outros PDFs. A sobreposição azul permite revisão humana da correspondência.

Coordenadas PDF: origem superior esquerda, pontos de 1/72 pol. Coordenadas IFC: frame `footprint_world_xy_m` do inventário IFC, sem somar novamente o offset de georreferenciamento. O primeiro pavimento deve ter calibração própria. SHA-256 dos originais está no inventário. Não houve alteração dos originais.
