# Estimativa de custos — hospedagem profissional e Claude Team

Estimativa de 2026-11-23 para manter o Fiscal Bot em produção com planos profissionais, mais a assinatura do Claude Team com 4 assentos. Os preços foram levantados nas páginas oficiais e em guias de 2026 (fontes no fim) e devem ser confirmados no momento da contratação.

## Premissas

- **Câmbio:** US$ 1 = R$ 5,10, mais IOF de 3,5% no cartão internacional, ou seja, **R$ 5,28 por dólar**. Os serviços em dólar são cobrados no cartão.
- **Uso medido em 2026-11-23:** banco com 21 MB, 201 arquivos e 53 MB no R2, 7 usuários, 4 obras, 2 etapas.
- **Crescimento previsto no 1º ano** (piloto da HTO e depois as obras da 2ª ETAPA):

| Item | Hipótese | Volume |
| :--- | :--- | :--- |
| Fotos | 40 registros por dia útil × 2,5 fotos × 0,45 MB (JPEG de até 1920 px) | ~1 GB por mês |
| Boletins | 2 etapas × 30 dias × ~3 MB | ~0,2 GB por mês |
| Modelos, plantas e documentos | revisões ao longo do ano | ~0,5 GB por ano |
| **Arquivos no fim do 1º ano** | | **~15 GB** |
| Banco Postgres | linhas de texto; fotos ficam no R2 | menos de 1 GB |

- **Uso das funções:** os PDFs do boletim e do relatório (Chromium na Vercel) usam cerca de 20 a 30 minutos de CPU por mês, bem abaixo do que vem incluído no Vercel Pro.

## Opção A — serviços gerenciados nos planos pagos (recomendada)

A arquitetura atual fica como está (Supabase, Vercel e Cloudflare R2); só mudam os planos.

| Serviço | Plano | US$/mês | R$/mês | O que resolve |
| :--- | :--- | ---: | ---: | :--- |
| Supabase | Pro (inclui computação Micro, 8 GB de disco) | 25,00 | 132 | Backup diário com 7 dias de retenção, sem pausa por inatividade, suporte por e-mail |
| Vercel | Pro, 1 assento | 20,00 | 106 | Uso comercial permitido (o Hobby é só para uso pessoal), US$ 20 de crédito de uso incluído |
| Cloudflare R2 | Pago por uso (10 GB grátis, sem custo de saída) | 0 a 0,10 | 0 a 1 | Fotos, plantas, modelos, boletins e relatórios |
| Telegram (bot e Mini App) | Gratuito | 0 | 0 | — |
| GitHub | Free (2.000 min de Actions por mês em repositório privado) | 0 | 0 | CI e backup semanal |
| **Subtotal obrigatório** | | **45** | **~R$ 238** | |
| Domínio `.com.br` (opcional) | Registro.br, R$ 40 por ano | — | 3 | Endereço próprio no lugar de `miniappcofz.vercel.app` |
| Google One 100 GB (opcional, a partir do 2º ano) | Destino do backup do R2 | — | ~10 | Os 15 GB gratuitos do Drive acabam perto do fim do 1º ano |
| **Subtotal com opcionais** | | | **~R$ 251** | |

Observações:

- **Backup do banco:** o plano Pro já traz backup diário. Ainda assim, convém um dump semanal próprio para o R2, que custa só alguns MB de armazenamento.
- **Crescimento:** com 10 obras ativas (~40 GB de arquivos por ano), o R2 fica em ~US$ 0,50 por mês. Se o banco precisar de mais memória, a computação Small custa +US$ 5 por mês, porque o crédito do Pro cobre a Micro. Mesmo assim o subtotal fica abaixo de R$ 280 por mês.
- **GitHub Actions:** cada push roda ~20 a 25 minutos de CI (o e2e sozinho leva 12,7 minutos). Acima de ~80 pushes por mês, os 2.000 minutos gratuitos acabam. Nesse caso, ou o e2e roda só nos PRs para a `main`, ou entra o GitHub Team (US$ 4 por usuário, ~R$ 21).

## Opção B — VPS na Hostinger (autogerida)

Tudo num servidor próprio: Supabase auto-hospedado em Docker (Postgres, Auth, PostgREST, Edge Runtime, `pg_cron`/`pg_net`), o app servido por Caddy ou Nginx, o gerador de PDF como serviço Node com Chromium e os arquivos mantidos no R2.

| Item | R$/mês | Observação |
| :--- | ---: | :--- |
| Hostinger VPS KVM 4 (4 vCPU, 16 GB, 200 GB NVMe, datacenter em São Paulo) | 60 promocional / ~130 na renovação | Preço promocional exige 24 meses pagos à vista (~R$ 1.440); a renovação estimada vem de guias, não da página oficial |
| Cloudflare R2 | 0 a 1 | Igual à opção A |
| Domínio `.com.br` | 3 | Obrigatório, por causa do TLS |
| Backup diário da Hostinger (se não incluído) | a confirmar | O plano traz backup semanal; o dump diário pode ir para o R2 |
| **Subtotal** | **~R$ 63 a 135** | |

O que pesa contra:

- **Migração única:** ~40 a 60 horas de trabalho. Inclui portar as rotas `app/api/` para um serviço Node, publicar as Edge Functions no Edge Runtime, levar o banco, trocar as URLs no app e no BotFather, montar TLS, monitoramento e o pipeline de deploy, além de perder as prévias por PR da Vercel.
- **Operação contínua:** ~4 a 8 horas por mês (atualizações de segurança do sistema e do Supabase, Docker, disco, certificados, restauração de backup), com uma pessoa de plantão quando o servidor cair.
- **Conta final:** a economia é de R$ 100 a 175 por mês, menor que o custo de algumas horas de manutenção. Também se perdem o backup gerenciado, a alta disponibilidade e o suporte.

Equivalentes à Hostinger (DigitalOcean, Vultr, Contabo, Locaweb) ficam na mesma faixa de preço e têm os mesmos prós e contras.

## Claude Team — 4 assentos

| Composição | Cobrança anual (US$/mês) | R$/mês | Cobrança mensal (US$/mês) | R$/mês |
| :--- | ---: | ---: | ---: | ---: |
| **4 Standard** (US$ 20 ou 25 por assento) | 80 | **422** | 100 | **528** |
| 1 Premium + 3 Standard (Premium a US$ 100 ou 125) | 160 | 845 | 200 | 1.056 |

- O Team exige no mínimo 2 assentos, então 4 assentos é permitido.
- O assento Standard dá 1,25× a cota do Pro por sessão e o Premium, 6,25×.
- Este projeto usa o Claude Code de forma intensa, com subagentes e sessões longas. Se a cota do Standard não bastar para quem desenvolve, vale um assento Premium para essa pessoa.
- Antes de contratar, conferir em claude.com/pricing se o Claude Code está incluído no assento Standard e se há impostos locais na fatura.

## Resumo mensal e anual

| Cenário | Infraestrutura | Claude Team | **Total por mês** | **Total por ano** |
| :--- | ---: | ---: | ---: | ---: |
| **A + 4 Standard, cobrança anual (recomendado)** | 251 | 422 | **~R$ 673** | **~R$ 8.080** |
| A + 4 Standard, cobrança mensal | 251 | 528 | ~R$ 779 | ~R$ 9.350 |
| A + 1 Premium e 3 Standard, cobrança anual | 251 | 845 | ~R$ 1.096 | ~R$ 13.150 |
| B (Hostinger, promocional) + 4 Standard anual | 63 | 422 | ~R$ 485 | ~R$ 5.820 + migração e operação |
| B (Hostinger, renovação) + 4 Standard anual | 135 | 422 | ~R$ 557 | ~R$ 6.680 + migração e operação |

Na opção B, a migração (40 a 60 horas, uma vez) e a operação (4 a 8 horas por mês) não entram na tabela.

## Recomendação

1. **Ficar na opção A** e contratar o Supabase Pro e o Vercel Pro antes do piloto da HTO. Os dois planos resolvem os maiores riscos de hoje: banco sem backup diário, projeto que pode pausar e uso comercial no plano Hobby. Tudo isso sem mudar nenhuma linha de código.
2. **Claude Team com 4 assentos Standard em cobrança anual**, subindo um assento para Premium se a cota apertar.
3. **Ligar os alertas de gasto** nos três serviços (Supabase: *spend cap* ligado; Vercel: alerta em US$ 40; Cloudflare: alerta de cobrança).
4. **Rever esta estimativa** depois de 3 meses de piloto, com o volume real de fotos.

## Fontes (consultadas em 2026-11-23)

- Supabase: [supabase.com/pricing](https://supabase.com/pricing) e [docs de preços](https://supabase.com/docs/pricing).
- Vercel: [Pro plan](https://vercel.com/docs/plans/pro-plan) e [vercel.com/pricing](https://vercel.com/pricing).
- Cloudflare R2: [developers.cloudflare.com/r2/pricing](https://developers.cloudflare.com/r2/pricing).
- Hostinger: [página VPS Brasil (Ubuntu)](https://www.hostinger.com/br/vps/hospedagem-ubuntu), [hostinger.com/vps-hosting](https://hostinger.com/vps-hosting) e [horadecodar.com.br — valor de VPS em 2026](https://horadecodar.com.br/valor-vps/) (renovação).
- Claude Team: [claude.com/get-claude-team-plan](https://claude.com/get-claude-team-plan), [o que é o Claude Team (suporte)](https://support.claude.com/en/articles/9266767-what-is-the-claude-team-plan) e [atualizações do Claude Team](https://claude.com/blog/claude-team-updates).
