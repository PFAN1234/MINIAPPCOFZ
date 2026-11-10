import { useCallback, useEffect, useRef, useState } from 'react'
import { prepararFoto, type FotoPreparada } from '../util/imagem.ts'
import { MAX_FOTOS, type ItemFoto } from './SeletorFotos.tsx'

export interface FotoEscolhida extends ItemFoto {
  arquivo: File
  preparada?: FotoPreparada
}

function criarPrevia(arquivo: File): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(arquivo) : null
}

/**
 * Fotos escolhidas na Câmera/Galeria: cria a prévia, comprime cada uma em segundo
 * plano (`prepararFoto`) e respeita o limite de `MAX_FOTOS`. Usado pelo Novo
 * registro e pelo encerramento de pendência.
 */
export function useFotosEscolhidas() {
  const [fotos, setFotos] = useState<FotoEscolhida[]>([])
  const [aviso, setAviso] = useState('')
  const contador = useRef(0)
  const previas = useRef<string[]>([])
  const fotosRef = useRef<FotoEscolhida[]>([])

  useEffect(
    () => () => {
      for (const url of previas.current) URL.revokeObjectURL?.(url)
    },
    [],
  )

  const adicionar = useCallback((arquivos: File[]) => {
    const vagas = MAX_FOTOS - fotosRef.current.length
    const aceitos = arquivos.slice(0, Math.max(0, vagas))
    setAviso(
      aceitos.length < arquivos.length
        ? `Só cabem ${MAX_FOTOS} fotos; ${arquivos.length - aceitos.length} ficou de fora.`
        : '',
    )
    const novos: FotoEscolhida[] = aceitos.map((arquivo) => {
      const previa = criarPrevia(arquivo)
      if (previa) previas.current.push(previa)
      return { chave: `f${++contador.current}`, arquivo, previa, estado: 'preparando' }
    })
    fotosRef.current = [...fotosRef.current, ...novos]
    setFotos(fotosRef.current)
    for (const item of novos) {
      prepararFoto(item.arquivo).then(
        (preparada) => atualizar(item.chave, { estado: 'pronta', preparada }),
        (e: unknown) =>
          atualizar(item.chave, {
            estado: 'erro',
            mensagem: e instanceof Error ? e.message : 'Não foi possível ler esta foto.',
          }),
      )
    }
    function atualizar(chave: string, mudanca: Partial<FotoEscolhida>) {
      fotosRef.current = fotosRef.current.map((f) => (f.chave === chave ? { ...f, ...mudanca } : f))
      setFotos(fotosRef.current)
    }
  }, [])

  const remover = useCallback((chave: string) => {
    fotosRef.current = fotosRef.current.filter((f) => f.chave !== chave)
    setFotos(fotosRef.current)
    setAviso('')
  }, [])

  return { fotos, aviso, adicionar, remover }
}
