# NeonLED: automação de artes de LED Neon no CorelDRAW

Macro VBA para CorelDRAW (2017 ou mais recente, Windows). Ela automatiza o que hoje é feito à mão:

| Antes (manual) | Agora (macro) |
|---|---|
| Desenhar com B-spline por cima das letras | **Linha central automática** (PowerTRACE Centerline) a partir do texto ou da imagem do cliente |
| Escolher 4,7 mm em cada linha | **1 clique**: linha de 4,7 mm, pontas e cantos redondos, sem preenchimento |
| Medir linha por linha e arredondar para 25 mm | **Mede tudo**, arredonda para múltiplo de 25 mm e pinta de **laranja** as linhas que precisam de ajuste (mostra quantos mm faltam ou sobram) |
| Ver onde a mangueira pode ser cortada | **Bolinhas vermelhas a cada 25 mm** ao longo de cada linha |
| Escrever a medida de cada linha para o montador | **Etiquetas L1, L2, L3…** numeradas de cima para baixo e da esquerda para a direita, com bolinha preta no início de cada linha (onde entra o cabo) |
| Somar o total de material | **Tabela de montagem** ao lado da arte: cada linha, total em mm e metros, tamanho da arte, consumo em watts e **fonte recomendada** |
| — | **Arquivo CSV** (`<nome do arquivo>_montagem.csv`) para abrir no Excel |
| — | **Prévia de brilho** (efeito glow) para enviar ao cliente aprovar |
| Desenhar a base de acrílico | **Base gerada automaticamente**, acompanhando o contorno das letras com margem de 15 mm, em linha vermelha fina (pronta para laser ou router) |

Tudo o que a macro cria fica em camadas separadas (`NEON - Medidas`, `NEON - Pontos de corte`, `NEON - Prévia brilho`, `NEON - Base acrílico`). Assim você liga e desliga cada uma: o PDF do cliente sai só com a prévia, e o do montador sai com as medidas.

## Instalação (5 minutos)

1. No CorelDRAW: **Ferramentas > Scripts > Editor de Scripts** (ou `Alt+F11`).
2. No painel da esquerda, clique com o botão direito em **GlobalMacros** e escolha **Import File…**. Selecione o `NeonLED.bas`.
3. Feche o editor.
4. (Recomendado) Crie um atalho ou botão:
   **Ferramentas > Opções > Personalização > Comandos**. Escolha **Macros** na lista, ache `GlobalMacros.NeonLED.NeonPainel` e arraste para a barra de ferramentas, ou defina um atalho como `Ctrl+Shift+N`.

> Se o Editor de Scripts não aparecer, instale o componente **Visual Basic for Applications** pelo instalador do CorelDRAW (Modificar > Utilitários).

## Fluxo de trabalho novo

1. **Digite a frase** na fonte que o cliente pediu (ou importe a imagem dele).
2. Selecione e rode **NeonPainel > 1** (linha central). O PowerTRACE gera as linhas pelo meio das letras.
   Revise com a ferramenta Forma (F10): apague nós sobrando e ligue as pontas.
3. Selecione as linhas e rode **NeonPainel > 6** (faz tudo):
   aplica o estilo, mede, numera, marca os cortes, gera a tabela, a prévia de brilho e a base.
4. Linhas em **laranja** estão fora do múltiplo de 25 mm. A etiqueta mostra, por exemplo, `+13`: falta esticar 13 mm, ou encurtar 12 mm para chegar no múltiplo de baixo. Ajuste e rode **3** de novo (ele apaga as medidas antigas e refaz tudo).
5. **Cliente:** exporte o PDF só com as camadas *arte + prévia de brilho*.
   **Montador:** exporte com *arte + medidas + pontos de corte* e mande o CSV junto.

## Configuração

No topo do `NeonLED.bas` (Editor de Scripts) há uma seção **CONFIGURAÇÃO**:

| Constante | Padrão | O que é |
|---|---|---|
| `ESPESSURA_MM` | 4,7 | espessura da mangueira |
| `MODULO_CORTE_MM` | 25 | intervalo de corte da mangueira |
| `TOLERANCIA_MM` | 3 | diferença aceita sem marcar a linha como "ajustar" |
| `MARGEM_BASE_MM` | 15 | margem do acrílico em volta das linhas |
| `WATTS_POR_METRO` | 9,6 | consumo da sua mangueira (veja a ficha técnica) |
| `FOLGA_FONTE` | 1,2 | folga da fonte de alimentação (20%) |
| `PRECO_POR_METRO` | 0 | coloque o seu custo/metro para aparecer o custo na tabela |

## Regras importantes

- A macro trabalha **só nos objetos selecionados**. Grupos são percorridos.
- Cada **subcaminho** conta como uma mangueira. Se duas letras estão combinadas (`Ctrl+L`) mas são mangueiras diferentes, elas são medidas separadamente. Se forem uma mangueira só, as pontas precisam estar ligadas no mesmo subcaminho.
- Texto precisa ser convertido em curvas (`Ctrl+Q`) antes de medir. A opção 1 já faz isso.
- Cada macro cria **um único passo de desfazer** (`Ctrl+Z` desfaz tudo de uma vez).

## Outros recursos do CorelDRAW que ajudam muito

- **Traçado de linha central** (Bitmaps > Traçado de linha central > Desenho de linhas): é o que a opção 1 usa. Funciona muito bem com imagens de logotipos que o cliente manda.
- **Fontes de traço único** (*single-line* ou *single-stroke*, como as fontes Hershey usadas em gravação): a letra já é uma linha só, e você pula o traçado.
- **LiveSketch** (2017+): para os casos em que precisa desenhar à mão, gera curvas mais suaves que a B-spline.
- **Estilos de objeto** (`Ctrl+F5`): salve o estilo "Neon 4,7 mm" com uma cor por estilo (branco quente, rosa, azul…). Se mudar a cor do estilo, todas as linhas mudam.
- **Modelo (.cdt)**: crie um modelo com as camadas, a régua em mm e a tabela de cores já prontos.
- **Encaixar em objetos** (`Alt+Z`): ajuda a ligar as pontas das linhas.

## Próximos passos possíveis

- **Docker (painel lateral)** com botões e campos em vez do menu `InputBox`. Exige um UserForm ou um add-on em C#/.NET.
- **Ajuste automático de comprimento**: esticar ou encurtar a ponta da linha até o múltiplo de 25 mm.
- **Orçamento automático**: usar o CSV para gerar o PDF de orçamento com preço de mangueira, acrílico, fonte e mão de obra.
- **Cores por linha** na tabela, para pedidos com mais de uma cor de neon.

> ⚠️ Esta macro foi escrita pela API de automação do CorelDRAW, mas ainda **não foi testada numa instalação real**. Teste primeiro numa cópia do arquivo. Se aparecer algum erro, anote a mensagem e a linha que fica amarela no editor.
