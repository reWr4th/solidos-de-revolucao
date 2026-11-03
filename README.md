# Sólidos de Revolução

Visualizador interativo de sólidos de revolução, com uma interface inspirada no GeoGebra.

**Abrir a aplicação:** https://rewr4th.github.io/solidos-de-revolucao/

## Como funciona

1. **Função geradora** — escreve `y = f(x)` na Entrada da vista Álgebra (por exemplo `x^2 - x + 2`, `f(x) = sqrt(x)` ou `4ln(x+1) - 0.2sen(2x)`). A função aparece no gráfico 2D, com a região que vai rodar sombreada.
2. **Eixo de rotação** — Ox, Oy ou Oz.
3. **Limites a e b** — escritos (aceita `pi`, `2pi/3`, `sqrt(2)`…), com os cursores, ou arrastando os pontos a e b diretamente no gráfico.
4. **Ângulo θ** — de 1° a 360° (por exemplo 240° para ver o interior do sólido). O botão ▶ anima a rotação e a **duração da rotação** (0,5 s a 120 s) define quanto tempo demora: 1 s para uma rotação quase instantânea, 30 s para ver o sólido a formar-se devagar.
5. **Sólido ou superfície** — com **Superfície de revolução** ativo, só o gráfico de f roda e obtém-se a casca (sem bases nem interior), com a face exterior e a interior em cores diferentes.
6. **Gerar sólido 3D** — a simulação mostra o sólido (ou a superfície), as secções de corte, a curva geradora e o eixo de rotação, com volume e área.

Outras funcionalidades: vista 2D + 3D lado a lado, vistas da câmara (3D, frente, lado, cima), malha, opacidade, cores, tema escuro, teclado matemático, desfazer/refazer e o botão **Partilhar**, que copia uma ligação com a função e todos os parâmetros.

## A matemática

A região geradora é R = {(x, y) : a ≤ x ≤ b, y entre 0 e f(x)} — a região entre o gráfico de f e o eixo Ox. Rodando R um ângulo θ (em radianos):

| Eixo | Volume | Área lateral |
|---|---|---|
| Ox (discos) | V = (θ/2) ∫ₐᵇ f(x)² dx | A = θ ∫ₐᵇ \|f(x)\| √(1 + f′(x)²) dx |
| Oy (cascas cilíndricas) | V = θ ∫ₐᵇ \|x\|·\|f(x)\| dx | A = θ ∫ₐᵇ \|x\| √(1 + f′(x)²) dx |
| Oz | V = 0 | área da região plana varrida |

- Com θ = 360° obtêm-se as fórmulas habituais, π ∫ f² dx e 2π ∫ x f(x) dx.
- No modo superfície não há volume: a área da superfície é a área lateral da tabela (em Oz, a área da região plana varrida só pela curva).
- Em Oy, se [a, b] contém x = 0, as partes x < 0 e x > 0 de R sobrepõem-se ao rodar mais de 180°; a aplicação calcula o volume da união (não a soma).
- O eixo Oz é perpendicular ao plano xOy onde está a curva: a região roda dentro do próprio plano e varre uma região plana (coroa ou setor circular), por isso não há sólido.
- Os integrais são calculados numericamente (Gauss–Kronrod adaptativo) e f′ é obtida por derivação simbólica. Quando o resultado é um múltiplo racional de π, mostra-se também essa forma (por exemplo 176π/15).

## Sintaxe

`+ − * / ^`, multiplicação implícita (`2x`, `3sen x`, `(x+1)(x−1)`), `sen` `cos` `tg` `cotg` `arcsen` `arccos` `arctg` `ln` `log` (base 10) `log(b, x)` `exp` `e^x` `sqrt`/`raiz` `cbrt` `nroot(x, n)` `|x|` `pi`. Decimais com ponto (`0.5`) ou vírgula sem espaços (`0,5`).

## Desenvolvimento

O site é um único ficheiro, `index.html`, gerado a partir do código em `src/`:

```bash
npm install
npm test        # testes do interpretador e dos integrais
npm run build   # gera index.html
```

Feito com [three.js](https://threejs.org) (licença MIT) para a vista 3D.
