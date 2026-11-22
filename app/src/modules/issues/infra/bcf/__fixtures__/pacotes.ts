/**
 * Pacotes BCF escritos à mão no formato que as ferramentas reais produzem (namespaces xsi, `Labels`
 * repetido na 2.1, `<Label>` na 3.0, `Viewpoints`/`ViewPoint`, nomes de arquivo de snapshot e de
 * viewpoint livres). Cada um é um mapa caminho → XML; `zipDe` gera o `.bcfzip`.
 */
import { strToU8, zipSync, type Zippable } from 'fflate'

/** PNG 1×1 válido (assinatura + IHDR + IDAT + IEND). */
export const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

export const GUID_T1 = '11111111-aaaa-4aaa-8aaa-000000000001'
export const GUID_T2 = '22222222-bbbb-4bbb-8bbb-000000000002'
export const GUID_VP1 = 'aaaaaaaa-1111-4111-8111-00000000000a'
export const GUID_C1 = 'cccccccc-1111-4111-8111-00000000000c'
export const GLOBAL_ID_A = '3cUkl32yn9qRSPvBJVyWYp'
export const GLOBAL_ID_B = '0Nj8yW4Tv0H8pQ2dK1x9aB'

const XSI = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"'

/** BCF 2.1 no estilo do Solibri/BIMcollab: pasta por tópico, `viewpoint.bcfv` e `snapshot.png`. */
export const BCF21: Record<string, string | Uint8Array> = {
  'bcf.version': `<?xml version="1.0" encoding="utf-8"?>
<Version ${XSI} VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>`,
  'project.bcfp': `<?xml version="1.0" encoding="utf-8"?>
<ProjectExtension ${XSI}><Project ProjectId="99999999-0000-4000-8000-000000000009"><Name>Edifício HTO</Name></Project><ExtensionSchema /></ProjectExtension>`,
  [`${GUID_T1}/markup.bcf`]: `\uFEFF<?xml version="1.0" encoding="utf-8"?>
<Markup ${XSI}>
  <Header><File IfcProject="0J$yPqHBD12v72y4qF6XcD" isExternal="true"><Filename>HTO-ARQ.ifc</Filename><Date>2026-10-01T10:00:00Z</Date></File></Header>
  <Topic Guid="${GUID_T1}" TopicType="Clash" TopicStatus="Active">
    <ReferenceLink>https://exemplo.test/t/1</ReferenceLink>
    <Title>Viga atravessa o shaft</Title>
    <Priority>Major</Priority>
    <Index>1</Index>
    <Labels>Estrutura</Labels>
    <Labels>Hidráulica</Labels>
    <CreationDate>2026-11-10T09:15:30-03:00</CreationDate>
    <CreationAuthor>maria@projetos.test</CreationAuthor>
    <ModifiedDate>2026-11-11T08:00:00Z</ModifiedDate>
    <ModifiedAuthor>joao@projetos.test</ModifiedAuthor>
    <DueDate>2026-12-05T00:00:00-03:00</DueDate>
    <AssignedTo>joao@projetos.test</AssignedTo>
    <Stage>Projeto executivo</Stage>
    <Description>Rever a posição da viga V12 &amp; do tubo de 100 mm.</Description>
  </Topic>
  <Comment Guid="${GUID_C1}">
    <Date>2026-11-11T08:00:00Z</Date>
    <Author>joao@projetos.test</Author>
    <Comment>Vou avisar a hidráulica.</Comment>
    <Viewpoint Guid="${GUID_VP1}" />
  </Comment>
  <Comment Guid="cccccccc-2222-4222-8222-00000000000d">
    <Date>2026-11-12T08:00:00Z</Date>
    <Author>maria@projetos.test</Author>
    <Comment>   </Comment>
  </Comment>
  <Viewpoints Guid="${GUID_VP1}">
    <Viewpoint>viewpoint.bcfv</Viewpoint>
    <Snapshot>snapshot.png</Snapshot>
  </Viewpoints>
</Markup>`,
  [`${GUID_T1}/viewpoint.bcfv`]: `<?xml version="1.0" encoding="utf-8"?>
<VisualizationInfo ${XSI} Guid="${GUID_VP1}">
  <Components>
    <ViewSetupHints SpacesVisible="false" SpaceBoundariesVisible="false" OpeningsVisible="false" />
    <Selection>
      <Component IfcGuid="${GLOBAL_ID_A}"><OriginatingSystem>Revit</OriginatingSystem></Component>
      <Component IfcGuid="${GLOBAL_ID_B}" />
    </Selection>
    <Visibility DefaultVisibility="true">
      <Exceptions><Component IfcGuid="${GLOBAL_ID_B}" /></Exceptions>
    </Visibility>
  </Components>
  <PerspectiveCamera>
    <CameraViewPoint><X>12</X><Y>-3</Y><Z>5.5</Z></CameraViewPoint>
    <CameraDirection><X>0</X><Y>1</Y><Z>0</Z></CameraDirection>
    <CameraUpVector><X>0</X><Y>0</Y><Z>1</Z></CameraUpVector>
    <FieldOfView>60</FieldOfView>
  </PerspectiveCamera>
  <ClippingPlanes>
    <ClippingPlane>
      <Location><X>0</X><Y>0</Y><Z>3</Z></Location>
      <Direction><X>0</X><Y>0</Y><Z>-1</Z></Direction>
    </ClippingPlane>
  </ClippingPlanes>
</VisualizationInfo>`,
  [`${GUID_T1}/snapshot.png`]: PNG_1X1,
}

/** BCF 3.0 no estilo do BIMcollab/usBIM: `Comments` e `ViewPoints` dentro de `Topic`, ortográfica e `Label`. */
export const BCF30: Record<string, string | Uint8Array> = {
  'bcf.version': `<?xml version="1.0" encoding="UTF-8"?>
<Version VersionId="3.0"><DetailedVersion>3.0</DetailedVersion></Version>`,
  'project.bcfp': `<?xml version="1.0" encoding="UTF-8"?>
<ProjectInfo><Project ProjectId="99999999-0000-4000-8000-000000000009"><Name>Edifício HTO</Name></Project></ProjectInfo>`,
  [`${GUID_T2}/markup.bcf`]: `<?xml version="1.0" encoding="UTF-8"?>
<Markup>
  <Topic Guid="${GUID_T2}" TopicType="Request" TopicStatus="Resolved">
    <Title>Confirmar altura do peitoril</Title>
    <Priority>Critical</Priority>
    <Labels><Label>Arquitetura</Label><Label>Esquadrias</Label></Labels>
    <CreationDate>2026-11-14T10:00:00Z</CreationDate>
    <CreationAuthor>ana@projetos.test</CreationAuthor>
    <DueDate>2026-12-20T00:00:00Z</DueDate>
    <AssignedTo>eduardo@projetos.test</AssignedTo>
    <Description>Peitoril a 1,10 m?</Description>
    <Comments>
      <Comment Guid="cccccccc-3333-4333-8333-00000000000e">
        <Date>2026-11-15T12:00:00Z</Date>
        <Author>eduardo@projetos.test</Author>
        <Comment>Confirmado em 1,10 m.</Comment>
        <Viewpoint Guid="aaaaaaaa-2222-4222-8222-00000000000b" />
      </Comment>
    </Comments>
    <ViewPoints>
      <ViewPoint Guid="aaaaaaaa-2222-4222-8222-00000000000b">
        <Viewpoint>Viewpoint_aaaa.bcfv</Viewpoint>
        <Snapshot>Snapshot_aaaa.jpg</Snapshot>
      </ViewPoint>
    </ViewPoints>
  </Topic>
</Markup>`,
  [`${GUID_T2}/Viewpoint_aaaa.bcfv`]: `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="aaaaaaaa-2222-4222-8222-00000000000b">
  <Components>
    <Visibility DefaultVisibility="false">
      <Exceptions><Component IfcGuid="${GLOBAL_ID_A}" /></Exceptions>
    </Visibility>
  </Components>
  <OrthogonalCamera>
    <CameraViewPoint><X>5</X><Y>5</Y><Z>40</Z></CameraViewPoint>
    <CameraDirection><X>0</X><Y>0</Y><Z>-1</Z></CameraDirection>
    <CameraUpVector><X>0</X><Y>1</Y><Z>0</Z></CameraUpVector>
    <ViewToWorldScale>25</ViewToWorldScale>
  </OrthogonalCamera>
</VisualizationInfo>`,
  // Primeiros bytes de um JPEG (o conteúdo não importa para a leitura do pacote).
  [`${GUID_T2}/Snapshot_aaaa.jpg`]: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]),
}

/** Gera o `.bcfzip` de um dos pacotes acima (ou de um derivado). */
export function zipDe(arquivos: Record<string, string | Uint8Array>): Uint8Array {
  const z: Zippable = {}
  for (const [nome, c] of Object.entries(arquivos)) z[nome] = typeof c === 'string' ? strToU8(c) : c
  return zipSync(z)
}
