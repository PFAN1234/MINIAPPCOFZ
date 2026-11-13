/** Responsáveis da etapa (fiscais que assinam o boletim): quem, função e ordem. */
import { useState } from "react";
import { Link } from "react-router";
import { ComDados, Resultado } from "../../componentes.tsx";
import { useDefinirResponsaveis, usePessoas } from "../../dados/hooks.ts";
import type { Pessoa, Responsavel } from "../../dados/tipos.ts";

interface Item {
  usuario_id: string;
  funcao: string;
}

const nomeDe = (p: Pick<Pessoa, "nome" | "nome_exibicao">) =>
  p.nome_exibicao ?? p.nome;

export default function Responsaveis({
  etapaId,
  atuais,
}: {
  etapaId: string;
  atuais: Responsavel[];
}) {
  const pessoas = usePessoas();
  // Fica aqui: o editor é recriado quando a lista salva volta do servidor.
  const [sucesso, setSucesso] = useState<string | null>(null);
  return (
    <section className="adm-secao" aria-labelledby="titulo-responsaveis">
      <h2 id="titulo-responsaveis">Responsáveis</h2>
      <p className="adm-dica">
        Quem assina o boletim desta etapa, na ordem em que aparecem. O nome
        mostrado é o de exibição (em <Link to="/pessoas">Pessoas</Link>), quando
        existe.
      </p>
      <ComDados consulta={pessoas}>
        {(lista) => (
          <Editor
            // Recria quando o servidor devolve outra lista (depois de salvar ou de mudar um nome).
            key={JSON.stringify(atuais)}
            etapaId={etapaId}
            atuais={atuais}
            pessoas={lista}
            sucesso={sucesso}
            setSucesso={setSucesso}
          />
        )}
      </ComDados>
    </section>
  );
}

function Editor({
  etapaId,
  atuais,
  pessoas,
  sucesso,
  setSucesso,
}: {
  etapaId: string;
  atuais: Responsavel[];
  pessoas: Pessoa[];
  sucesso: string | null;
  setSucesso: (s: string | null) => void;
}) {
  const definir = useDefinirResponsaveis(etapaId);
  const [lista, setLista] = useState<Item[]>(() =>
    atuais.map((r) => ({ usuario_id: r.usuario_id, funcao: r.funcao })),
  );
  const [escolhido, setEscolhido] = useState("");
  const [funcaoNova, setFuncaoNova] = useState("Fiscal");

  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const disponiveis = pessoas.filter(
    (p) => !lista.some((i) => i.usuario_id === p.id),
  );
  const mudou =
    JSON.stringify(lista) !==
    JSON.stringify(
      atuais.map((r) => ({ usuario_id: r.usuario_id, funcao: r.funcao })),
    );

  function alterar(nova: Item[]) {
    setLista(nova);
    setSucesso(null);
    definir.reset();
  }
  function mover(i: number, delta: number) {
    const nova = [...lista];
    [nova[i], nova[i + delta]] = [nova[i + delta], nova[i]];
    alterar(nova);
  }

  return (
    <>
      {lista.length === 0 ? (
        <p className="adm-dica">
          Nenhum responsável. O boletim só sai com ao menos um.
        </p>
      ) : (
        <div className="adm-rolagem">
          <table className="adm-tabela" aria-label="Responsáveis da etapa">
            <thead>
              <tr>
                <th scope="col">Pessoa</th>
                <th scope="col">Função</th>
                <th scope="col">
                  <span className="adm-oculto">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.map((item, i) => {
                const pessoa = porId.get(item.usuario_id);
                const nome = pessoa ? nomeDe(pessoa) : item.usuario_id;
                return (
                  <tr key={item.usuario_id}>
                    <td>
                      {nome}
                      {pessoa?.nome_exibicao && (
                        <span className="adm-dica">
                          {" "}
                          · Telegram: {pessoa.nome}
                        </span>
                      )}
                    </td>
                    <td>
                      <input
                        aria-label={`Função de ${nome}`}
                        value={item.funcao}
                        maxLength={60}
                        onChange={(e) =>
                          alterar(
                            lista.map((x, j) =>
                              j === i ? { ...x, funcao: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="adm-acoes">
                      <button
                        type="button"
                        className="adm-botao adm-botao-discreto"
                        aria-label={`Subir ${nome}`}
                        disabled={i === 0}
                        onClick={() => mover(i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="adm-botao adm-botao-discreto"
                        aria-label={`Descer ${nome}`}
                        disabled={i === lista.length - 1}
                        onClick={() => mover(i, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="adm-botao adm-botao-discreto"
                        aria-label={`Remover ${nome} dos responsáveis`}
                        onClick={() => alterar(lista.filter((_, j) => j !== i))}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="adm-acoes">
        <label className="adm-campo adm-campo-curto">
          Pessoa
          <select
            value={escolhido}
            onChange={(e) => setEscolhido(e.target.value)}
          >
            <option value="">Escolha uma pessoa…</option>
            {disponiveis.map((p) => (
              <option key={p.id} value={p.id}>
                {nomeDe(p)}
                {p.username ? ` (@${p.username})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-campo adm-campo-curto">
          Função
          <input
            value={funcaoNova}
            maxLength={60}
            onChange={(e) => setFuncaoNova(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="adm-botao"
          disabled={!escolhido}
          onClick={() => {
            alterar([
              ...lista,
              { usuario_id: escolhido, funcao: funcaoNova.trim() || "Fiscal" },
            ]);
            setEscolhido("");
          }}
        >
          Adicionar responsável
        </button>
      </div>

      <Resultado sucesso={sucesso} erro={definir.error} />
      <div>
        <button
          type="button"
          className="adm-botao adm-botao-principal"
          disabled={!mudou || definir.isPending}
          onClick={() =>
            definir.mutate(lista, {
              onSuccess: () => setSucesso("Responsáveis salvos."),
            })
          }
        >
          Salvar responsáveis
        </button>
      </div>
    </>
  );
}
