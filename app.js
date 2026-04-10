'use strict';

/* =============================================
   CONSTANTES
   ============================================= */
const UNITS = ['un', 'kg', 'g', 'L', 'ml', 'cx', 'pct', 'dz'];

const DEFAULT_CATEGORIES = [
  'Freezer', 'Geladeira', 'Armário', 'Produção', 'Limpeza', 'Embalagens'
];

/* =============================================
   FIRESTORE
   ============================================= */
let db;

/* =============================================
   ESTADO
   ============================================= */
let state = {
  page:        'dashboard',
  categories:  [],
  items:       [],
  estoqueSearch: '',
  initialized: false,
};

let _catsReady  = false;
let _itemsReady = false;

// Filtros da página Insumos (apenas sessão)
let iFilters = { search: '', status: '', type: '', catId: '' };
let listaTab = 'comprar';

// Timers de debounce por item (atualização de estoque)
const qtyTimers = {};

/* =============================================
   FIREBASE INIT
   ============================================= */
function initFirebase() {
  // Verifica se a config foi preenchida
  if (!FIREBASE_CONFIG || FIREBASE_CONFIG.apiKey.startsWith('COLE_AQUI')) {
    showLoaderError(
      'Configure o Firebase primeiro!',
      'Abra o arquivo <strong>js/firebase-config.js</strong> e preencha com os dados do seu projeto Firebase.'
    );
    return;
  }

  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    setupListeners();
  } catch (e) {
    console.error('Firebase init error:', e);
    showLoaderError('Erro ao conectar', 'Verifique a configuração do Firebase e tente recarregar.');
  }
}

function setupListeners() {
  db.collection('categories').orderBy('name').onSnapshot(
    snap => {
      state.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _catsReady = true;
      checkDataReady();
      if (state.initialized) safeRefresh();
    },
    err => {
      console.error('Firestore categories error:', err);
      showLoaderError('Erro de permissão', 'Verifique as <strong>Regras do Firestore</strong> no Firebase Console e libere leitura/escrita.');
    }
  );

  db.collection('items').orderBy('name').onSnapshot(
    snap => {
      state.items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _itemsReady = true;
      checkDataReady();
      if (state.initialized) safeRefresh();
    },
    err => {
      console.error('Firestore items error:', err);
      showToast('Erro ao carregar itens', 'error');
    }
  );
}

function checkDataReady() {
  if (_catsReady && _itemsReady && !state.initialized) {
    state.initialized = true;
    showLoader(false);
    setupNav();
    if (state.categories.length === 0) {
      seedData();
    } else {
      navigateTo('dashboard');
    }
  }
}

// Atualiza a página sem interferir em campos ativos (digitação)
function safeRefresh() {
  const focused = document.activeElement;
  const content = document.getElementById('page-content');
  if (content && content.contains(focused)) return;
  refreshCurrentPage();
}

/* =============================================
   SEED DE DADOS INICIAIS
   ============================================= */
async function seedData() {
  try {
    const batch = db.batch();
    const now = new Date().toISOString();

    const catRefs = DEFAULT_CATEGORIES.map(name => {
      const ref = db.collection('categories').doc();
      batch.set(ref, { name, createdAt: now });
      return ref;
    });

    const [freezer, geladeira, armario, producao, , embalagens] = catRefs;

    const sampleItems = [
      { name: 'Leite integral',   categoryId: geladeira.id,   unit: 'L',  currentQty: 6,   minQty: 15,  type: 'comprar',  observation: '' },
      { name: 'Manteiga',          categoryId: geladeira.id,   unit: 'kg', currentQty: 0.5, minQty: 1,   type: 'comprar',  observation: '' },
      { name: 'Pão de queijo',     categoryId: freezer.id,     unit: 'un', currentQty: 40,  minQty: 80,  type: 'produzir', observation: 'Fazer toda manhã' },
      { name: 'Cookie chocolate',  categoryId: producao.id,    unit: 'un', currentQty: 10,  minQty: 30,  type: 'produzir', observation: '' },
      { name: 'Café em grão',      categoryId: armario.id,     unit: 'kg', currentQty: 2,   minQty: 3,   type: 'comprar',  observation: 'Grão especial' },
      { name: 'Açúcar refinado',   categoryId: armario.id,     unit: 'kg', currentQty: 5,   minQty: 5,   type: 'comprar',  observation: '' },
      { name: 'Copos 200ml',       categoryId: embalagens.id,  unit: 'un', currentQty: 200, minQty: 100, type: 'comprar',  observation: '' },
      { name: 'Sachê de açúcar',   categoryId: embalagens.id,  unit: 'cx', currentQty: 3,   minQty: 5,   type: 'comprar',  observation: '' },
    ];

    sampleItems.forEach(item => {
      const ref = db.collection('items').doc();
      batch.set(ref, { ...item, createdAt: now });
    });

    await batch.commit();
    navigateTo('dashboard');
  } catch (e) {
    console.error('Seed error:', e);
    showToast('Erro ao criar dados iniciais', 'error');
    navigateTo('dashboard');
  }
}

/* =============================================
   NAVEGAÇÃO
   ============================================= */
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
}

function navigateTo(page) {
  state.page = page;

  const titles = {
    dashboard:  'Estoque Cafeteria',
    insumos:    'Insumos',
    estoque:    'Atualizar Estoque',
    listas:     'Listas',
    categorias: 'Categorias',
  };

  document.getElementById('page-title').textContent = titles[page] || page;

  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.page === page)
  );

  const renders = { dashboard, insumos, estoque, listas, categorias };
  const el = document.getElementById('page-content');
  el.innerHTML = (renders[page] || (() => ''))();
  el.scrollTop = 0;
}

/* =============================================
   HELPERS
   ============================================= */
function catName(id) {
  const c = state.categories.find(c => c.id === id);
  return c ? c.name : 'Sem categoria';
}

function isBelow(item) {
  return parseFloat(item.currentQty) < parseFloat(item.minQty);
}

function fmtQty(qty) {
  const n = parseFloat(qty);
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

function belowItems(type) {
  return state.items.filter(i => isBelow(i) && (!type || i.type === type));
}

function sortItems(arr) {
  return [...arr].sort((a, b) => {
    if (isBelow(a) && !isBelow(b)) return -1;
    if (!isBelow(a) && isBelow(b)) return 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

/* =============================================
   PÁGINA: DASHBOARD
   ============================================= */
function dashboard() {
  const total    = state.items.length;
  const abaixo   = belowItems().length;
  const comprar  = belowItems('comprar').length;
  const produzir = belowItems('produzir').length;

  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  const alertas = belowItems();
  const alertasHtml = alertas.length
    ? `<div class="section">
        <p class="section-title">⚠️ Atenção necessária</p>
        <div class="alert-list">
          ${alertas.map(item => `
            <div class="alert-item" onclick="openInsumoForm('${item.id}')">
              <div class="alert-item-info">
                <span class="alert-item-name">${esc(item.name)}</span>
                <span class="alert-item-cat">${esc(catName(item.categoryId))}</span>
              </div>
              <div class="alert-item-qty">
                <span class="qty-badge-danger">${fmtQty(item.currentQty)} ${item.unit}</span>
                <span class="qty-min-sm">mín: ${fmtQty(item.minQty)}</span>
              </div>
            </div>`).join('')}
        </div>
       </div>`
    : `<div class="empty-state success">
        <span class="empty-icon">✅</span>
        <p>Tudo certo! Todos os itens estão dentro do estoque mínimo.</p>
       </div>`;

  return `
    <div class="date-header">${hoje}</div>

    <div class="stats-grid">
      <div class="stat-card" onclick="navigateTo('insumos')">
        <div class="stat-icon">📦</div>
        <div class="stat-value">${total}</div>
        <div class="stat-label">Total de insumos</div>
      </div>
      <div class="stat-card ${abaixo > 0 ? 'stat-danger' : ''}" onclick="navigateTo('listas')">
        <div class="stat-icon">${abaixo > 0 ? '⚠️' : '✅'}</div>
        <div class="stat-value">${abaixo}</div>
        <div class="stat-label">Abaixo do mínimo</div>
      </div>
      <div class="stat-card" onclick="navigateTo('listas')">
        <div class="stat-icon">🛒</div>
        <div class="stat-value">${comprar}</div>
        <div class="stat-label">Para comprar</div>
      </div>
      <div class="stat-card" onclick="navigateTo('listas')">
        <div class="stat-icon">👨‍🍳</div>
        <div class="stat-value">${produzir}</div>
        <div class="stat-label">Para produzir</div>
      </div>
    </div>

    <div class="quick-actions">
      <button class="btn-action-primary" onclick="openInsumoForm()">
        <span>＋</span> Cadastrar insumo
      </button>
      <button class="btn-action-secondary" onclick="navigateTo('estoque')">
        <span>✏️</span> Atualizar estoque
      </button>
      <button class="btn-action-secondary" onclick="navigateTo('listas')">
        <span>📋</span> Ver listas de compra / produção
      </button>
    </div>

    ${alertasHtml}
  `;
}

/* =============================================
   PÁGINA: INSUMOS
   ============================================= */
function insumos() {
  const { search, status, type, catId } = iFilters;

  let list = sortItems(state.items);
  if (search)  list = list.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
  if (status === 'below') list = list.filter(isBelow);
  if (status === 'ok')    list = list.filter(i => !isBelow(i));
  if (type)    list = list.filter(i => i.type === type);
  if (catId)   list = list.filter(i => i.categoryId === catId);

  const catOpts = state.categories
    .map(c => `<option value="${c.id}" ${catId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');

  const listHtml = list.length
    ? list.map(item => {
        const below = isBelow(item);
        return `
          <div class="insumo-card ${below ? 'below-min' : ''}" onclick="openInsumoForm('${item.id}')">
            <div class="insumo-main">
              <div class="insumo-info">
                <span class="insumo-name">${esc(item.name)}</span>
                <span class="insumo-meta">${esc(catName(item.categoryId))} · ${item.type === 'comprar' ? '🛒 Comprar' : '👨‍🍳 Produzir'}</span>
              </div>
              <div class="insumo-qty-col">
                <span class="qty-atual ${below ? 'text-danger' : 'text-success'}">${fmtQty(item.currentQty)} ${item.unit}</span>
                <span class="qty-min-lbl">mín: ${fmtQty(item.minQty)}</span>
              </div>
            </div>
            ${item.observation ? `<div class="insumo-obs">${esc(item.observation)}</div>` : ''}
            ${below ? '<span class="badge-below">Abaixo do mínimo</span>' : ''}
          </div>`;
      }).join('')
    : `<div class="empty-state">
        <span class="empty-icon">📦</span>
        <p>${state.items.length === 0 ? 'Nenhum insumo cadastrado ainda.' : 'Nenhum item encontrado.'}</p>
        ${state.items.length === 0 ? '<button class="btn-primary" onclick="openInsumoForm()">Cadastrar primeiro insumo</button>' : ''}
       </div>`;

  return `
    <div class="search-bar">
      <input type="search" class="search-input" placeholder="Buscar insumo..."
        value="${esc(search)}" oninput="applyIFilter({search:this.value})">
    </div>

    <div class="filter-row">
      <button class="chip ${!status && !type ? 'chip-active' : ''}"
        onclick="applyIFilter({status:'',type:''})">Todos (${state.items.length})</button>
      <button class="chip ${status === 'below' ? 'chip-active chip-danger' : ''}"
        onclick="applyIFilter({status:'${status === 'below' ? '' : 'below'}'})">⚠️ Baixo (${belowItems().length})</button>
      <button class="chip ${type === 'comprar' ? 'chip-active' : ''}"
        onclick="applyIFilter({type:'${type === 'comprar' ? '' : 'comprar'}'})">🛒 Comprar</button>
      <button class="chip ${type === 'produzir' ? 'chip-active' : ''}"
        onclick="applyIFilter({type:'${type === 'produzir' ? '' : 'produzir'}'})">👨‍🍳 Produzir</button>
    </div>

    ${state.categories.length > 0 ? `
      <select class="select-filter" onchange="applyIFilter({catId:this.value})">
        <option value="">Todas as categorias</option>
        ${catOpts}
      </select>` : ''}

    <div class="insumos-list">${listHtml}</div>

    <button class="fab" onclick="openInsumoForm()" title="Novo insumo">＋</button>
  `;
}

function applyIFilter(updates) {
  Object.assign(iFilters, updates);
  document.getElementById('page-content').innerHTML = insumos();
}

/* =============================================
   PÁGINA: ESTOQUE
   ============================================= */
function estoque() {
  const search = state.estoqueSearch || '';
  let list = sortItems(state.items);
  if (search) list = list.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  const listHtml = list.length
    ? list.map(item => {
        const below = isBelow(item);
        return `
          <div class="estoque-item ${below ? 'estoque-below' : ''}" id="ei-${item.id}">
            <div class="estoque-item-name">${esc(item.name)}</div>
            <div class="estoque-item-meta">${esc(catName(item.categoryId))} · mín: ${fmtQty(item.minQty)} ${item.unit}</div>
            <div class="estoque-controls">
              <button class="btn-qty" onclick="changeQty('${item.id}', -1)" aria-label="Diminuir">−</button>
              <div class="qty-field-wrap">
                <input type="number" class="qty-field" id="qf-${item.id}"
                  value="${fmtQty(item.currentQty)}" min="0" step="1"
                  onchange="setQty('${item.id}', this.value)"
                  onblur="setQty('${item.id}', this.value)">
                <span class="qty-unit-lbl">${item.unit}</span>
              </div>
              <button class="btn-qty" onclick="changeQty('${item.id}', 1)" aria-label="Aumentar">＋</button>
              <span class="save-check" id="sc-${item.id}">✓</span>
            </div>
          </div>`;
      }).join('')
    : `<div class="empty-state">
        <span class="empty-icon">✏️</span>
        <p>${state.items.length === 0 ? 'Nenhum insumo cadastrado.' : 'Nenhum item encontrado.'}</p>
       </div>`;

  return `
    <div class="search-bar">
      <input type="search" class="search-input" placeholder="Buscar item..."
        value="${esc(search)}" oninput="filterEstoque(this.value)">
    </div>
    <div class="estoque-tip">Toque no número para editar · Use − e ＋ para ajustes rápidos</div>
    <div class="estoque-list">${listHtml}</div>
  `;
}

function filterEstoque(val) {
  state.estoqueSearch = val;
  document.getElementById('page-content').innerHTML = estoque();
}

function changeQty(id, delta) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  item.currentQty = Math.max(0, Math.round((parseFloat(item.currentQty) + delta) * 10) / 10);
  _refreshEstoqueItem(item);
  scheduleQtySave(id, item.currentQty);
}

function setQty(id, val) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  const n = parseFloat(val);
  if (isNaN(n) || n < 0) return;
  item.currentQty = Math.round(n * 10) / 10;
  _refreshEstoqueItem(item);
  scheduleQtySave(id, item.currentQty);
}

// Atualiza o DOM localmente sem esperar o Firestore (otimista)
function _refreshEstoqueItem(item) {
  const row = document.getElementById(`ei-${item.id}`);
  if (row) row.classList.toggle('estoque-below', isBelow(item));
  const inp = document.getElementById(`qf-${item.id}`);
  if (inp) inp.value = fmtQty(item.currentQty);
  const sc = document.getElementById(`sc-${item.id}`);
  if (sc) {
    sc.classList.add('show');
    clearTimeout(sc._t);
    sc._t = setTimeout(() => sc.classList.remove('show'), 1400);
  }
}

// Debounce da escrita no Firestore (evita writes por tecla)
function scheduleQtySave(id, qty) {
  clearTimeout(qtyTimers[id]);
  qtyTimers[id] = setTimeout(async () => {
    try {
      await db.collection('items').doc(id).update({ currentQty: qty });
    } catch (e) {
      console.error('Qty save error:', e);
      showToast('Erro ao salvar quantidade', 'error');
    }
    delete qtyTimers[id];
  }, 700);
}

/* =============================================
   PÁGINA: LISTAS
   ============================================= */
function listas() {
  const comprar  = belowItems('comprar');
  const produzir = belowItems('produzir');
  const current  = listaTab === 'comprar' ? comprar : produzir;
  const vazio    = listaTab === 'comprar' ? 'comprar' : 'produzir';

  const listHtml = current.length
    ? current.map(item => `
        <div class="lista-item">
          <div class="lista-item-info">
            <span class="lista-item-name">${esc(item.name)}</span>
            <span class="lista-item-cat">${esc(catName(item.categoryId))}</span>
          </div>
          <div class="lista-item-qty">
            <span class="liq-atual">Atual: ${fmtQty(item.currentQty)} ${item.unit}</span>
            <span class="liq-min">Mín: ${fmtQty(item.minQty)} ${item.unit}</span>
          </div>
        </div>`).join('')
    : `<div class="empty-state success">
        <span class="empty-icon">✅</span>
        <p>Nenhum item para ${vazio} no momento!</p>
       </div>`;

  const hasAny = comprar.length > 0 || produzir.length > 0;

  return `
    <div class="tabs">
      <button class="tab ${listaTab === 'comprar' ? 'tab-active' : ''}"
        onclick="setListaTab('comprar')">
        🛒 Comprar <span class="tab-badge">${comprar.length}</span>
      </button>
      <button class="tab ${listaTab === 'produzir' ? 'tab-active' : ''}"
        onclick="setListaTab('produzir')">
        👨‍🍳 Produzir <span class="tab-badge">${produzir.length}</span>
      </button>
    </div>

    <div class="lista-content">${listHtml}</div>

    ${hasAny ? `
      <div class="lista-actions">
        <button class="btn-whatsapp" onclick="sendWhatsApp()">
          📱 Enviar por WhatsApp
        </button>
        <button class="btn-copy" onclick="copyLista()">
          📋 Copiar texto
        </button>
      </div>` : ''}
  `;
}

function setListaTab(tab) {
  listaTab = tab;
  document.getElementById('page-content').innerHTML = listas();
}

function gerarTexto() {
  const comprar  = belowItems('comprar');
  const produzir = belowItems('produzir');
  const data     = new Date().toLocaleDateString('pt-BR');
  let msg = `*Estoque Cafeteria*\n_${data}_\n`;

  if (comprar.length) {
    msg += `\n*Itens para comprar:*\n`;
    comprar.forEach(i => msg += `- ${i.name}: atual ${fmtQty(i.currentQty)} ${i.unit} | mínimo ${fmtQty(i.minQty)} ${i.unit}\n`);
  }
  if (produzir.length) {
    msg += `\n*Itens para produzir:*\n`;
    produzir.forEach(i => msg += `- ${i.name}: atual ${fmtQty(i.currentQty)} ${i.unit} | mínimo ${fmtQty(i.minQty)} ${i.unit}\n`);
  }
  if (!comprar.length && !produzir.length) {
    msg += `\n_Estoque OK! Todos os itens dentro do mínimo. ✅_`;
  }
  return msg;
}

function sendWhatsApp() {
  const text = gerarTexto();
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

function copyLista() {
  const text = gerarTexto().replace(/\*/g, '').replace(/_/g, '');
  const doFallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Texto copiado!', 'success');
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(
      () => showToast('Texto copiado!', 'success'),
      doFallback
    );
  } else {
    doFallback();
  }
}

/* =============================================
   PÁGINA: CATEGORIAS
   ============================================= */
function categorias() {
  const listHtml = state.categories.length
    ? state.categories.map(cat => {
        const count = state.items.filter(i => i.categoryId === cat.id).length;
        return `
          <div class="cat-card">
            <div class="cat-info">
              <span class="cat-name">${esc(cat.name)}</span>
              <span class="cat-count">${count} ${count === 1 ? 'insumo' : 'insumos'}</span>
            </div>
            <div class="cat-actions">
              <button class="btn-icon-sm" onclick="openCatForm('${cat.id}')" title="Editar">✏️</button>
              <button class="btn-icon-sm" onclick="confirmDelCat('${cat.id}')" title="Excluir">🗑️</button>
            </div>
          </div>`;
      }).join('')
    : `<div class="empty-state">
        <span class="empty-icon">🏷️</span>
        <p>Nenhuma categoria cadastrada.</p>
       </div>`;

  return `
    <div class="page-top-action">
      <button class="btn-primary" onclick="openCatForm()">+ Nova categoria</button>
    </div>
    <div class="cat-list">${listHtml}</div>
  `;
}

/* =============================================
   FORM: INSUMO (add/edit)
   ============================================= */
function openInsumoForm(id) {
  const item = id ? state.items.find(i => i.id === id) : null;
  const title = item ? 'Editar Insumo' : 'Novo Insumo';

  const catOpts = state.categories
    .map(c => `<option value="${c.id}" ${item && item.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');

  const unitOpts = UNITS
    .map(u => `<option value="${u}" ${item && item.unit === u ? 'selected' : ''}>${u}</option>`)
    .join('');

  const isComprar  = !item || item.type === 'comprar';
  const isProduzir = item && item.type === 'produzir';

  const html = `
    <form id="form-insumo" onsubmit="saveInsumo(event,'${id || ''}')">
      <div class="form-group">
        <label class="form-label">Nome *</label>
        <input type="text" name="name" class="form-input" required
          placeholder="Ex: Leite integral" value="${item ? esc(item.name) : ''}" autocomplete="off">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Categoria</label>
          <select name="categoryId" class="form-input form-select">
            <option value="">Sem categoria</option>
            ${catOpts}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Unidade *</label>
          <select name="unit" class="form-input form-select" required>
            ${unitOpts}
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Qtd. atual *</label>
          <input type="number" name="currentQty" class="form-input" required
            min="0" step="0.1" placeholder="0"
            value="${item ? item.currentQty : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Qtd. mínima *</label>
          <input type="number" name="minQty" class="form-input" required
            min="0" step="0.1" placeholder="0"
            value="${item ? item.minQty : ''}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Tipo *</label>
        <div class="radio-group">
          <label class="radio-opt ${isComprar ? 'sel' : ''}">
            <input type="radio" name="type" value="comprar" ${isComprar ? 'checked' : ''}>
            🛒 Comprar
          </label>
          <label class="radio-opt ${isProduzir ? 'sel' : ''}">
            <input type="radio" name="type" value="produzir" ${isProduzir ? 'checked' : ''}>
            👨‍🍳 Produzir
          </label>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Observação</label>
        <textarea name="observation" class="form-input form-textarea"
          placeholder="Opcional...">${item ? esc(item.observation) : ''}</textarea>
      </div>

      <div class="form-actions">
        ${id ? `<button type="button" class="btn-danger-ghost" onclick="confirmDelInsumo('${id}')">Excluir</button>` : ''}
        <div class="spacer"></div>
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn-primary" id="btn-save-insumo">Salvar</button>
      </div>
    </form>`;

  openModal(title, html);

  setTimeout(() => {
    document.querySelectorAll('#form-insumo .radio-opt input').forEach(inp => {
      inp.addEventListener('change', () => {
        document.querySelectorAll('#form-insumo .radio-opt').forEach(lb =>
          lb.classList.toggle('sel', lb.querySelector('input').checked)
        );
      });
    });
  }, 50);
}

async function saveInsumo(e, id) {
  e.preventDefault();
  const f = e.target;
  const name = f.name.value.trim();
  if (!name) { showToast('Informe o nome do insumo', 'error'); return; }

  const saveBtn = document.getElementById('btn-save-insumo');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Salvando...'; }

  const data = {
    name,
    categoryId:  f.categoryId.value,
    unit:        f.unit.value,
    currentQty:  Math.max(0, parseFloat(f.currentQty.value) || 0),
    minQty:      Math.max(0, parseFloat(f.minQty.value) || 0),
    type:        f.type.value,
    observation: f.observation.value.trim(),
  };

  try {
    if (id) {
      await db.collection('items').doc(id).update(data);
    } else {
      await db.collection('items').add({ ...data, createdAt: new Date().toISOString() });
    }
    closeModal();
    showToast(id ? 'Insumo atualizado!' : 'Insumo cadastrado!', 'success');
  } catch (err) {
    console.error(err);
    showToast('Erro ao salvar. Tente novamente.', 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Salvar'; }
  }
}

function confirmDelInsumo(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  openModal('Excluir Insumo', `
    <p class="confirm-msg">Excluir <strong>${esc(item.name)}</strong>?</p>
    <p class="text-muted" style="font-size:13px;margin-bottom:16px">Esta ação não pode ser desfeita.</p>
    <div class="form-actions">
      <button class="btn-secondary" onclick="openInsumoForm('${id}')">Voltar</button>
      <div class="spacer"></div>
      <button class="btn-danger" onclick="deleteInsumo('${id}')">Excluir</button>
    </div>`);
}

async function deleteInsumo(id) {
  try {
    await db.collection('items').doc(id).delete();
    closeModal();
    showToast('Insumo excluído', 'success');
  } catch (err) {
    console.error(err);
    showToast('Erro ao excluir', 'error');
  }
}

/* =============================================
   FORM: CATEGORIA (add/edit)
   ============================================= */
function openCatForm(id) {
  const cat = id ? state.categories.find(c => c.id === id) : null;
  openModal(cat ? 'Editar Categoria' : 'Nova Categoria', `
    <form id="form-cat" onsubmit="saveCat(event,'${id || ''}')">
      <div class="form-group">
        <label class="form-label">Nome da categoria *</label>
        <input type="text" name="name" class="form-input" required
          placeholder="Ex: Geladeira" value="${cat ? esc(cat.name) : ''}" autocomplete="off">
      </div>
      <div class="form-actions">
        ${id ? `<button type="button" class="btn-danger-ghost" onclick="confirmDelCat('${id}')">Excluir</button>` : ''}
        <div class="spacer"></div>
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn-primary" id="btn-save-cat">Salvar</button>
      </div>
    </form>`);
  setTimeout(() => document.querySelector('#form-cat [name="name"]')?.focus(), 80);
}

async function saveCat(e, id) {
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) { showToast('Informe o nome da categoria', 'error'); return; }

  const saveBtn = document.getElementById('btn-save-cat');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Salvando...'; }

  try {
    if (id) {
      await db.collection('categories').doc(id).update({ name });
    } else {
      await db.collection('categories').add({ name, createdAt: new Date().toISOString() });
    }
    closeModal();
    showToast(id ? 'Categoria atualizada!' : 'Categoria criada!', 'success');
  } catch (err) {
    console.error(err);
    showToast('Erro ao salvar. Tente novamente.', 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Salvar'; }
  }
}

function confirmDelCat(id) {
  const cat   = state.categories.find(c => c.id === id);
  if (!cat) return;
  const count = state.items.filter(i => i.categoryId === id).length;
  openModal('Excluir Categoria', `
    <p class="confirm-msg">Excluir <strong>${esc(cat.name)}</strong>?</p>
    ${count > 0 ? `<p class="confirm-warn">⚠️ ${count} ${count === 1 ? 'insumo usa' : 'insumos usam'} esta categoria e ficarão sem categoria.</p>` : ''}
    <div class="form-actions" style="margin-top:16px">
      <button class="btn-secondary" onclick="openCatForm('${id}')">Voltar</button>
      <div class="spacer"></div>
      <button class="btn-danger" onclick="deleteCat('${id}')">Excluir</button>
    </div>`);
}

async function deleteCat(id) {
  try {
    // Remove categoria dos itens que a usam
    const batch = db.batch();
    state.items
      .filter(i => i.categoryId === id)
      .forEach(i => batch.update(db.collection('items').doc(i.id), { categoryId: '' }));
    batch.delete(db.collection('categories').doc(id));
    await batch.commit();
    closeModal();
    showToast('Categoria excluída', 'success');
  } catch (err) {
    console.error(err);
    showToast('Erro ao excluir', 'error');
  }
}

/* =============================================
   MODAL
   ============================================= */
function openModal(title, html) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

/* =============================================
   LOADER
   ============================================= */
function showLoader(visible) {
  const loader = document.getElementById('loader');
  const app    = document.getElementById('app');
  if (visible) {
    loader.classList.remove('hidden');
    app.classList.add('hidden');
  } else {
    loader.classList.add('hidden');
    app.classList.remove('hidden');
  }
}

function showLoaderError(title, msg) {
  const loader = document.getElementById('loader');
  loader.innerHTML = `
    <div class="loader-logo">⚠️</div>
    <p class="loader-error-title">${title}</p>
    <p class="loader-error-msg">${msg}</p>
    <button class="loader-retry-btn" onclick="location.reload()">Tentar novamente</button>
  `;
}

/* =============================================
   TOAST
   ============================================= */
let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast-${type}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

/* =============================================
   UTIL
   ============================================= */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function refreshCurrentPage() {
  const renders = { dashboard, insumos, estoque, listas, categorias };
  const fn = renders[state.page];
  if (fn) document.getElementById('page-content').innerHTML = fn();
}

/* =============================================
   TECLADO
   ============================================= */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

/* =============================================
   START
   ============================================= */
document.addEventListener('DOMContentLoaded', initFirebase);
