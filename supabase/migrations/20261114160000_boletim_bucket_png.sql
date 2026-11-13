-- O bucket `boletins` também guarda a imagem do clima copiada na emissão
-- (<etapa_id>/<numero sem barras>-clima.png). Sem `image/png` na lista, o upload falhava
-- ("mime type image/png is not supported") e a emissão não terminava.

update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/png']
 where id = 'boletins';
