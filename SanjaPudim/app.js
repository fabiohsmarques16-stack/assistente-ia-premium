// Número do WhatsApp da loja (DDI + DDD + número, só dígitos).
const WHATSAPP = '5500000000000';

const produtos = [
  { id: 'tradicional', nome: 'Pudim Tradicional', descricao: 'Leite condensado e calda de caramelo.', preco: 45, emoji: '🍮' },
  { id: 'chocolate', nome: 'Pudim de Chocolate', descricao: 'Cremoso, com chocolate meio amargo.', preco: 50, emoji: '🍫' },
  { id: 'coco', nome: 'Pudim de Coco', descricao: 'Com coco ralado fresco.', preco: 48, emoji: '🥥' },
  { id: 'mini', nome: 'Mini Pudim', descricao: 'Porção individual, ideal para presente.', preco: 12, emoji: '🍯' }
];

const carrinho = {};

const moeda = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const $ = (id) => document.getElementById(id);

function renderProdutos() {
  $('listaProdutos').innerHTML = produtos.map((p) => `
    <article class="produto">
      <div class="emoji">${p.emoji}</div>
      <h3>${p.nome}</h3>
      <p>${p.descricao}</p>
      <span class="preco">${moeda(p.preco)}</span>
      <button class="btn" data-add="${p.id}">Adicionar</button>
    </article>`).join('');
}

function renderCarrinho() {
  const itens = Object.entries(carrinho);
  $('itensCarrinho').innerHTML = itens.length
    ? itens.map(([id, qtd]) => {
        const p = produtos.find((x) => x.id === id);
        return `<li>
          <span>${p.nome}<br><small>${moeda(p.preco * qtd)}</small></span>
          <span>
            <button data-sub="${id}" aria-label="Remover um">−</button>
            ${qtd}
            <button data-add="${id}" aria-label="Adicionar um">+</button>
          </span>
        </li>`;
      }).join('')
    : '<li>Seu carrinho está vazio.</li>';

  $('qtdCarrinho').textContent = itens.reduce((s, [, q]) => s + q, 0);
  $('totalCarrinho').textContent = moeda(total());
}

function total() {
  return Object.entries(carrinho).reduce((s, [id, q]) => s + produtos.find((p) => p.id === id).preco * q, 0);
}

function alterar(id, delta) {
  carrinho[id] = (carrinho[id] || 0) + delta;
  if (carrinho[id] <= 0) delete carrinho[id];
  renderCarrinho();
}

function abrirCarrinho(abrir) {
  $('carrinho').classList.toggle('aberto', abrir);
  $('carrinho').setAttribute('aria-hidden', String(!abrir));
}

function enviarPedido() {
  const itens = Object.entries(carrinho);
  if (!itens.length) {
    alert('Adicione pelo menos um pudim ao pedido.');
    return;
  }
  const linhas = itens.map(([id, q]) => {
    const p = produtos.find((x) => x.id === id);
    return `• ${q}x ${p.nome} — ${moeda(p.preco * q)}`;
  });
  const nome = $('nomeCliente').value.trim();
  const obs = $('obsPedido').value.trim();
  const msg = [
    'Olá, Sanja Pudim! Gostaria de fazer um pedido:',
    ...linhas,
    `Total: ${moeda(total())}`,
    nome && `Nome: ${nome}`,
    obs && `Obs.: ${obs}`
  ].filter(Boolean).join('\n');
  window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`, '_blank');
}

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  const sub = e.target.closest('[data-sub]');
  if (add) alterar(add.dataset.add, 1);
  if (sub) alterar(sub.dataset.sub, -1);
});

$('abrirCarrinho').addEventListener('click', () => abrirCarrinho(true));
$('fecharCarrinho').addEventListener('click', () => abrirCarrinho(false));
$('enviarPedido').addEventListener('click', enviarPedido);
$('ano').textContent = new Date().getFullYear();

renderProdutos();
renderCarrinho();
