import { describe, expect, it } from 'vitest'
import type { RegistrosRepositorio } from './RegistrosRepositorio.port.ts'

export interface SementeRegistros {
  repo: RegistrosRepositorio
  obraId: string
  obraSlug: string
  ambienteId: string
  pendenciaAbertaId: string
  pendenciaResolvidaId: string
}

const JPEG = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })

/**
 * Contrato reutilizável de `RegistrosRepositorio`.
 * Espera uma obra com pelo menos uma pendência aberta e uma resolvida na semente.
 */
export function contratoRegistros(nome: string, criar: () => SementeRegistros) {
  describe(`RegistrosRepositorio (${nome})`, () => {
    it('lista registros ordenados do mais recente ao mais antigo e aplica filtros', async () => {
      const { repo, obraSlug } = criar()
      const todos = await repo.listarRegistros({ obraSlug })
      expect(todos.length).toBeGreaterThan(0)
      for (let i = 1; i < todos.length; i++) {
        expect(todos[i - 1].recebido_em >= todos[i].recebido_em).toBe(true)
      }
      const soPendencias = await repo.listarRegistros({ obraSlug, tipo: 'pendencia' })
      expect(soPendencias.every((r) => r.tipo === 'pendencia')).toBe(true)
      const limitado = await repo.listarRegistros({ obraSlug, limite: 1 })
      expect(limitado).toHaveLength(1)
    })

    it('lista autores dos registros visíveis', async () => {
      const { repo } = criar()
      const autores = await repo.autoresRegistros()
      expect(autores.length).toBeGreaterThan(0)
      expect(autores[0]).toEqual(expect.objectContaining({ id: expect.any(String), nome: expect.any(String) }))
    })

    it('envia foto, conclui registro de forma idempotente e localiza o registro', async () => {
      const { repo, obraId, ambienteId } = criar()
      const registroId = '11111111-1111-4111-8111-111111111111'
      const fotoId = '22222222-2222-4222-8222-222222222222'
      await repo.enviarFoto({ obraId, registroId, fotoId }, JPEG())

      const dados = {
        id: registroId,
        ambienteId,
        tipo: 'servico' as const,
        legenda: 'Conferência de piso concluída.',
        capturadoEm: new Date().toISOString(),
        fotos: [{ id: fotoId, largura: 800, altura: 600, bytes: 1024 }],
      }
      expect(await repo.concluirRegistro(dados)).toEqual({ id: registroId })
      // Repetir com o mesmo id não duplica
      expect(await repo.concluirRegistro(dados)).toEqual({ id: registroId })

      const localizado = await repo.localizarRegistro(registroId)
      expect(localizado).toEqual(expect.objectContaining({ tipo: 'servico' }))
      expect(await repo.localizarRegistro('nao-existe')).toBeNull()
    })

    it('obtém detalhe de pendência e encerra de forma idempotente', async () => {
      const { repo, obraId, pendenciaAbertaId, pendenciaResolvidaId } = criar()
      const aberta = await repo.obterPendencia(pendenciaAbertaId)
      expect(aberta).not.toBeNull()
      expect(aberta?.encerramento).toBeNull()

      const resolvida = await repo.obterPendencia(pendenciaResolvidaId)
      expect(resolvida?.encerramento).not.toBeNull()
      expect(await repo.obterPendencia('nao-existe')).toBeNull()

      const encId = '33333333-3333-4333-8333-333333333333'
      const fotoId = '44444444-4444-4444-8444-444444444444'
      await repo.enviarFoto({ obraId, registroId: pendenciaAbertaId, fotoId }, JPEG())
      const dados = {
        id: encId,
        registroId: pendenciaAbertaId,
        obraId,
        observacao: 'Corrigido e verificado.',
        fotos: [{ id: fotoId, largura: 800, altura: 600, bytes: 1024 }],
      }
      expect(await repo.encerrarPendencia(dados)).toEqual({ id: encId })
      expect(await repo.encerrarPendencia(dados)).toEqual({ id: encId })

      const depois = await repo.obterPendencia(pendenciaAbertaId)
      expect(depois?.registro.situacao).toBe('resolvida')
      expect(depois?.encerramento?.observacao).toBe('Corrigido e verificado.')
    })

    it('recusa encerrar pendência já resolvida com outro id', async () => {
      const { repo, obraId, pendenciaResolvidaId } = criar()
      const fotoId = '55555555-5555-4555-8555-555555555555'
      await repo.enviarFoto({ obraId, registroId: pendenciaResolvidaId, fotoId }, JPEG())
      await expect(
        repo.encerrarPendencia({
          id: '66666666-6666-4666-8666-666666666666',
          registroId: pendenciaResolvidaId,
          obraId,
          observacao: 'Tentativa duplicada',
          fotos: [{ id: fotoId, largura: 800, altura: 600, bytes: 1024 }],
        }),
      ).rejects.toThrow(/encerrada/i)
    })

    it('devolve URLs para imagens solicitadas', async () => {
      const { repo } = criar()
      expect(await repo.urlsImagens([])).toEqual({})
      const urls = await repo.urlsImagens(['obra/R01/terreo/planta.webp'], 'plantas')
      expect(typeof urls['obra/R01/terreo/planta.webp']).toBe('string')
    })
  })
}
