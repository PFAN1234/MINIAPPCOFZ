import { useId } from 'react'

export function CampoBusca({
  valor,
  onMudar,
  rotulo,
  placeholder,
}: {
  valor: string
  onMudar: (v: string) => void
  rotulo: string
  placeholder?: string
}) {
  const id = useId()
  return (
    <div className="campo-busca">
      <label htmlFor={id} className="sr-only">
        {rotulo}
      </label>
      <input
        id={id}
        type="search"
        value={valor}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onMudar(e.target.value)}
      />
    </div>
  )
}
