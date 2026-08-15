/* Life List — an offline-first checklist.
   Ships with a generic grocery list; any list can be loaded from a file.
   Save format is documented in FORMAT.md. */
(function () {
  'use strict';

  var STORE_KEY = 'lifelist.v1';
  var PREFS_KEY = 'lifelist.prefs.v1';
  var FORMAT = 'lifelist';
  var VERSION = 1;

  var DEFAULT_LABELS = {
    done: 'In cart',
    todo: 'Still to get',
    group: 'Aisle',
    groups: 'Aisles'
  };

  var PRESETS = {
    groceries: { done: 'In cart', todo: 'Still to get', group: 'Aisle', groups: 'Aisles' },
    lifelist:  { done: 'Done',    todo: 'Still to do',  group: 'Chapter', groups: 'Chapters' },
    plain:     { done: 'Ticked',  todo: 'Open',         group: 'Section', groups: 'Sections' }
  };

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  var state = {
    list: null,
    theme: 'auto',   // auto | light | dark
    cat: 0,
    view: 'list',
    query: '',
    hideDone: false,
    editing: null,   // item id being edited
    adding: false,   // inline "add item" form open
    undo: null,      // { snapshot, label }
    deferredInstall: null
  };

  // ── tiny helpers ───────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function uid() {
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** "2019-03" -> "Mar 2019"; "2019-03-05" -> "5 Mar 2019" */
  function formatDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(iso);
    if (!m) return iso;
    var mon = MONTHS[Number(m[2]) - 1] || m[2];
    return m[3] ? Number(m[3]) + ' ' + mon + ' ' + m[1] : mon + ' ' + m[1];
  }

  function monthKey(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(iso || '');
    return m ? m[1] + '-' + m[2] : '';
  }

  function slug(s) {
    return String(s || 'list').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '').slice(0, 40) || 'list';
  }

  // ── model ──────────────────────────────────────────────────────

  function normalizeItem(raw) {
    if (typeof raw === 'string') raw = { title: raw };
    raw = raw || {};
    var date = typeof raw.date === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(raw.date) ? raw.date : null;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      title: String(raw.title == null ? '' : raw.title).trim(),
      done: !!raw.done || !!date && raw.done !== false,
      date: date
    };
  }

  function normalizeList(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Not a list object.');
    var cats = Array.isArray(raw.categories) ? raw.categories : null;
    if (!cats) throw new Error('No "categories" array found.');

    var out = {
      format: FORMAT,
      version: VERSION,
      title: String(raw.title || 'My list').trim() || 'My list',
      subtitle: String(raw.subtitle || '').trim(),
      labels: Object.assign({}, DEFAULT_LABELS, raw.labels || {}),
      updated: typeof raw.updated === 'string' ? raw.updated : new Date().toISOString(),
      categories: []
    };

    cats.forEach(function (c) {
      if (typeof c === 'string') c = { name: c, items: [] };
      if (!c || typeof c !== 'object') return;
      var items = (Array.isArray(c.items) ? c.items : [])
        .map(normalizeItem)
        .filter(function (it) { return it.title !== ''; });
      out.categories.push({
        id: typeof c.id === 'string' && c.id ? c.id : uid(),
        name: String(c.name || 'Untitled').trim() || 'Untitled',
        note: String(c.note || '').trim(),
        items: items
      });
    });

    if (!out.categories.length) throw new Error('The list has no sections.');
    return out;
  }

  function countDone(cat) {
    return cat.items.reduce(function (n, it) { return n + (it.done ? 1 : 0); }, 0);
  }

  function totals() {
    var t = 0, d = 0;
    state.list.categories.forEach(function (c) {
      t += c.items.length;
      d += countDone(c);
    });
    return { total: t, done: d, open: t - d, pct: t ? Math.round((d / t) * 100) : 0 };
  }

  function findItem(id) {
    var cats = state.list.categories;
    for (var ci = 0; ci < cats.length; ci++) {
      for (var ii = 0; ii < cats[ci].items.length; ii++) {
        if (cats[ci].items[ii].id === id) return { cat: cats[ci], ci: ci, item: cats[ci].items[ii], ii: ii };
      }
    }
    return null;
  }

  function clampCat() {
    if (state.cat < 0) state.cat = 0;
    if (state.cat > state.list.categories.length - 1) state.cat = state.list.categories.length - 1;
  }

  // ── storage ────────────────────────────────────────────────────

  function save() {
    state.list.updated = new Date().toISOString();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.list));
    } catch (e) {
      toast('Could not save locally — storage is full or blocked.');
    }
  }

  function loadStored() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try { return normalizeList(JSON.parse(raw)); } catch (e) { return null; }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        hideDone: state.hideDone, cat: state.cat, view: state.view, theme: state.theme
      }));
    } catch (e) { /* non-critical */ }
  }

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (typeof p.hideDone === 'boolean') state.hideDone = p.hideDone;
      if (typeof p.cat === 'number') state.cat = p.cat;
      if (typeof p.view === 'string' && ['list', 'aisles', 'receipts', 'you'].indexOf(p.view) >= 0) state.view = p.view;
      if (['auto', 'light', 'dark'].indexOf(p.theme) >= 0) state.theme = p.theme;
    } catch (e) { /* non-critical */ }
  }

  // ── appearance ─────────────────────────────────────────────────

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function effectiveTheme() {
    return state.theme === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : state.theme;
  }

  function applyTheme() {
    var root = document.documentElement;
    if (state.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.theme);

    var dark = effectiveTheme() === 'dark';
    root.style.colorScheme = state.theme === 'auto' ? 'light dark' : (dark ? 'dark' : 'light');
    var meta = $('themeColor');
    if (meta) meta.setAttribute('content', dark ? '#0C1B2C' : '#D6E9F9');
  }

  function setTheme(next) {
    state.theme = next;
    applyTheme();
    savePrefs();
    render();
  }

  function snapshot() { return JSON.stringify(state.list); }

  function offerUndo(message, snap) {
    state.undo = snap;
    toast(message, 'Undo', function () {
      try {
        state.list = normalizeList(JSON.parse(snap));
        clampCat();
        save();
        render();
        toast('Reverted.');
      } catch (e) { toast('Could not undo.'); }
    });
  }

  // ── markdown <-> list ──────────────────────────────────────────

  function toMarkdown(list) {
    var out = ['# ' + list.title];
    if (list.subtitle) out.push('> ' + list.subtitle);
    out.push('<!-- lifelist labels: ' + JSON.stringify(list.labels) + ' -->');
    out.push('');
    list.categories.forEach(function (c) {
      out.push('## ' + c.name);
      out.push('');
      if (c.note) { out.push(c.note); out.push(''); }
      c.items.forEach(function (it) {
        var line = '- [' + (it.done ? 'x' : ' ') + '] ' + it.title;
        if (it.done && it.date) line += ' <!-- ' + it.date + ' -->';
        out.push(line);
      });
      out.push('');
    });
    return out.join('\n');
  }

  function fromMarkdown(text) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var list = {
      format: FORMAT, version: VERSION, title: '', subtitle: '',
      labels: Object.assign({}, DEFAULT_LABELS), categories: []
    };
    var current = null;

    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line || line === '---' || line === '***') return;

      var lab = /^<!--\s*lifelist labels:\s*(\{[\s\S]*?\})\s*-->$/.exec(line);
      if (lab) {
        try { list.labels = Object.assign({}, DEFAULT_LABELS, JSON.parse(lab[1])); } catch (e) { /* ignore */ }
        return;
      }
      if (/^<!--/.test(line)) return;

      var h1 = /^#\s+(.*)$/.exec(line);
      if (h1) { if (!list.title) list.title = h1[1].trim(); return; }

      var h2 = /^#{2,6}\s+(.*)$/.exec(line);
      if (h2) {
        current = { id: uid(), name: h2[1].trim() || 'Untitled', note: '', items: [] };
        list.categories.push(current);
        return;
      }

      var task = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (task) {
        if (!current) {
          current = { id: uid(), name: 'Items', note: '', items: [] };
          list.categories.push(current);
        }
        var body = task[2].trim();
        var date = null;
        var dm = /\s*<!--\s*(\d{4}-\d{2}(?:-\d{2})?)\s*-->\s*$/.exec(body);
        if (dm) { date = dm[1]; body = body.slice(0, dm.index).trim(); }
        body = body.replace(/\s*<!--[\s\S]*?-->\s*$/, '').trim();
        if (!body) return;
        current.items.push({
          id: uid(),
          title: body,
          done: task[1].toLowerCase() === 'x',
          date: task[1].toLowerCase() === 'x' ? date : null
        });
        return;
      }

      // Plain bullets and bare lines become unticked items.
      var bullet = /^[-*+]\s+(.*)$/.exec(line);
      if (bullet && current) {
        var t = bullet[1].trim();
        if (t) current.items.push({ id: uid(), title: t, done: false, date: null });
        return;
      }

      var quote = /^>\s*(.*)$/.exec(line);
      if (quote) {
        if (!current && !list.subtitle) list.subtitle = quote[1].trim();
        return;
      }

      // Prose right under a heading is kept as the section note.
      if (current && !current.items.length && !current.note) current.note = line;
    });

    list.categories = list.categories.filter(function (c) { return c.items.length > 0; });
    if (!list.title) list.title = 'Imported list';
    return normalizeList(list);
  }

  function parseAnyFile(name, text) {
    var trimmed = text.replace(/^﻿/, '').trim();
    var looksJSON = /\.json$/i.test(name) || trimmed.charAt(0) === '{';
    if (looksJSON) {
      var data = JSON.parse(trimmed); // throws -> caught by caller
      return normalizeList(data);
    }
    return fromMarkdown(text);
  }

  // ── file in / out ──────────────────────────────────────────────

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function exportJSON() {
    var name = slug(state.list.title) + '-' + todayISO() + '.json';
    download(name, JSON.stringify(state.list, null, 2), 'application/json');
    toast('Saved ' + name);
  }

  function exportMarkdown() {
    var name = slug(state.list.title) + '-' + todayISO() + '.md';
    download(name, toMarkdown(state.list), 'text/markdown');
    toast('Saved ' + name);
  }

  function handleFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast('Could not read that file.'); };
    reader.onload = function () {
      var incoming;
      try {
        incoming = parseAnyFile(file.name, String(reader.result));
      } catch (err) {
        toast('Could not load ' + file.name + ': ' + (err && err.message ? err.message : 'unrecognised format'));
        return;
      }
      askImportMode(incoming, file.name);
    };
    reader.readAsText(file);
  }

  function askImportMode(incoming, filename) {
    var n = incoming.categories.reduce(function (a, c) { return a + c.items.length; }, 0);
    openModal({
      title: 'Load list',
      body: '<p><strong>' + esc(incoming.title) + '</strong><br>' +
            esc(String(n)) + ' items in ' + incoming.categories.length + ' sections' +
            (filename ? '<br><span style="opacity:.7">' + esc(filename) + '</span>' : '') + '</p>' +
            '<p>Replace what is on screen, or merge the new items into it?</p>',
      actions: [
        { label: 'Replace', kind: 'btn', run: function () { applyImport(incoming, false); } },
        { label: 'Merge', kind: 'btn secondary', run: function () { applyImport(incoming, true); } },
        { label: 'Cancel', kind: 'btn secondary', run: function () {} }
      ]
    });
  }

  function applyImport(incoming, merge) {
    var snap = snapshot();
    if (!merge) {
      state.list = incoming;
      state.cat = 0;
    } else {
      incoming.categories.forEach(function (inc) {
        var target = null;
        state.list.categories.forEach(function (c) {
          if (c.name.toLowerCase() === inc.name.toLowerCase()) target = c;
        });
        if (!target) {
          target = { id: uid(), name: inc.name, note: inc.note, items: [] };
          state.list.categories.push(target);
        }
        inc.items.forEach(function (it) {
          var existing = null;
          target.items.forEach(function (e) {
            if (e.title.toLowerCase() === it.title.toLowerCase()) existing = e;
          });
          if (existing) {
            if (it.done) { existing.done = true; existing.date = existing.date || it.date; }
          } else {
            target.items.push({ id: uid(), title: it.title, done: it.done, date: it.date });
          }
        });
      });
    }
    clampCat();
    save();
    state.view = 'list';
    render();
    offerUndo(merge ? 'Merged.' : 'List replaced.', snap);
  }

  function resetToDefault() {
    openModal({
      title: 'Start over',
      body: '<p>This clears the list on this device and puts the sample grocery list back. Save a copy first if you want to keep it.</p>',
      actions: [
        { label: 'Reset', kind: 'btn danger', run: function () {
            var snap = snapshot();
            state.list = normalizeList(window.DEFAULT_LIST);
            state.cat = 0;
            save();
            render();
            offerUndo('Back to the sample list.', snap);
          } },
        { label: 'Cancel', kind: 'btn secondary', run: function () {} }
      ]
    });
  }

  // ── mutations ──────────────────────────────────────────────────

  function toggleItem(id) {
    var f = findItem(id);
    if (!f) return;
    if (f.item.done) {
      f.item.done = false;
      f.item.date = null;
    } else {
      f.item.done = true;
      f.item.date = todayISO();
    }
    save();
    render();
  }

  function addItem(catIndex, title) {
    title = String(title || '').trim();
    if (!title) return;
    state.list.categories[catIndex].items.push({ id: uid(), title: title, done: false, date: null });
    save();
    render();
  }

  function updateItem(id, title, date, done) {
    var f = findItem(id);
    if (!f) return;
    f.item.title = String(title || '').trim() || f.item.title;
    f.item.done = !!done;
    f.item.date = done && date ? date : null;
    state.editing = null;
    save();
    render();
  }

  function deleteItem(id) {
    var f = findItem(id);
    if (!f) return;
    var snap = snapshot();
    var title = f.item.title;
    f.cat.items.splice(f.ii, 1);
    state.editing = null;
    save();
    render();
    offerUndo('Removed “' + title + '”.', snap);
  }

  function addCategory(name) {
    name = String(name || '').trim();
    if (!name) return;
    state.list.categories.push({ id: uid(), name: name, note: '', items: [] });
    save();
    render();
  }

  function renameCategory(index) {
    var cat = state.list.categories[index];
    openModal({
      title: 'Rename section',
      body: '<label class="field"><span>Name</span><input type="text" id="renameInput" value="' + esc(cat.name) + '"></label>',
      actions: [
        { label: 'Save', kind: 'btn', run: function () {
            var v = ($('renameInput') || {}).value;
            v = String(v || '').trim();
            if (v) { cat.name = v; save(); render(); }
          } },
        { label: 'Cancel', kind: 'btn secondary', run: function () {} }
      ],
      focus: 'renameInput'
    });
  }

  function deleteCategory(index) {
    var cat = state.list.categories[index];
    if (state.list.categories.length <= 1) { toast('A list needs at least one section.'); return; }
    openModal({
      title: 'Delete section',
      body: '<p>Delete <strong>' + esc(cat.name) + '</strong> and its ' + cat.items.length + ' items?</p>',
      actions: [
        { label: 'Delete', kind: 'btn danger', run: function () {
            var snap = snapshot();
            state.list.categories.splice(index, 1);
            clampCat();
            save();
            render();
            offerUndo('Deleted “' + cat.name + '”.', snap);
          } },
        { label: 'Cancel', kind: 'btn secondary', run: function () {} }
      ]
    });
  }

  function clearTicks() {
    openModal({
      title: 'Clear all ticks',
      body: '<p>Untick every item and drop the dates. The items themselves stay.</p>',
      actions: [
        { label: 'Clear', kind: 'btn danger', run: function () {
            var snap = snapshot();
            state.list.categories.forEach(function (c) {
              c.items.forEach(function (it) { it.done = false; it.date = null; });
            });
            save();
            render();
            offerUndo('All ticks cleared.', snap);
          } },
        { label: 'Cancel', kind: 'btn secondary', run: function () {} }
      ]
    });
  }

  // ── rendering ──────────────────────────────────────────────────

  function render() {
    clampCat();
    var L = state.list.labels;
    var t = totals();

    $('brandTitle').textContent = state.list.title;
    $('brandSub').textContent = state.list.subtitle;
    $('brandSub').hidden = !state.list.subtitle;
    document.title = state.list.title;
    $('counterLabel').textContent = L.done;
    $('counterValue').textContent = t.done + ' / ' + t.total;

    Array.prototype.forEach.call(document.querySelectorAll('.view-tab'), function (b) {
      var on = b.dataset.view === state.view;
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('views').children[1].textContent = L.groups;

    var listView = state.view === 'list';
    $('aisleNav').hidden = !listView || !!state.query;
    $('strip').hidden = !listView;
    $('toolbar').hidden = !listView;
    $('hideDoneBtn').setAttribute('aria-pressed', String(state.hideDone));
    $('search').placeholder = 'Search all ' + L.groups.toLowerCase();

    if (listView) renderAisleNav();

    var view = $('view');
    if (state.view === 'list') view.innerHTML = renderList();
    else if (state.view === 'aisles') view.innerHTML = renderAisles();
    else if (state.view === 'receipts') view.innerHTML = renderReceipts();
    else view.innerHTML = renderYou();

    $('tally').innerHTML =
      '<span>' + esc(L.groups) + ' ' + state.list.categories.length + '</span>' +
      '<span>' + esc(L.done) + ' ' + t.done + '</span>' +
      '<span>' + esc(L.todo) + ' ' + t.open + '</span>' +
      '<span>' + t.pct + '%</span>';

    var af = document.querySelector('[data-autofocus]');
    if (af) af.focus();
  }

  function renderAisleNav() {
    var html = state.list.categories.map(function (c, i) {
      return '<button type="button" class="aisle-chip" data-act="cat" data-i="' + i + '" ' +
        'aria-pressed="' + (i === state.cat) + '">' + esc(c.name) +
        '<span class="chip-count">' + countDone(c) + '/' + c.items.length + '</span></button>';
    }).join('');
    $('aisleNav').innerHTML = html;
    var active = $('aisleNav').querySelector('[aria-pressed="true"]');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function itemRow(item, index, catName) {
    if (state.editing === item.id) return editForm(item);
    var meta = '';
    if (item.done) {
      meta = '<span class="row-meta">' + esc(state.list.labels.done) +
        (item.date ? ' · ' + esc(formatDate(item.date)) : '') + '</span>';
    } else if (catName) {
      meta = '<span class="row-meta muted">' + esc(catName) + '</span>';
    }
    return '<div class="row">' +
      '<button type="button" class="row-main" data-act="toggle" data-id="' + item.id + '" aria-pressed="' + item.done + '">' +
        '<span class="row-num">' + (index == null ? '' : pad(index + 1)) + '</span>' +
        '<span class="mark" aria-hidden="true">' + (item.done ? '✓' : '') + '</span>' +
        '<span class="row-body">' +
          '<span class="row-title">' + esc(item.title) + '</span>' + meta +
        '</span>' +
      '</button>' +
      '<button type="button" class="row-menu" data-act="edit" data-id="' + item.id + '" ' +
        'aria-label="Edit ' + esc(item.title) + '">···</button>' +
    '</div>';
  }

  function editForm(item) {
    return '<form class="inline-form" data-act="save-item" data-id="' + item.id + '">' +
      '<input type="text" name="title" value="' + esc(item.title) + '" aria-label="Item text" data-autofocus>' +
      '<input type="date" name="date" value="' + esc(item.date && item.date.length === 10 ? item.date : (item.date ? item.date + '-01' : '')) + '" aria-label="Date completed">' +
      '<button type="submit" class="btn">Save</button>' +
      '<button type="button" class="btn secondary" data-act="cancel-edit">Cancel</button>' +
      '<button type="button" class="btn danger" data-act="delete-item" data-id="' + item.id + '">Delete</button>' +
    '</form>';
  }

  function renderList() {
    var L = state.list.labels;
    var q = state.query.trim().toLowerCase();

    if (q) {
      var hits = [];
      state.list.categories.forEach(function (c) {
        c.items.forEach(function (it) {
          if (it.title.toLowerCase().indexOf(q) >= 0 && (!state.hideDone || !it.done)) {
            hits.push(itemRow(it, null, c.name));
          }
        });
      });
      $('stripLeft').textContent = 'Search — ' + state.query;
      $('stripRight').textContent = hits.length + ' found';
      return hits.length ? hits.join('') :
        '<p class="empty">Nothing matches “' + esc(state.query) + '”.</p>';
    }

    var cat = state.list.categories[state.cat];
    var done = countDone(cat);
    $('stripLeft').textContent = L.group + ' ' + pad(state.cat + 1) + ' — ' + cat.name;
    $('stripRight').textContent = done + ' / ' + cat.items.length + ' ' + L.done.toLowerCase();

    var rows = cat.items.map(function (it, i) {
      if (state.hideDone && it.done) return '';
      return itemRow(it, i, null);
    }).join('');

    if (!rows) {
      rows = '<p class="empty">' + (cat.items.length ?
        'Everything here is ticked.' :
        'Nothing in this section yet.') + '</p>';
    }

    var note = cat.note ? '<p class="note">' + esc(cat.note) + '</p>' : '';

    var adder = state.adding
      ? '<form class="inline-form" data-act="add-item">' +
          '<input type="text" name="title" placeholder="Add an item" aria-label="New item" data-autofocus>' +
          '<button type="submit" class="btn">Add</button>' +
          '<button type="button" class="btn secondary" data-act="cancel-add">Done</button>' +
        '</form>'
      : '<button type="button" class="add-row" data-act="start-add">+ Add item</button>';

    return note + rows + adder;
  }

  function renderAisles() {
    var L = state.list.labels;
    var cards = state.list.categories.map(function (c, i) {
      var d = countDone(c);
      var pct = c.items.length ? Math.round((d / c.items.length) * 100) : 0;
      return '<div class="card">' +
        '<div class="card-head">' +
          '<span class="card-name">' + pad(i + 1) + ' · ' + esc(c.name) + '</span>' +
          '<span class="card-ratio">' + d + '/' + c.items.length + '</span>' +
        '</div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="card-actions">' +
          '<button type="button" class="mini-btn" data-act="open-cat" data-i="' + i + '">Open</button>' +
          '<button type="button" class="mini-btn" data-act="rename-cat" data-i="' + i + '">Rename</button>' +
          '<button type="button" class="mini-btn danger" data-act="delete-cat" data-i="' + i + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<div class="section-head"><span>All ' + esc(L.groups.toLowerCase()) + '</span>' +
        '<span>' + state.list.categories.length + '</span></div>' +
      '<div class="grid">' + cards + '</div>' +
      '<form class="inline-form" data-act="add-cat" style="margin-top:14px">' +
        '<input type="text" name="name" placeholder="New ' + esc(L.group.toLowerCase()) + ' name" aria-label="New section name">' +
        '<button type="submit" class="btn">Add ' + esc(L.group.toLowerCase()) + '</button>' +
      '</form>';
  }

  function renderReceipts() {
    var L = state.list.labels;
    var buckets = {};
    var order = [];

    state.list.categories.forEach(function (c) {
      c.items.forEach(function (it) {
        if (!it.done) return;
        var k = monthKey(it.date) || 'undated';
        if (!buckets[k]) { buckets[k] = []; order.push(k); }
        buckets[k].push({ item: it, cat: c.name });
      });
    });

    if (!order.length) {
      return '<p class="empty">Nothing ticked off yet. Everything you complete shows up here with its date.</p>';
    }

    order.sort(function (a, b) {
      if (a === 'undated') return 1;
      if (b === 'undated') return -1;
      return a < b ? 1 : -1;
    });

    var html = '<div class="section-head"><span>' + esc(L.done) + ' — receipts</span>' +
      '<span>' + totals().done + '</span></div>';

    order.forEach(function (k) {
      var rows = buckets[k];
      rows.sort(function (a, b) { return (b.item.date || '') < (a.item.date || '') ? -1 : 1; });
      var heading = k === 'undated' ? 'No date' :
        MONTHS[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(0, 4);
      html += '<div class="section-head"><span>' + esc(heading) + '</span><span>' + rows.length + '</span></div>';
      rows.forEach(function (r) {
        html += '<div class="receipt-line">' +
          '<span class="where">' + esc(r.cat) + '</span>' +
          '<span class="what">' + esc(r.item.title) + '</span>' +
          '<span class="where">' + esc(r.item.date ? formatDate(r.item.date) : '—') + '</span>' +
        '</div>';
      });
    });

    return html;
  }

  function renderYou() {
    var t = totals();
    var L = state.list.labels;
    var installable = !!state.deferredInstall;

    return '' +
      '<div class="stats">' +
        stat(L.done, t.done) +
        stat(L.todo, t.open) +
        stat('Total', t.total) +
        stat('Complete', t.pct + '%') +
      '</div>' +

      '<div class="section-head"><span>This list</span></div>' +
      '<form data-act="save-meta">' +
        '<label class="field"><span>Title</span>' +
          '<input type="text" name="title" value="' + esc(state.list.title) + '"></label>' +
        '<label class="field"><span>Subtitle</span>' +
          '<input type="text" name="subtitle" value="' + esc(state.list.subtitle) + '"></label>' +
        '<div class="btn-row"><button type="submit" class="btn">Save</button></div>' +
      '</form>' +
      '<p class="note">Wording used around the app:</p>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn secondary" data-act="preset" data-preset="groceries">Groceries</button>' +
        '<button type="button" class="btn secondary" data-act="preset" data-preset="lifelist">Life list</button>' +
        '<button type="button" class="btn secondary" data-act="preset" data-preset="plain">Plain</button>' +
      '</div>' +

      '<div class="section-head"><span>Appearance</span>' +
        '<span>' + (state.theme === 'auto' ? 'following the system — ' + effectiveTheme() : effectiveTheme()) + '</span></div>' +
      '<div class="btn-row">' +
        themeBtn('auto', 'Auto') + themeBtn('light', 'Light') + themeBtn('dark', 'Dark') +
      '</div>' +

      '<div class="section-head"><span>Your data</span></div>' +
      '<p class="note">Everything stays in this browser. Save a file to move it between devices or to keep a backup.</p>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn" data-act="load-file">Load a file…</button>' +
        '<button type="button" class="btn secondary" data-act="export-json">Save .json</button>' +
        '<button type="button" class="btn secondary" data-act="export-md">Save .md</button>' +
      '</div>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn secondary" data-act="clear-ticks">Clear all ticks</button>' +
        '<button type="button" class="btn danger" data-act="reset">Reset to sample list</button>' +
      '</div>' +
      '<p class="note">Accepted files: this app’s <code>.json</code>, or Markdown with ' +
        '<code>## Section</code> headings and <code>- [ ]</code> / <code>- [x]</code> items. ' +
        'Dates ride along in an HTML comment: <code>- [x] Ironman &lt;!-- 2024-06-09 --&gt;</code>. ' +
        'You can also drag a file anywhere onto the window.</p>' +

      (installable
        ? '<div class="section-head"><span>Install</span></div>' +
          '<div class="btn-row"><button type="button" class="btn" data-act="install">Install app</button></div>'
        : '') +

      '<div class="section-head"><span>About</span></div>' +
      '<p class="note">Offline-capable. Ticking an item stamps today’s date, which is what fills the Receipts tab. ' +
        'Last saved ' + esc(formatDate(String(state.list.updated || '').slice(0, 10)) || '—') + '.</p>';
  }

  function themeBtn(value, label) {
    var on = state.theme === value;
    return '<button type="button" class="btn' + (on ? '' : ' secondary') + '" ' +
      'data-act="theme" data-theme="' + value + '" aria-pressed="' + on + '">' + esc(label) + '</button>';
  }

  function stat(label, value) {
    return '<div class="stat"><span class="stat-label">' + esc(label) + '</span>' +
      '<span class="stat-value">' + esc(String(value)) + '</span></div>';
  }

  // ── toast + modal ──────────────────────────────────────────────

  var toastTimer = null;
  var toastAction = null;

  function toast(msg, actionLabel, action) {
    $('toastMsg').textContent = msg;
    var btn = $('toastBtn');
    toastAction = action || null;
    if (actionLabel && action) {
      btn.textContent = actionLabel;
      btn.hidden = false;
    } else {
      btn.hidden = true;
    }
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').hidden = true; }, actionLabel ? 8000 : 3200);
  }

  var modalActions = [];
  var lastFocused = null;

  function openModal(opts) {
    modalActions = opts.actions || [];
    lastFocused = document.activeElement;
    $('modalCard').innerHTML =
      '<h2 class="modal-title" id="modalTitle">' + esc(opts.title) + '</h2>' +
      '<div class="modal-body">' + opts.body + '</div>' +
      '<div class="modal-actions">' +
        modalActions.map(function (a, i) {
          return '<button type="button" class="' + a.kind + '" data-act="modal" data-i="' + i + '">' + esc(a.label) + '</button>';
        }).join('') +
      '</div>';
    $('modal').hidden = false;
    var f = opts.focus ? $(opts.focus) : $('modalCard').querySelector('button');
    if (f) f.focus();
  }

  function closeModal() {
    $('modal').hidden = true;
    modalActions = [];
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  // ── events ─────────────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (e.target === $('modal')) { closeModal(); return; }
    if (!btn || btn.tagName === 'FORM') return;
    var act = btn.dataset.act;

    switch (act) {
      case 'view':
        state.view = btn.dataset.view;
        state.editing = null;
        state.adding = false;
        savePrefs();
        render();
        window.scrollTo(0, 0);
        break;
      case 'cat':
      case 'open-cat':
        state.cat = Number(btn.dataset.i);
        state.view = 'list';
        state.editing = null;
        savePrefs();
        render();
        break;
      case 'toggle':
        toggleItem(btn.dataset.id);
        break;
      case 'edit':
        state.editing = state.editing === btn.dataset.id ? null : btn.dataset.id;
        render();
        break;
      case 'cancel-edit':
        state.editing = null;
        render();
        break;
      case 'delete-item':
        deleteItem(btn.dataset.id);
        break;
      case 'start-add':
        state.adding = true;
        render();
        break;
      case 'cancel-add':
        state.adding = false;
        render();
        break;
      case 'rename-cat':
        renameCategory(Number(btn.dataset.i));
        break;
      case 'delete-cat':
        deleteCategory(Number(btn.dataset.i));
        break;
      case 'toggle-hide-done':
        state.hideDone = !state.hideDone;
        savePrefs();
        render();
        break;
      case 'theme':
        setTheme(btn.dataset.theme);
        break;
      case 'preset':
        state.list.labels = Object.assign({}, PRESETS[btn.dataset.preset]);
        save();
        render();
        toast('Wording updated.');
        break;
      case 'load-file':
        $('fileInput').click();
        break;
      case 'export-json':
        exportJSON();
        break;
      case 'export-md':
        exportMarkdown();
        break;
      case 'clear-ticks':
        clearTicks();
        break;
      case 'reset':
        resetToDefault();
        break;
      case 'install':
        if (state.deferredInstall) {
          state.deferredInstall.prompt();
          state.deferredInstall = null;
        }
        break;
      case 'modal': {
        var a = modalActions[Number(btn.dataset.i)];
        closeModal();
        if (a && a.run) a.run();
        break;
      }
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form[data-act]');
    if (!form) return;
    e.preventDefault();
    var data = new FormData(form);

    if (form.dataset.act === 'add-item') {
      addItem(state.cat, data.get('title'));
    } else if (form.dataset.act === 'add-cat') {
      addCategory(data.get('name'));
    } else if (form.dataset.act === 'save-item') {
      var date = String(data.get('date') || '');
      updateItem(form.dataset.id, data.get('title'), date, !!date);
    } else if (form.dataset.act === 'save-meta') {
      state.list.title = String(data.get('title') || '').trim() || state.list.title;
      state.list.subtitle = String(data.get('subtitle') || '').trim();
      save();
      render();
      toast('Saved.');
    }
  });

  $('toastBtn').addEventListener('click', function () {
    var fn = toastAction;
    $('toast').hidden = true;
    toastAction = null;
    if (fn) fn();
  });

  $('search').addEventListener('input', function (e) {
    state.query = e.target.value;
    state.editing = null;
    render();
  });

  $('fileInput').addEventListener('change', function (e) {
    handleFile(e.target.files && e.target.files[0]);
    e.target.value = '';
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('modal').hidden) { closeModal(); return; }
      if (state.editing || state.adding) { state.editing = null; state.adding = false; render(); return; }
      if (state.query) { state.query = ''; $('search').value = ''; render(); }
      return;
    }
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing && state.view === 'list') {
      e.preventDefault();
      $('search').focus();
    }
  });

  // drag & drop a list file anywhere
  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
    dragDepth++;
    $('dropVeil').hidden = false;
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('dragleave', function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('dropVeil').hidden = true;
  });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    $('dropVeil').hidden = true;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    state.deferredInstall = e;
    if (state.view === 'you') render();
  });

  // ── boot ───────────────────────────────────────────────────────

  loadPrefs();
  applyTheme();

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSchemeChange = function () {
      if (state.theme !== 'auto') return;
      applyTheme();
      if (state.view === 'you') render();
    };
    if (mq.addEventListener) mq.addEventListener('change', onSchemeChange);
    else if (mq.addListener) mq.addListener(onSchemeChange);
  }

  var hash = location.hash.replace('#', '');
  if (['list', 'aisles', 'receipts', 'you'].indexOf(hash) >= 0) state.view = hash;
  var stored = loadStored();
  state.list = stored || normalizeList(window.DEFAULT_LIST);
  if (!stored && !hash) state.view = 'list';
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function (reg) {
        reg.addEventListener('updatefound', function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('A new version is ready.', 'Reload', function () {
                sw.postMessage('skip-waiting');
                location.reload();
              });
            }
          });
        });
      }).catch(function () { /* offline support simply unavailable */ });
    });
  }
})();
