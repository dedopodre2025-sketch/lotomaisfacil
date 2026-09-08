# 5.6 — geradores de 16 com teto obrigatório

Os botões 16 — Teto 12/13 agora usam um Worker com busca de 8.000, 25.000 ou 50.000 tentativas. Candidatos repetidos não são reavaliados. Cada conjunto válido é avaliado pelos 16 jogos internos de 15: máximo por jogo, ocorrências exatas de 12/13 e concursos distintos atingidos. O teto nunca é relaxado; falha ou cancelamento mantém a seleção. Mudanças na seleção/base invalidam a busca e o resumo.

Ranking lexicográfico após respeitar o teto:
- Se solicitado, minimizar combinações internas já cobertas por todos os jogos salvos considerados do mesmo concurso.
- Minimizar quantidade de jogos internos no teto.
- Teto 13: minimizar ocorrências totais de 13 e depois de 12.
- Teto 12: minimizar ocorrências totais de 12.

O resumo informa candidatos distintos examinados, válidos, base usada, distribuição de máximos, ocorrências, concursos e semente. A busca é amostral, não certifica ótimo global nem inexistência. Não inclui pesos de soma/pares/primos/frequência. A opção de salvos começa desmarcada e analisa até 10.000 combinações simples antes da deduplicação.

Verificação determinística na base 1–3779, 8.000 tentativas, semente 7: 7.979 candidatos distintos. Teto 12: nenhum válido encontrado. Teto 13: 2.201 válidos; melhor ranking [0 duplicações, 13 internos com máximo 13, 21 ocorrências de 13, 703 de 12]. Isso é verificação de funcionamento e seleção histórica, não backtest de vantagem futura.

Testes novos: comparação com enumeração independente, teto estrito, duplicações, prioridades, reprodutibilidade, ausência de candidato e execução do Worker. Rodar com Node em projeto ES modules:
node --test tests/focused16.node.mjs

Não há evidência nova de aumento de probabilidade por este filtro. Comparações de desempenho futuro precisam usar o mesmo custo e regras fixadas antes dos alvos.
