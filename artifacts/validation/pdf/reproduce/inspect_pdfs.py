from pathlib import Path
import fitz, json, hashlib, re
root=Path(__file__).resolve().parents[4]
out=root/'artifacts/validation/pdf'
out.mkdir(parents=True,exist_ok=True)
inv={'coordinate_system':{'unit':'PDF point (1/72 inch)','origin':'top-left of unrotated page','bbox_order':['x0','y0','x1','y1'],'normalized_bbox':'coordinates divided by page width and height'},'documents':[]}
for path in sorted((root/'DOCS HTO/PDF').glob('*.pdf')):
 doc=fitz.open(path)
 record={'path':str(path.relative_to(root)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,'page_count':len(doc),'pages':[]}
 for i,p in enumerate(doc):
  w,h=p.rect.width,p.rect.height
  spans=[]
  for b in p.get_text('dict')['blocks']:
   for line in b.get('lines',[]):
    for s in line['spans']:
     txt=s['text'].strip()
     if not txt: continue
     box=[round(v,3) for v in s['bbox']]
     spans.append({'text':txt,'bbox':box,'normalized_bbox':[round(box[0]/w,7),round(box[1]/h,7),round(box[2]/w,7),round(box[3]/h,7)],'size':round(s['size'],3),'direction':list(line['dir'])})
  filename=f'{path.stem}-page-{i+1}.png'
  scale=min(2400/w,2400/h)
  p.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False).save(out/filename)
  text=p.get_text()
  (out/f'{path.stem}-page-{i+1}.txt').write_text(text)
  words=[{'text':v[4],'bbox':[round(x,3) for x in v[:4]],'block':v[5],'line':v[6],'word':v[7]} for v in p.get_text('words')]
  page={'page':i+1,'width_points':w,'height_points':h,'rotation':p.rotation,'embedded_images':len(p.get_images()),'floor':'Térreo' if 'DE017' in path.name else '1º pavimento','preview':str((out/filename).relative_to(root)),'text_spans':spans,'words':words,'floor_title_candidates':[s for s in spans if re.search(r'PAV|T[ÉE]RREO|ANDAR|PLANTA|COBERTURA|SUBSOLO',s['text'],re.I)],'room_label_candidates':[s for s in spans if re.search(r'VEST|SANIT|SALA|COPA|DML|DEP[ÓO]|CIRC|QUARTO|HALL|WC|CONSULT|ESTAR|RECEP|EXPURGO|APOIO|ALMOX',s['text'],re.I)]}
  pattern=r'^(VEST\.|BARBEARIA$|DEPÓSITO$|DML(?: / ROUPARIA)?$|ADMIN\.$|ALOJAMENTO$|COPA |BHO |RECEPÇÃO$|SALÃO |LOBBY$|DESPENSA$|APTO\.|CPD$|CIRC\.|BUFFET$|Jardim$|Piscina$|COWORKING$|Circulação$)'
  page['room_labels']=[s for s in spans if re.search(pattern,s['text'])]
  page['room_label_candidates_note']='Text candidates and room_labels do not contain room wall polygons.'
  record['pages'].append(page)
 inv['documents'].append(record)
(out/'inventory.json').write_text(json.dumps(inv,ensure_ascii=False,indent=2))
print(json.dumps([{k:v for k,v in d.items() if k!='pages'}|{'pages':[{'page':p['page'],'dimensions':[p['width_points'],p['height_points']],'span_count':len(p['text_spans']),'title_candidates':p['floor_title_candidates'],'room_candidate_count':len(p['room_label_candidates']),'vestiarios':[s for s in p['text_spans'] if 'vest' in s['text'].lower()]} for p in d['pages']]} for d in inv['documents']],ensure_ascii=False,indent=2))

# Detail clips used for visual room identification; raster scale is pixels/point.
p=fitz.open(root/'DOCS HTO/PDF/CE01-14PE01-ARQ-DE017-R05.pdf')[0]
p.get_pixmap(matrix=fitz.Matrix(3,3),clip=fitz.Rect(355,70,730,345),alpha=False).save(out/'ground-vestiarios-detail.png')
p.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(810,700,1050,870),alpha=False).save(out/'ground-apto101-detail.png')
