# Sanja Pudim

Site de pudins artesanais com cardápio, carrinho e envio do pedido pelo WhatsApp.

## Estrutura
- `index.html` — página principal (topo, destaque, cardápio, sobre, carrinho).
- `style.css` — estilos (cores em variáveis no `:root`).
- `app.js` — produtos, carrinho e montagem da mensagem do WhatsApp.

## Personalizar
1. Em `app.js`, troque `WHATSAPP` pelo número da loja (ex.: `5511999999999`).
2. Edite a lista `produtos` (nome, descrição, preço, emoji).
3. Ajuste as cores em `style.css`.

## Rodar localmente
Abra `index.html` no navegador, ou sirva a pasta:

```bash
npx serve SanjaPudim
```

## Levar para a unidade E:
```bash
git clone -b claude/peaceful-tesla-o6u9cn https://github.com/fabiohsmarques16-stack/assistente-ia-premium.git
```
Depois copie a pasta `SanjaPudim` para `E:\SanjaPudim`.
