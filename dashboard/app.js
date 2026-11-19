// Token Radar's dashboard (radar-2). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable and sortable table, a per-protocol detail dialog with
// the model's own inputs and the protocol's farm plan, a live-token view, a set-aside view and the
// method itself, with a sandbox that re-runs the model. No network: every byte it shows is in data.js.
//
// The value model lives here as well as in main.ts, in the same arithmetic: the page derives the
// peer multiples from the live protocols data.js carries, recomputes every row, and says so in the
// detail view, so the screenshots, the code and the board's numbers visibly agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.model;
  var state = {
    q: '', chain: 'all', category: 'all', status: 'all', tab: 'board',
    sort: 'implied', dir: -1, selected: null,
    growthWeight: M.growth_weight, maturityFloor: M.maturity_floor
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }

  // --- the model, in the page, from the snapshot's own figures -------------------------------
  function median(values) {
    if (!values.length) return null;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  // Every category's multiple is the median mcap/TVL of its live peers in this snapshot (3+ peers),
  // else the median over every live protocol; clamped to the model's floor and cap. Nothing is typed
  // in by hand: the market's own multiples, read out of the data.
  function peerMultiples() {
    var byCat = {};
    var all = [];
    (DATA.live_all || []).forEach(function (p) {
      if (p.mcap_usd === null || p.mcap_usd === undefined || p.tvl_usd <= 0) return;
      var ratio = p.mcap_usd / p.tvl_usd;
      if (!isFinite(ratio) || ratio <= 0) return;
      all.push(ratio);
      if (p.category) (byCat[p.category] = byCat[p.category] || []).push(ratio);
    });
    var clamp = function (v) { return Math.min(M.multiple_cap, Math.max(M.multiple_floor, v)); };
    var global = clamp(median(all) || 0.25);
    var table = {};
    Object.keys(byCat).forEach(function (cat) {
      var list = byCat[cat];
      if (list.length < M.multiple_min_peers) return;
      var m = median(list);
      if (m !== null) table[cat] = { multiple: clamp(m), peers: list.length };
    });
    return { byCategory: table, global: global };
  }
  var PEERS = peerMultiples();
  function multipleFor(row) {
    if (row.category && PEERS.byCategory[row.category]) return PEERS.byCategory[row.category];
    return { multiple: PEERS.global, peers: 0 };
  }
  function likelihoodFor(row) {
    if (!row.category) return 0.7;
    if (row.category === 'Risk Curators' || row.category === 'Onchain Capital Allocator') return 0.8;
    if (row.category === 'Chain' || row.category === 'Staking Pool') return 0.9;
    return 1.0;
  }
  // implied = TVL x peer multiple x growth x maturity x likelihood x breadth. The same function
  // main.ts runs, so the page can check the board's number row by row.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_per_chain * Math.min((row.chains || []).length, model.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * multipleFor(row).multiple * growthMult * maturity * likelihoodFor(row) * breadth));
  }
  function momentumOf(row) {
    var growth = Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var youth = row.age_days === null || row.age_days === undefined ? 1 : 1 + (Math.max(0, 365 - row.age_days) / 365) * 0.5;
    return Math.round(growth * youth * 100) / 100;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // --- state in the address hash, so a filtered view and a detail view are linkable -------------
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('status')) state.status = params.get('status');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.status !== 'all') params.set('status', state.status);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.status === 'watchlist' && !r.watchlist) return false;
      if (state.status === 'early' && r.watchlist) return false;
      if (state.status === 'rising' && momentumOf(r) < 15) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'momentum') { av = momentumOf(a); bv = momentumOf(b); }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // --- views ----------------------------------------------------------------------------------
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }
  function chainLabel(r) {
    var chains = r.chains || [];
    if (!chains.length) return 'an unnamed chain';
    if (chains.length <= 2) return chains.join(', ');
    return chains.slice(0, 2).join(', ') + ' +' + (chains.length - 2);
  }
  function protocolCell(r, badges) {
    var kids = [el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) })];
    if (badges) kids.push(badges);
    return el('td', null, el('div', { class: 'name' }, kids));
  }
  function badgesFor(r) {
    var out = [];
    if (r.watchlist) out.push(el('span', { class: 'badge watch', text: 'watchlist' }));
    if (momentumOf(r) >= 15) out.push(el('span', { class: 'badge rising', text: 'rising' }));
    if (!out.length) return null;
    var wrap = el('span', null);
    out.forEach(function (b, i) { if (i) wrap.appendChild(document.createTextNode(' ')); wrap.appendChild(b); });
    return wrap;
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another chain, category or board to see the radar again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.chain = 'all'; state.category = 'all'; state.status = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var mom = momentumOf(r);
      var momClass = mom >= 15 ? 'pos' : mom <= -15 ? 'neg' : '';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { state.selected = r.slug; writeHash(); render(); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.selected = r.slug; writeHash(); render(); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        protocolCell(r, badgesFor(r)),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num ' + momClass, text: (mom > 0 ? '+' : '') + mom.toFixed(1) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String((r.chains || []).length) })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its value breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Rank' }),
            sortHeader('name', 'Protocol'),
            sortHeader('implied', 'Implied value'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('momentum', 'Momentum'),
            sortHeader('age', 'Age'),
            el('th', { scope: 'col', text: 'Chains' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var ratio = r.mcap_usd !== null && r.tvl_usd > 0 ? r.mcap_usd / r.tvl_usd : null;
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'badge live', text: 'already trades' })),
        protocolCell(r, null),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: ratio === null ? 'n/a' : ratio.toFixed(2) + 'x' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their mcap/TVL ratios are the peers the model prices the pre-token board from.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function setAsideTable() {
    var tbody = el('tbody');
    DATA.set_aside.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.category || 'Other' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { text: r.reason })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token on record, but left out of the ranking: each one is a product of a token that already trades, or a pool of another protocol, so it is not a launch to farm.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why it is set aside' }))),
          tbody
        )
      )
    );
  }

  function methodPanel() {
    var cats = Object.keys(DATA.multiples).sort();
    var multRows = cats.map(function (c) {
      var v = DATA.multiples[c];
      return el('tr', null, el('td', { text: c }), el('td', { class: 'num', text: v.multiple.toFixed(3) + 'x' }), el('td', { class: 'num', text: String(v.peers) }));
    });
    var panel = el('div', { class: 'panel' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every protocol, from the snapshot\u2019s own figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd \u00d7 peer multiple \u00d7 growth \u00d7 maturity \u00d7 likelihood \u00d7 breadth )\n' +
        'peer multiple = median(mcap / TVL) of the live peers in the protocol\u2019s category (3+ peers),\n' +
        '                else the median over every live protocol (' + DATA.global_multiple.toFixed(3) + 'x here), clamped to [' + M.multiple_floor + ', ' + M.multiple_cap + ']\n' +
        'growth        = 1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 \u00d7 ' + M.growth_weight + '\n' +
        'maturity      = ' + M.maturity_floor + ' + min(age_days, ' + M.maturity_days + ') / ' + M.maturity_days + ' \u00d7 ' + M.maturity_range + '   (unknown age: ' + M.unknown_age_days + ' days)\n' +
        'likelihood    = 1.0, except vault curators and capital allocators (0.8), chains and staking pools (0.9), uncategorised (0.7)\n' +
        'breadth       = 1 + ' + M.breadth_per_chain + ' \u00d7 min(chains, ' + M.breadth_max_chains + ')'
      ),
      el('h3', { text: 'Why the peer multiple' }),
      el('p', { text: 'A token is worth what the market pays for a protocol like it. Lending tokens trade near 0.13x TVL and DEX tokens near 0.34x, so one flat multiple would misprice both: the model reads each sector\u2019s own median out of the snapshot\u2019s live protocols at run time. A sector with no listed peer yet falls back to the market-wide median.' }),
      el('h3', { text: 'Momentum: the early signal' }),
      el('p', { text: 'Momentum is seven-day growth weighted toward young protocols: a protocol growing fast in its first year scores above an old one growing at the same rate. The Rising fast filter shows the board\u2019s momentum at 15 and above \u2014 the launches the radar exists to catch early.' }),
      el('h3', { text: 'Peer multiples in this snapshot' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'mult-table' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Median mcap / TVL' }), el('th', { scope: 'col', text: 'Live peers' }))),
          el('tbody', null, multRows)
        )
      ),
      el('h3', { text: 'Farm plans' }),
      el('p', { text: 'Each row\u2019s seven steps are derived from its own record: the action follows the category, the gas follows the chain (about $12 on Ethereum, about $1 on the low-fee chains, under $0.10 on Solana), the capital follows the protocol\u2019s size ($50 to $250), and the hold follows its age (30 to 60 days). Every step states what it costs and how long it takes.' }),
      el('h3', { text: 'Try the model' }),
      el('p', { class: 'sub', text: 'Move the weights and the board re-ranks in the page, with the same function main.ts runs. The board above never changes: this is a sandbox, not the entry.' })
    );
    panel.appendChild(sandbox());
    return panel;
  }

  function sandbox() {
    var gw = el('input', { type: 'range', id: 'sb-gw', min: '0', max: '1', step: '0.05', value: String(state.growthWeight), 'aria-label': 'Growth weight' });
    var mf = el('input', { type: 'range', id: 'sb-mf', min: '0.4', max: '0.8', step: '0.05', value: String(state.maturityFloor), 'aria-label': 'Maturity floor' });
    var gwOut = el('output', { text: state.growthWeight.toFixed(2) });
    var mfOut = el('output', { text: state.maturityFloor.toFixed(2) });
    var result = el('div', { id: 'sb-result' });
    function run() {
      var model = {
        growth_weight: state.growthWeight, growth_floor: M.growth_floor, growth_cap: M.growth_cap,
        maturity_floor: state.maturityFloor, maturity_range: M.maturity_range, maturity_days: M.maturity_days,
        unknown_age_days: M.unknown_age_days, breadth_per_chain: M.breadth_per_chain, breadth_max_chains: M.breadth_max_chains
      };
      var rescored = DATA.rows.map(function (r) { return { slug: r.slug, name: r.name, oldRank: r.rank, value: impliedOf(r, model) }; })
        .sort(function (a, b) { return b.value - a.value || (a.slug < b.slug ? -1 : 1); });
      var changed = 0;
      rescored.forEach(function (r, i) { if (r.oldRank !== i + 1) changed++; });
      var tbody = el('tbody');
      rescored.slice(0, 10).forEach(function (r, i) {
        tbody.appendChild(el('tr', null,
          el('td', { class: 'num', text: String(i + 1) }),
          el('td', null, el('b', { text: r.name })),
          el('td', { class: 'num', text: fmtUsd(r.value) }),
          el('td', { class: 'num', text: 'was #' + r.oldRank })
        ));
      });
      result.textContent = '';
      result.appendChild(el('p', { class: 'sub', text: changed + ' of ' + DATA.rows.length + ' rows change rank at these weights. Top 10 under the sandbox:' }));
      result.appendChild(el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Rank' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Implied value' }), el('th', { scope: 'col', text: 'Board rank' }))),
          tbody
        )
      ));
    }
    gw.addEventListener('input', function () { state.growthWeight = parseFloat(gw.value); gwOut.textContent = state.growthWeight.toFixed(2); run(); });
    mf.addEventListener('input', function () { state.maturityFloor = parseFloat(mf.value); mfOut.textContent = state.maturityFloor.toFixed(2); run(); });
    var box = el('div', null,
      el('div', { class: 'sandbox' },
        el('label', null, 'Growth weight ', gwOut, gw),
        el('label', null, 'Maturity floor ', mfOut, mf)
      ),
      result
    );
    run();
    return box;
  }

  // --- detail dialog ----------------------------------------------------------------------------
  var dialog = document.getElementById('detail');
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var mult = multipleFor(row);
    var recomputed = impliedOf(row, M);
    var growth = Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * M.growth_weight;
    var age = row.age_days === null ? M.unknown_age_days : row.age_days;
    var maturity = M.maturity_floor + (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    var breadth = 1 + M.breadth_per_chain * Math.min((row.chains || []).length, M.breadth_max_chains);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · on the watchlist' : ' · early row') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + ((row.chains || []).join(', ') || 'an unnamed chain') + ' · records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value: ' + fmtUsd(row.implied_value_usd) }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple' }), el('b', { class: 'num', text: mult.multiple.toFixed(3) + 'x' + (mult.peers ? ' (' + mult.peers + ' peers)' : ' (market median)') })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(growthMult) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(maturity) })),
        el('div', null, el('span', { text: 'Token likelihood' }), el('b', { class: 'num', text: likelihoodFor(row).toFixed(2) })),
        el('div', null, el('span', { text: 'Chain breadth' }), el('b', { class: 'num', text: fmtMult(breadth) })),
        el('div', null, el('span', { text: 'Momentum' }), el('b', { class: 'num ' + (momentumOf(row) >= 15 ? 'pos' : ''), text: (momentumOf(row) > 0 ? '+' : '') + momentumOf(row).toFixed(1) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // --- chrome -----------------------------------------------------------------------------------
  function fillControls() {
    var chains = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
    var chainSel = document.getElementById('chain');
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a] || (a < b ? -1 : 1); }).forEach(function (c) {
      chainSel.appendChild(el('option', { value: c, text: c + ' (' + chains[c] + ')', selected: c === state.chain ? 'selected' : null }));
    });
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var catSel = document.getElementById('category');
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    cats.forEach(function (c) {
      catSel.appendChild(el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }));
    });
    document.getElementById('q').value = state.q;
    document.getElementById('status').value = state.status;
    document.getElementById('meta-asof').textContent = 'Snapshot ' + DATA.as_of;
    document.getElementById('meta-model').textContent = DATA.model_version + ' model';
    document.getElementById('lede-title').textContent = DATA.watchlist_size + ' watchlist protocols, ' + DATA.board_size + ' pre-token rows, ranked by implied value';
    document.getElementById('lede-sub').textContent = 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols below that floor. Implied value is a model, not a promise.';
    var facts = document.getElementById('facts');
    facts.textContent = '';
    [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows scored', String(DATA.board_size)],
      ['Early rows below the floor', String(DATA.early_size)],
      ['Total implied value', fmtUsd(DATA.total_implied_usd)],
      ['Live-token protocols set aside', String(DATA.live_size)],
      ['Set aside, with reasons', String(DATA.set_aside_size)]
    ].forEach(function (f) {
      facts.appendChild(el('div', { class: 'fact' }, el('span', { text: f[0] }), el('b', { text: f[1] })));
    });
  }

  function render() {
    var view = document.getElementById('view');
    view.textContent = '';
    ['board', 'live', 'setaside', 'method'].forEach(function (t) {
      document.getElementById('tab-' + t).setAttribute('aria-selected', state.tab === t ? 'true' : 'false');
    });
    var count = document.getElementById('count');
    if (state.tab === 'board') {
      view.appendChild(boardTable());
      count.textContent = rows().length + ' of ' + DATA.board_size + ' rows shown';
    } else if (state.tab === 'live') {
      view.appendChild(liveTable());
      count.textContent = DATA.live.length + ' live-token protocols';
    } else if (state.tab === 'setaside') {
      view.appendChild(setAsideTable());
      count.textContent = DATA.set_aside.length + ' protocols set aside';
    } else {
      view.appendChild(methodPanel());
      count.textContent = 'Method & sandbox';
    }
    if (state.selected && !dialog.open) openDetail(state.selected);
  }

  function wire() {
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); });
    document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(); render(); });
    document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); render(); });
    document.getElementById('status').addEventListener('change', function (e) { state.status = e.target.value; writeHash(); render(); });
    ['board', 'live', 'setaside', 'method'].forEach(function (t) {
      document.getElementById('tab-' + t).addEventListener('click', function () { state.tab = t; writeHash(); render(); });
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dialog.open) dialog.close();
    });
  }

  readHash();
  fillControls();
  wire();
  render();
})();
