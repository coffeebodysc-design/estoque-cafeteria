'use strict';

/* =============================================
   CONSTANTES
   ============================================= */
const UNITS = ['un', 'kg', 'g', 'L', 'ml', 'cx', 'pct', 'dz'];

/* =============================================
   FIRESTORE
   ============================================= */
let db;

/* =============================================
   ESTADO
   ============================================= */
let state = {
  page:           'dashboard',
  categories:     [],
  items:          [],
  cafeTab:        'produto',
  producaoTab:    'estoque',
  cafeSearch:     '',
  producaoSearch: '',
  initialized:    false,
};

let listaTab = 'enviar';
const qtyTimers = {};
let _catsReady = false, _itemsReady = false;

/* =============================================
   FIREBASE INIT
   ============================================= */
function initFirebase() {
  if (!FIREBASE_CONFIG || FIREBASE_CONFIG.apiKey.startsWith('COLE_AQUI')) {
    showLoaderError('Configure o Firebase primeiro!',
      'Abra <strong>firebase-config.js</strong> e preencha com os dados do seu projeto.');
    return;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    setupListeners();
  } catch (e) {
    console.error(e);
    showLoaderError('Erro ao conectar', 'Verifique a configuração do Firebase.');
  }
}

function setupListeners() {
  db.collection('categories').orderBy('name').onSnapshot(snap => {
    state.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _catsReady = true;
    checkDataReady();
    if (state.initialized) safeRefresh();
  }, err => {
    console.error(err);
    showLoaderError('Erro de permissão',
      'Verifique as <strong>Regras do Firestore</strong> no Firebase Console.');
  });

  db.collection('items').orderBy('name').onSnapshot(snap => {
    state.items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _itemsReady = true;
    checkDataReady();
    if (state.initialized) safeRefresh();
  }, err => {
    console.error(err);
    showToast('Erro ao carregar itens', 'error');
  });
}

function checkDataReady() {
  if (!_catsReady || !_itemsReady || state.initialized) return;
  state.initialized = true;
  showLoader(false);
  setupNav();

  // Detecta schema antigo (seções antigas) ou banco vazio → reseed
  const OLD_SECTIONS = ['produto', 'insumo_cafeteria', 'insumo_producao'];
  const hasOldSchema = state.items.length > 0 &&
    state.items.some(i => OLD_SECTIONS.includes(i.section));
  const isEmpty = state.items.length === 0 && state.categories.length === 0;

  if (hasOldSchema || isEmpty) {
    clearAndSeed();
  } else {
    navigateTo('dashboard');
  }
}

function safeRefresh() {
  const focused = document.activeElement;
  const content = document.getElementById('page-content');
  if (content && content.contains(focused)) return;
  refreshCurrentPage();
}

/* =============================================
   MIGRAÇÃO / SEED
   ============================================= */
async function clearAndSeed() {
  showLoader(true);
  document.querySelector('.loader-text').textContent = 'Carregando dados...';

  try {
    if (state.items.length > 0 || state.categories.length > 0) {
      const delBatch = db.batch();
      state.items.forEach(i => delBatch.delete(db.collection('items').doc(i.id)));
      state.categories.forEach(c => delBatch.delete(db.collection('categories').doc(c.id)));
      await delBatch.commit();
    }
    await seedData();
  } catch (e) {
    console.error('Clear/seed error:', e);
    showLoader(false);
    navigateTo('dashboard');
  }
}

async function seedData() {
  const now = new Date().toISOString();

  const catVitrineRef  = db.collection('categories').doc();
  const catCafeRef     = db.collection('categories').doc();
  const catEstoqueRef  = db.collection('categories').doc();
  const catProdInsRef  = db.collection('categories').doc();

  // ── BATCH 1: categorias + cafe_produto + patricia_estoque ──────────
  const batch1 = db.batch();
  batch1.set(catVitrineRef, { name: 'Vitrine Café',     createdAt: now });
  batch1.set(catCafeRef,    { name: 'Insumos Café',     createdAt: now });
  batch1.set(catEstoqueRef, { name: 'Estoque Patricia', createdAt: now });
  batch1.set(catProdInsRef, { name: 'Insumos Produção', createdAt: now });

  const produtosList = [
    { name: 'Banana Bread',       unit: 'un', minQty: 8  },
    { name: 'Bolo Cenoura',       unit: 'un', minQty: 10 },
    { name: 'Bolo Milho',         unit: 'un', minQty: 10 },
    { name: 'Brownie',            unit: 'un', minQty: 5  },
    { name: 'Caramelo Salgado',   unit: 'g',  minQty: 0  },
    { name: 'Calda de Goiabada',  unit: 'g',  minQty: 0  },
    { name: 'Cookie Red Velvet',  unit: 'un', minQty: 5  },
    { name: 'Cookie Tradicional', unit: 'un', minQty: 10 },
    { name: 'Focaccia',           unit: 'un', minQty: 3  },
    { name: 'Fudge',              unit: 'un', minQty: 5  },
    { name: 'Muffin de Mirtilo',  unit: 'un', minQty: 6  },
    { name: 'Pão de Queijo',      unit: 'un', minQty: 15 },
    { name: 'Torta Banoffee',     unit: 'un', minQty: 0  },
    { name: 'Torta de Limão',     unit: 'un', minQty: 0  },
  ];

  // Estoque na cafeteria (barista conta)
  produtosList.forEach(p => {
    const ref = db.collection('items').doc();
    batch1.set(ref, { ...p, section: 'cafe_produto', categoryId: catVitrineRef.id,
      currentQty: 0, observation: '', createdAt: now });
  });

  // Estoque na produção da Patricia (o que ela tem pronto)
  produtosList.forEach(p => {
    const ref = db.collection('items').doc();
    batch1.set(ref, { ...p, section: 'patricia_estoque', categoryId: catEstoqueRef.id,
      currentQty: 0, observation: '', createdAt: now });
  });

  await batch1.commit();

  // ── BATCH 2: cafe_insumo ──────────────────────────────────────────
  const batch2 = db.batch();
  [
    { name: 'Abacate',           unit: 'un', minQty: 5   },
    { name: 'Água com Gás',      unit: 'un', minQty: 10  },
    { name: 'Água sem Gás',      unit: 'un', minQty: 10  },
    { name: 'Chocolate Sicao',   unit: 'kg', minQty: 2   },
    { name: 'Coca-cola Normal',  unit: 'un', minQty: 6   },
    { name: 'Coca-cola Zero',    unit: 'un', minQty: 10  },
    { name: 'Creme de Leite',    unit: 'un', minQty: 3   },
    { name: 'Doce de Leite',     unit: 'un', minQty: 2   },
    { name: 'Filtro 102',        unit: 'un', minQty: 3   },
    { name: 'Filtro N4',         unit: 'un', minQty: 2   },
    { name: 'Filtro V60',        unit: 'un', minQty: 2   },
    { name: 'Geleia de Frutas',  unit: 'un', minQty: 1   },
    { name: 'Leite Integral',    unit: 'L',  minQty: 6   },
    { name: 'Leite Sem Lactose', unit: 'L',  minQty: 3   },
    { name: 'Leite Vegetal',     unit: 'L',  minQty: 5   },
    { name: 'Limão',             unit: 'un', minQty: 3   },
    { name: 'Manteiga',          unit: 'un', minQty: 3   },
    { name: 'Ovo',               unit: 'un', minQty: 60  },
    { name: 'Pão Ciabatta',      unit: 'un', minQty: 50  },
    { name: 'Pão de Sanduíche',  unit: 'un', minQty: 2   },
    { name: 'Polvilho Azedo',    unit: 'kg', minQty: 2   },
    { name: 'Polvilho Doce',     unit: 'kg', minQty: 2   },
    { name: 'Presunto',          unit: 'g',  minQty: 100 },
    { name: 'Queijo Fatiado',    unit: 'g',  minQty: 500 },
    { name: 'Queijo Minas',      unit: 'g',  minQty: 200 },
    { name: 'Xarope Avelã',      unit: 'un', minQty: 1   },
    { name: 'Xarope Baunilha',   unit: 'un', minQty: 1   },
  ].forEach(i => {
    const ref = db.collection('items').doc();
    batch2.set(ref, { ...i, section: 'cafe_insumo', categoryId: catCafeRef.id,
      currentQty: 0, observation: '', createdAt: now });
  });

  await batch2.commit();

  // ── BATCH 3: patricia_insumo ──────────────────────────────────────
  const batch3 = db.batch();
  [
    { name: 'Açúcar',                    unit: 'kg', minQty: 0 },
    { name: 'Açúcar Demerara',           unit: 'kg', minQty: 0 },
    { name: 'Açúcar Mascavo',            unit: 'kg', minQty: 0 },
    { name: 'Amido de Milho',            unit: 'kg', minQty: 0 },
    { name: 'Azeite de Oliva',           unit: 'L',  minQty: 0 },
    { name: 'Banana Banoffee',           unit: 'un', minQty: 0 },
    { name: 'Banana Grande',             unit: 'un', minQty: 0 },
    { name: 'Bicarbonato de Sódio',      unit: 'g',  minQty: 0 },
    { name: 'Biscoito Isabela 400g',     unit: 'un', minQty: 0 },
    { name: 'Cacau em Pó',               unit: 'kg', minQty: 0 },
    { name: 'Canela em Pó',              unit: 'g',  minQty: 0 },
    { name: 'Cenoura',                   unit: 'kg', minQty: 0 },
    { name: 'Chocolate Branco',          unit: 'kg', minQty: 0 },
    { name: 'Cranberry',                 unit: 'g',  minQty: 0 },
    { name: 'Essência de Baunilha',      unit: 'ml', minQty: 0 },
    { name: 'Farinha 00',                unit: 'kg', minQty: 0 },
    { name: 'Farinha de Arroz',          unit: 'kg', minQty: 0 },
    { name: 'Farinha de Trigo',          unit: 'kg', minQty: 0 },
    { name: 'Farinha de Trigo Integral', unit: 'kg', minQty: 0 },
    { name: 'Fermento Químico em Pó',    unit: 'g',  minQty: 0 },
    { name: 'Forma Brownie 135ml',       unit: 'un', minQty: 0 },
    { name: 'Forma Focaccia 500ml',      unit: 'un', minQty: 0 },
    { name: 'Fubá',                      unit: 'kg', minQty: 0 },
    { name: 'Goiabada',                  unit: 'kg', minQty: 0 },
    { name: 'Gotas de Chocolate',        unit: 'kg', minQty: 0 },
    { name: 'Leite Condensado',          unit: 'un', minQty: 0 },
    { name: 'Limão (Produção)',          unit: 'un', minQty: 0 },
    { name: 'Limão Siciliano',           unit: 'un', minQty: 0 },
    { name: 'Milho',                     unit: 'un', minQty: 0 },
    { name: 'Mirtilo',                   unit: 'g',  minQty: 0 },
    { name: 'Nata',                      unit: 'kg', minQty: 0 },
    { name: 'Óleo',                      unit: 'L',  minQty: 0 },
    { name: 'Tomate Cereja',             unit: 'g',  minQty: 0 },
  ].forEach(i => {
    const ref = db.collection('items').doc();
    batch3.set(ref, { ...i, section: 'patricia_insumo', categoryId: catProdInsRef.id,
      currentQty: 0, observation: '', createdAt: now });
  });

  await batch3.commit();
  showLoader(false);
  navigateTo('dashboard');
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
    cafeteria:  'Cafeteria',
    producao:   'Produção',
    listas:     'Listas',
    categorias: 'Categorias',
  };
  document.getElementById('page-title').textContent = titles[page] || page;
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.page === page)
  );
  const renders = { dashboard, cafeteria, producao, listas, categorias };
  const el = document.getElementById('page-content');
  el.innerHTML = (renders[page] || (() => ''))();
  el.scrollTop = 0;
}

/* =============================================
   HELPERS
   ============================================= */
function catName(id) {
  const c = state.categories.find(c => c.id === id);
  return c ? c.name : '';
}

function isBelow(item) {
  return parseFloat(item.minQty) > 0 &&
         parseFloat(item.currentQty) < parseFloat(item.minQty);
}

function fmtQty(qty) {
  const n = parseFloat(qty);
  if (isNaN(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

function itemsBySection(section) {
  return state.items.filter(i => i.section === section);
}

function belowBySection(...sections) {
  return state.items.filter(i => sections.includes(i.section) && isBelow(i));
}

function sortWithBelowFirst(arr) {
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
  const cafeAbaixo    = belowBySection('cafe_produto');
  const produzirAbaixo = belowBySection('patricia_estoque');
  const comprarAbaixo = belowBySection('cafe_insumo', 'patricia_insumo');

  const totalCafeProd  = itemsBySection('cafe_produto').length;
  const totalPatEstoque = itemsBySection('patricia_estoque').length;

  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  const alertas = [...cafeAbaixo, ...produzirAbaixo, ...comprarAbaixo];
  const alertasHtml = alertas.length
    ? `<div class="section">
        <p class="section-title">⚠️ Atenção necessária</p>
        <div class="alert-list">
          ${alertas.map(item => {
            const pageTarget = item.section === 'cafe_produto' || item.section === 'cafe_insumo'
              ? 'cafeteria' : 'producao';
            const icon = item.section === 'cafe_produto'     ? '☕' :
                         item.section === 'cafe_insumo'      ? '📦' :
                         item.section === 'patricia_estoque' ? '👩‍🍳' : '🛒';
            const label = item.section === 'cafe_produto'     ? 'Cafeteria · Vitrine' :
                          item.section === 'cafe_insumo'      ? 'Cafeteria · Insumo' :
                          item.section === 'patricia_estoque' ? 'Patricia · Estoque' :
                                                                'Patricia · Insumo';
            return `
              <div class="alert-item" onclick="navigateTo('${pageTarget}')">
                <div class="alert-item-info">
                  <span class="alert-item-name">${esc(item.name)}</span>
                  <span class="alert-item-cat">${icon} ${label}</span>
                </div>
                <div class="alert-item-qty">
                  <span class="qty-badge-danger">${fmtQty(item.currentQty)} ${item.unit}</span>
                  <span class="qty-min-sm">mín: ${fmtQty(item.minQty)}</span>
                </div>
              </div>`;
          }).join('')}
        </div>
       </div>`
    : `<div class="empty-state success">
        <span class="empty-icon">✅</span>
        <p>Tudo certo! Estoque dentro do mínimo.</p>
       </div>`;

  return `
    <div class="date-header">${hoje}</div>

    <div class="stats-grid">
      <div class="stat-card" onclick="navigateTo('cafeteria')">
        <div class="stat-icon">☕</div>
        <div class="stat-value">${totalCafeProd}</div>
        <div class="stat-label">Vitrine Café</div>
      </div>
      <div class="stat-card ${cafeAbaixo.length > 0 ? 'stat-danger' : ''}" onclick="navigateTo('listas')">
        <div class="stat-icon">${cafeAbaixo.length > 0 ? '⚠️' : '✅'}</div>
        <div class="stat-value">${cafeAbaixo.length}</div>
        <div class="stat-label">Enviar</div>
      </div>
      <div class="stat-card" onclick="navigateTo('producao')">
        <div class="stat-icon">👩‍🍳</div>
        <div class="stat-value">${totalPatEstoque}</div>
        <div class="stat-label">Est. Patricia</div>
      </div>
      <div class="stat-card ${comprarAbaixo.length > 0 ? 'stat-danger' : ''}" onclick="navigateTo('listas')">
        <div class="stat-icon">${comprarAbaixo.length > 0 ? '🛒' : '✅'}</div>
        <div class="stat-value">${comprarAbaixo.length}</div>
        <div class="stat-label">Comprar</div>
      </div>
    </div>

    <div class="quick-actions">
      <button class="btn-action-primary" onclick="navigateTo('cafeteria')">
        <span>☕</span> Atualizar Cafeteria
      </button>
      <button class="btn-action-secondary" onclick="navigateTo('producao')">
        <span>👩‍🍳</span> Atualizar Produção
      </button>
      <button class="btn-action-secondary" onclick="navigateTo('listas')">
        <span>📋</span> Ver listas de compra / produção
      </button>
    </div>

    ${alertasHtml}
  `;
}

/* =============================================
   PÁGINA: CAFETERIA
   ============================================= */
function cafeteria() {
  const tab     = state.cafeTab;
  const section = tab === 'produto' ? 'cafe_produto' : 'cafe_insumo';
  const search  = state.cafeSearch || '';

  let list = sortWithBelowFirst(itemsBySection(section));
  if (search) list = list.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  const belowProd  = belowBySection('cafe_produto').length;
  const belowIns   = belowBySection('cafe_insumo').length;
  const totalProd  = itemsBySection('cafe_produto').length;
  const totalIns   = itemsBySection('cafe_insumo').length;

  const tip = tab === 'produto'
    ? '− Vendeu · ＋ Recebeu · Toque no número para editar'
    : 'Toque no número para editar · Use − e ＋ para ajustes rápidos';

  const listHtml = list.length
    ? list.map(item => renderItemCard(item)).join('')
    : `<div class="empty-state">
        <span class="empty-icon">${tab === 'produto' ? '🛍️' : '📦'}</span>
        <p>Nenhum item encontrado.</p>
       </div>`;

  const badgeProd = belowProd > 0
    ? `<span class="tab-badge tab-badge-alert">${belowProd}</span>`
    : `<span class="tab-badge">${totalProd}</span>`;
  const badgeIns = belowIns > 0
    ? `<span class="tab-badge tab-badge-alert">${belowIns}</span>`
    : `<span class="tab-badge">${totalIns}</span>`;

  return `
    <div class="tabs">
      <button class="tab ${tab === 'produto' ? 'tab-active' : ''}" onclick="setCafeTab('produto')">
        🛍️ Produtos ${badgeProd}
      </button>
      <button class="tab ${tab === 'insumo' ? 'tab-active' : ''}" onclick="setCafeTab('insumo')">
        📦 Insumos ${badgeIns}
      </button>
    </div>
    <div class="search-bar">
      <input type="search" class="search-input" placeholder="Buscar..."
        value="${esc(search)}" oninput="filterCafe(this.value)">
    </div>
    <div class="estoque-tip">${tip}</div>
    <div class="estoque-list">${listHtml}</div>
    <button class="fab" onclick="openItemForm(null,'${section}')" title="Novo item">＋</button>
  `;
}

function setCafeTab(tab) {
  state.cafeTab   = tab;
  state.cafeSearch = '';
  document.getElementById('page-content').innerHTML = cafeteria();
}

function filterCafe(val) {
  state.cafeSearch = val;
  document.getElementById('page-content').innerHTML = cafeteria();
}

/* =============================================
   PÁGINA: PRODUÇÃO
   ============================================= */
function producao() {
  const tab     = state.producaoTab;
  const section = tab === 'estoque' ? 'patricia_estoque' : 'patricia_insumo';
  const search  = state.producaoSearch || '';

  let list = sortWithBelowFirst(itemsBySection(section));
  if (search) list = list.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  const belowEst = belowBySection('patricia_estoque').length;
  const belowIns = belowBySection('patricia_insumo').length;
  const totalEst = itemsBySection('patricia_estoque').length;
  const totalIns = itemsBySection('patricia_insumo').length;

  const tip = tab === 'estoque'
    ? '− Enviou para café · ＋ Produziu · Toque no número para editar'
    : 'Toque no número para editar · Use − e ＋ para ajustes rápidos';

  const listHtml = list.length
    ? list.map(item => renderItemCard(item)).join('')
    : `<div class="empty-state">
        <span class="empty-icon">${tab === 'estoque' ? '📦' : '🛒'}</span>
        <p>Nenhum item encontrado.</p>
       </div>`;

  const badgeEst = belowEst > 0
    ? `<span class="tab-badge tab-badge-alert">${belowEst}</span>`
    : `<span class="tab-badge">${totalEst}</span>`;
  const badgeIns = belowIns > 0
    ? `<span class="tab-badge tab-badge-alert">${belowIns}</span>`
    : `<span class="tab-badge">${totalIns}</span>`;

  return `
    <div class="tabs">
      <button class="tab ${tab === 'estoque' ? 'tab-active' : ''}" onclick="setProducaoTab('estoque')">
        📦 Estoque ${badgeEst}
      </button>
      <button class="tab ${tab === 'insumo' ? 'tab-active' : ''}" onclick="setProducaoTab('insumo')">
        🛒 Insumos ${badgeIns}
      </button>
    </div>
    <div class="search-bar">
      <input type="search" class="search-input" placeholder="Buscar..."
        value="${esc(search)}" oninput="filterProducao(this.value)">
    </div>
    <div class="estoque-tip">${tip}</div>
    <div class="estoque-list">${listHtml}</div>
    <button class="fab" onclick="openItemForm(null,'${section}')" title="Novo item">＋</button>
  `;
}

function setProducaoTab(tab) {
  state.producaoTab   = tab;
  state.producaoSearch = '';
  document.getElementById('page-content').innerHTML = producao();
}

function filterProducao(val) {
  state.producaoSearch = val;
  document.getElementById('page-content').innerHTML = producao();
}

/* =============================================
   CARD DE ITEM (compartilhado)
   ============================================= */
function renderItemCard(item) {
  const below = isBelow(item);
  const sectionLabel =
    item.section === 'cafe_produto'     ? '⚠️ Enviar para café · ' :
    item.section === 'patricia_estoque' ? '⚠️ Produzir · ' :
    '⚠️ Comprar · ';
  return `
    <div class="estoque-item ${below ? 'estoque-below' : ''}" id="ei-${item.id}">
      <div class="estoque-item-header">
        <div>
          <div class="estoque-item-name">${esc(item.name)}</div>
          <div class="estoque-item-meta">
            ${below ? `<span class="text-danger" style="font-weight:700">${sectionLabel}</span>` : ''}
            mín: ${fmtQty(item.minQty)} ${item.unit}
          </div>
        </div>
        <button class="btn-edit-item" onclick="openItemForm('${item.id}')" title="Editar">✏️</button>
      </div>
      <div class="estoque-controls">
        <button class="btn-qty" onclick="changeQty('${item.id}', -1)">−</button>
        <div class="qty-field-wrap">
          <input type="number" class="qty-field" id="qf-${item.id}"
            value="${fmtQty(item.currentQty)}" min="0" step="1"
            onchange="setQty('${item.id}', this.value)"
            onblur="setQty('${item.id}', this.value)">
          <span class="qty-unit-lbl">${item.unit}</span>
        </div>
        <button class="btn-qty" onclick="changeQty('${item.id}', 1)">＋</button>
        <span class="save-check" id="sc-${item.id}">✓</span>
      </div>
    </div>`;
}

/* =============================================
   ESTOQUE: CONTROLES COMUNS
   ============================================= */
function changeQty(id, delta) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  item.currentQty = Math.max(0, Math.round((parseFloat(item.currentQty) + delta) * 10) / 10);
  _refreshQtyItem(item);
  scheduleQtySave(id, item.currentQty);
}

function setQty(id, val) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  const n = parseFloat(val);
  if (isNaN(n) || n < 0) return;
  item.currentQty = Math.round(n * 10) / 10;
  _refreshQtyItem(item);
  scheduleQtySave(id, item.currentQty);
}

function _refreshQtyItem(item) {
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
  const enviar   = belowBySection('cafe_produto');       // barista precisa que Patricia envie
  const produzir = belowBySection('patricia_estoque');   // Patricia precisa produzir
  const comprar  = belowBySection('cafe_insumo', 'patricia_insumo'); // precisa comprar

  const current = listaTab === 'enviar'   ? enviar :
                  listaTab === 'produzir' ? produzir : comprar;

  const renderLista = items => items.length
    ? items.map(item => {
        const icon = item.section === 'cafe_produto'     ? '☕' :
                     item.section === 'patricia_estoque' ? '👩‍🍳' :
                     item.section === 'cafe_insumo'      ? '📦' : '🛒';
        const label = item.section === 'cafe_produto'     ? 'Cafeteria' :
                      item.section === 'patricia_estoque' ? 'Produção' :
                      item.section === 'cafe_insumo'      ? 'Insumo Café' : 'Insumo Produção';
        return `
          <div class="lista-item">
            <div class="lista-item-info">
              <span class="lista-item-name">${esc(item.name)}</span>
              <span class="lista-item-cat">${icon} ${label}</span>
            </div>
            <div class="lista-item-qty">
              <span class="liq-atual">Atual: ${fmtQty(item.currentQty)} ${item.unit}</span>
              <span class="liq-min">Mín: ${fmtQty(item.minQty)} ${item.unit}</span>
            </div>
          </div>`;
      }).join('')
    : `<div class="empty-state success">
        <span class="empty-icon">✅</span>
        <p>${listaTab === 'enviar' ? 'Café com estoque OK!' :
            listaTab === 'produzir' ? 'Nada para produzir!' : 'Nada para comprar!'}</p>
       </div>`;

  const hasAny = enviar.length > 0 || produzir.length > 0 || comprar.length > 0;

  return `
    <div class="tabs tabs-3">
      <button class="tab ${listaTab === 'enviar' ? 'tab-active' : ''}"
        onclick="setListaTab('enviar')">
        ☕ Enviar <span class="tab-badge">${enviar.length}</span>
      </button>
      <button class="tab ${listaTab === 'produzir' ? 'tab-active' : ''}"
        onclick="setListaTab('produzir')">
        👩‍🍳 Produzir <span class="tab-badge">${produzir.length}</span>
      </button>
      <button class="tab ${listaTab === 'comprar' ? 'tab-active' : ''}"
        onclick="setListaTab('comprar')">
        🛒 Comprar <span class="tab-badge">${comprar.length}</span>
      </button>
    </div>

    <div class="lista-content">${renderLista(current)}</div>

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
  const enviar      = belowBySection('cafe_produto');
  const produzir    = belowBySection('patricia_estoque');
  const comprarCafe = belowBySection('cafe_insumo');
  const comprarProd = belowBySection('patricia_insumo');
  const data        = new Date().toLocaleDateString('pt-BR');

  let msg = `*Estoque Cafeteria*\n_${data}_\n`;

  if (enviar.length) {
    msg += `\n*Enviar para Café (Patricia → Café):*\n`;
    enviar.forEach(i => msg += `- ${i.name}: atual ${fmtQty(i.currentQty)} ${i.unit} | mín ${fmtQty(i.minQty)} ${i.unit}\n`);
  }
  if (produzir.length) {
    msg += `\n*Produzir (Patricia):*\n`;
    produzir.forEach(i => msg += `- ${i.name}: atual ${fmtQty(i.currentQty)} ${i.unit} | mín ${fmtQty(i.minQty)} ${i.unit}\n`);
  }
  if (comprarCafe.length) {
    msg += `\n*Comprar (Cafeteria):*\n`;
    comprarCafe.forEach(i => msg += `- ${i.name}: atual ${fmtQty(i.currentQty)} ${i.unit} | mín ${fmtQty(i.minQty)} ${i.unit}\n`);
  }
  if (comprarProd.length) {
    msg += `\n*Comprar (Produção Pati):*\n`;
    comprarProd.forEach(i => msg += `- ${i.name}: atual ${fmtQty(i.currentQty)} ${i.unit} | mín ${fmtQty(i.minQty)} ${i.unit}\n`);
  }
  if (!enviar.length && !produzir.length && !comprarCafe.length && !comprarProd.length) {
    msg += `\n_Tudo OK! Estoque dentro do mínimo. ✅_`;
  }
  return msg;
}

function sendWhatsApp() {
  window.open(`https://wa.me/?text=${encodeURIComponent(gerarTexto())}`, '_blank');
}

function copyLista() {
  const text = gerarTexto().replace(/\*/g, '').replace(/_/g, '');
  const doFallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Texto copiado!', 'success');
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Texto copiado!', 'success'), doFallback);
  } else doFallback();
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
              <span class="cat-count">${count} ${count === 1 ? 'item' : 'itens'}</span>
            </div>
            <div class="cat-actions">
              <button class="btn-icon-sm" onclick="openCatForm('${cat.id}')">✏️</button>
              <button class="btn-icon-sm" onclick="confirmDelCat('${cat.id}')">🗑️</button>
            </div>
          </div>`;
      }).join('')
    : `<div class="empty-state"><span class="empty-icon">🏷️</span><p>Nenhuma categoria.</p></div>`;

  return `
    <div class="page-top-action">
      <button class="btn-primary" onclick="openCatForm()">+ Nova categoria</button>
    </div>
    <div class="cat-list">${listHtml}</div>
  `;
}

/* =============================================
   FORM: ITEM (add/edit)
   ============================================= */
function openItemForm(id, defaultSection) {
  const item    = id ? state.items.find(i => i.id === id) : null;
  const section = item ? item.section : (defaultSection || 'cafe_produto');
  const title   = item ? 'Editar Item' : 'Novo Item';

  const catOpts = state.categories
    .map(c => `<option value="${c.id}" ${item && item.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');

  const unitOpts = UNITS
    .map(u => `<option value="${u}" ${(item ? item.unit : 'un') === u ? 'selected' : ''}>${u}</option>`)
    .join('');

  const sectionOpts = [
    { v: 'cafe_produto',     l: '🛍️ Produto Cafeteria'    },
    { v: 'cafe_insumo',      l: '📦 Insumo Cafeteria'      },
    { v: 'patricia_estoque', l: '👩‍🍳 Estoque Patricia'      },
    { v: 'patricia_insumo',  l: '🛒 Insumo Produção Pati'  },
  ].map(o => `<option value="${o.v}" ${section === o.v ? 'selected' : ''}>${o.l}</option>`).join('');

  const html = `
    <form id="form-item" onsubmit="saveItem(event,'${id || ''}')">

      <div class="form-group">
        <label class="form-label">Nome *</label>
        <input type="text" name="name" class="form-input" required autocomplete="off"
          placeholder="Ex: Brownie" value="${item ? esc(item.name) : ''}">
      </div>

      <div class="form-group">
        <label class="form-label">Tipo *</label>
        <select name="section" class="form-input form-select" required>
          ${sectionOpts}
        </select>
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
            min="0" step="0.1" placeholder="0" value="${item ? item.currentQty : '0'}">
        </div>
        <div class="form-group">
          <label class="form-label">Qtd. mínima</label>
          <input type="number" name="minQty" class="form-input"
            min="0" step="0.1" placeholder="0" value="${item ? item.minQty : '0'}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Observação</label>
        <textarea name="observation" class="form-input form-textarea"
          placeholder="Opcional...">${item ? esc(item.observation || '') : ''}</textarea>
      </div>

      <div class="form-actions">
        ${id ? `<button type="button" class="btn-danger-ghost" onclick="confirmDelItem('${id}')">Excluir</button>` : ''}
        <div class="spacer"></div>
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn-primary" id="btn-save-item">Salvar</button>
      </div>
    </form>`;

  openModal(title, html);
}

async function saveItem(e, id) {
  e.preventDefault();
  const f = e.target;
  const name = f.name.value.trim();
  if (!name) { showToast('Informe o nome', 'error'); return; }

  const saveBtn = document.getElementById('btn-save-item');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Salvando...'; }

  const data = {
    name,
    section:     f.section.value,
    categoryId:  f.categoryId.value,
    unit:        f.unit.value,
    currentQty:  Math.max(0, parseFloat(f.currentQty.value) || 0),
    minQty:      Math.max(0, parseFloat(f.minQty.value) || 0),
    observation: f.observation.value.trim(),
  };

  try {
    if (id) {
      await db.collection('items').doc(id).update(data);
    } else {
      await db.collection('items').add({ ...data, createdAt: new Date().toISOString() });
    }
    closeModal();
    showToast(id ? 'Atualizado!' : 'Cadastrado!', 'success');
  } catch (err) {
    console.error(err);
    showToast('Erro ao salvar', 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Salvar'; }
  }
}

function confirmDelItem(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  openModal('Excluir Item', `
    <p class="confirm-msg">Excluir <strong>${esc(item.name)}</strong>?</p>
    <p class="text-muted" style="font-size:13px;margin-bottom:16px">Esta ação não pode ser desfeita.</p>
    <div class="form-actions">
      <button class="btn-secondary" onclick="openItemForm('${id}')">Voltar</button>
      <div class="spacer"></div>
      <button class="btn-danger" onclick="deleteItem('${id}')">Excluir</button>
    </div>`);
}

async function deleteItem(id) {
  try {
    await db.collection('items').doc(id).delete();
    closeModal();
    showToast('Item excluído', 'success');
  } catch (err) {
    console.error(err);
    showToast('Erro ao excluir', 'error');
  }
}

/* =============================================
   FORM: CATEGORIA
   ============================================= */
function openCatForm(id) {
  const cat = id ? state.categories.find(c => c.id === id) : null;
  openModal(cat ? 'Editar Categoria' : 'Nova Categoria', `
    <form id="form-cat" onsubmit="saveCat(event,'${id || ''}')">
      <div class="form-group">
        <label class="form-label">Nome da categoria *</label>
        <input type="text" name="name" class="form-input" required autocomplete="off"
          placeholder="Ex: Bebidas" value="${cat ? esc(cat.name) : ''}">
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
  if (!name) { showToast('Informe o nome', 'error'); return; }
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
    showToast('Erro ao salvar', 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Salvar'; }
  }
}

function confirmDelCat(id) {
  const cat   = state.categories.find(c => c.id === id);
  if (!cat) return;
  const count = state.items.filter(i => i.categoryId === id).length;
  openModal('Excluir Categoria', `
    <p class="confirm-msg">Excluir <strong>${esc(cat.name)}</strong>?</p>
    ${count > 0 ? `<p class="confirm-warn">⚠️ ${count} ${count === 1 ? 'item usa' : 'itens usam'} esta categoria.</p>` : ''}
    <div class="form-actions" style="margin-top:16px">
      <button class="btn-secondary" onclick="openCatForm('${id}')">Voltar</button>
      <div class="spacer"></div>
      <button class="btn-danger" onclick="deleteCat('${id}')">Excluir</button>
    </div>`);
}

async function deleteCat(id) {
  try {
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
  document.getElementById('loader').classList.toggle('hidden', !visible);
  document.getElementById('app').classList.toggle('hidden', visible);
}

function showLoaderError(title, msg) {
  document.getElementById('loader').innerHTML = `
    <div class="loader-logo">⚠️</div>
    <p class="loader-error-title">${title}</p>
    <p class="loader-error-msg">${msg}</p>
    <button class="loader-retry-btn" onclick="location.reload()">Tentar novamente</button>`;
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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function refreshCurrentPage() {
  const renders = { dashboard, cafeteria, producao, listas, categorias };
  const fn = renders[state.page];
  if (fn) document.getElementById('page-content').innerHTML = fn();
}

/* =============================================
   TECLADO
   ============================================= */
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* =============================================
   START
   ============================================= */
document.addEventListener('DOMContentLoaded', initFirebase);
