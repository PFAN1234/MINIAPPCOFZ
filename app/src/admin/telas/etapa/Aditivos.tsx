/** Aditivos do contrato da etapa (prazo e valor) e o término e o valor atualizados. */
import { useState, type FormEvent } from "react";
import { Campo, Resultado } from "../../componentes.tsx";
import { useRemoverAditivo, useSalvarAditivo } from "../../dados/hooks.ts";
import type { Aditivo, EtapaDetalhe } from "../../dados/tipos.ts";
import {
  dataBr,
  diasComSinal,
  lerMoeda,
  mascaraMoeda,
  moeda,
  textoMoeda,
} from "../../formato.ts";

interface Formulario {
  id?: string;
  numero: string;
  data: string;
  prazo_dias: string;
  valor: string;
  descricao: string;
}

const VAZIO: Formulario = {
  numero: "",
  data: "",
  prazo_dias: "0",
  valor: "",
  descricao: "",
};

export default function Aditivos({ etapa }: { etapa: EtapaDetalhe }) {
  const remover = useRemoverAditivo();
  const [editando, setEditando] = useState<Formulario | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const { prazo } = etapa;

  return (
    <section className="adm-secao" aria-labelledby="titulo-aditivos">
      <div className="adm-titulo-linha">
        <h2 id="titulo-aditivos">Aditivos</h2>
        {!editando && (
          <button
            type="button"
            className="adm-botao"
            onClick={() => {
              setSucesso(null);
              setEditando({ ...VAZIO });
            }}
          >
            Adicionar aditivo
          </button>
        )}
      </div>

      {prazo ? (
        <dl className="adm-resumo-prazo" aria-label="Prazo e valor atualizados">
          <div>
            <dt>Término original</dt>
            <dd>{dataBr(prazo.termino_original)}</dd>
          </div>
          <div>
            <dt>Prazo dos aditivos</dt>
            <dd>{diasComSinal(prazo.prazo_aditivos_dias)}</dd>
          </div>
          <div>
            <dt>Término atual</dt>
            <dd>{dataBr(prazo.termino_atual)}</dd>
          </div>
          <div>
            <dt>Valor atual</dt>
            <dd>
              {prazo.valor_atual === null
                ? "sem valor original"
                : moeda(prazo.valor_atual)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="adm-dica">
          Informe a data da OS e a vigência nos dados do contrato para calcular
          o término.
        </p>
      )}

      {etapa.aditivos.length === 0 ? (
        <p className="adm-dica">Nenhum aditivo cadastrado.</p>
      ) : (
        <div className="adm-rolagem">
          <table className="adm-tabela" aria-label="Aditivos do contrato">
            <thead>
              <tr>
                <th scope="col">Número</th>
                <th scope="col">Data</th>
                <th scope="col" className="adm-num">
                  Prazo
                </th>
                <th scope="col" className="adm-num">
                  Valor
                </th>
                <th scope="col">Descrição</th>
                <th scope="col">
                  <span className="adm-oculto">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {etapa.aditivos.map((a) => (
                <tr key={a.id}>
                  <td>{a.numero}</td>
                  <td>{dataBr(a.data)}</td>
                  <td className="adm-num">{diasComSinal(a.prazo_dias)}</td>
                  <td className="adm-num">{moeda(a.valor)}</td>
                  <td>{a.descricao}</td>
                  <td className="adm-acoes">
                    {confirmando === a.id ? (
                      <>
                        <button
                          type="button"
                          className="adm-botao adm-botao-perigo"
                          disabled={remover.isPending}
                          onClick={() =>
                            remover.mutate(a.id, {
                              onSuccess: () => {
                                setConfirmando(null);
                                setSucesso(`Aditivo ${a.numero} removido.`);
                              },
                            })
                          }
                        >
                          Confirmar remoção de {a.numero}
                        </button>
                        <button
                          type="button"
                          className="adm-botao"
                          onClick={() => setConfirmando(null)}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="adm-botao adm-botao-discreto"
                          aria-label={`Editar aditivo ${a.numero}`}
                          onClick={() => {
                            setSucesso(null);
                            setEditando(formularioDe(a));
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="adm-botao adm-botao-discreto"
                          aria-label={`Remover aditivo ${a.numero}`}
                          onClick={() => {
                            remover.reset();
                            setSucesso(null);
                            setConfirmando(a.id);
                          }}
                        >
                          Remover
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Resultado sucesso={sucesso} erro={remover.error} />
      {editando && (
        <FormularioAditivo
          key={editando.id ?? "novo"}
          etapaId={etapa.id}
          inicial={editando}
          onFechar={(msg) => {
            setEditando(null);
            if (msg) setSucesso(msg);
          }}
        />
      )}
    </section>
  );
}

function formularioDe(a: Aditivo): Formulario {
  return {
    id: a.id,
    numero: a.numero,
    data: a.data,
    prazo_dias: String(a.prazo_dias),
    valor: textoMoeda(a.valor),
    descricao: a.descricao ?? "",
  };
}

function FormularioAditivo({
  etapaId,
  inicial,
  onFechar,
}: {
  etapaId: string;
  inicial: Formulario;
  onFechar: (mensagem?: string) => void;
}) {
  const salvar = useSalvarAditivo();
  const [f, setF] = useState(inicial);
  const [aviso, setAviso] = useState<string | null>(null);
  const mudar = (campo: keyof Formulario, valor: string) => {
    setF((a) => ({ ...a, [campo]: valor }));
    setAviso(null);
  };

  function enviar(e: FormEvent) {
    e.preventDefault();
    const numero = f.numero.trim();
    if (!numero) return setAviso("Informe o número do aditivo (ex.: 1º TA).");
    if (!f.data) return setAviso("Informe a data do aditivo.");
    if (!/^-?\d{1,6}$/.test(f.prazo_dias.trim()))
      return setAviso(
        "O prazo precisa ser um número inteiro de dias (negativo para supressão).",
      );
    const valor = f.valor.trim() === "" ? 0 : lerMoeda(f.valor);
    if (valor === null)
      return setAviso(
        "Valor inválido. Use o formato 1.234,56 (negativo para supressão).",
      );
    setAviso(null);
    salvar.mutate(
      {
        ...(f.id ? { id: f.id } : {}),
        etapa_id: etapaId,
        numero,
        data: f.data,
        prazo_dias: Number(f.prazo_dias),
        valor,
        descricao: f.descricao.trim() || null,
      },
      { onSuccess: () => onFechar(`Aditivo ${numero} salvo.`) },
    );
  }

  return (
    <form
      className="adm-form adm-form-aditivo"
      onSubmit={enviar}
      noValidate
      aria-label={f.id ? "Editar aditivo" : "Novo aditivo"}
    >
      <h3>{f.id ? "Editar aditivo" : "Novo aditivo"}</h3>
      <div className="adm-grade">
        <Campo rotulo="Número do aditivo" obrigatorio>
          {(p) => (
            <input
              {...p}
              value={f.numero}
              maxLength={40}
              onChange={(e) => mudar("numero", e.target.value)}
              placeholder="1º TA"
            />
          )}
        </Campo>
        <Campo rotulo="Data do aditivo" obrigatorio>
          {(p) => (
            <input
              {...p}
              type="date"
              value={f.data}
              onChange={(e) => mudar("data", e.target.value)}
            />
          )}
        </Campo>
        <Campo
          rotulo="Prazo (dias)"
          dica="Acréscimo em dias; negativo para supressão."
        >
          {(p) => (
            <input
              {...p}
              value={f.prazo_dias}
              inputMode="numeric"
              onChange={(e) => mudar("prazo_dias", e.target.value)}
            />
          )}
        </Campo>
        <Campo
          rotulo="Valor do aditivo (R$)"
          dica="Acréscimo em reais; comece com - para supressão."
        >
          {(p) => (
            <input
              {...p}
              value={f.valor}
              inputMode="numeric"
              placeholder="0,00"
              onChange={(e) =>
                mudar("valor", mascaraMoeda(e.target.value, true))
              }
            />
          )}
        </Campo>
        <Campo rotulo="Descrição do aditivo" largo>
          {(p) => (
            <input
              {...p}
              value={f.descricao}
              maxLength={300}
              onChange={(e) => mudar("descricao", e.target.value)}
            />
          )}
        </Campo>
      </div>
      <Resultado
        sucesso={null}
        erro={aviso ? new Error(aviso) : salvar.error}
      />
      <div className="adm-acoes">
        <button
          type="submit"
          className="adm-botao adm-botao-principal"
          disabled={salvar.isPending}
        >
          Salvar aditivo
        </button>
        <button type="button" className="adm-botao" onClick={() => onFechar()}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
