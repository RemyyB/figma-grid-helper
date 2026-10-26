// Grid Helper
// Grid tab: reads the grid variables for one mode, lets the UI calculate
// col-1 … col-12, and writes the chosen values back to that mode only.
// Spacers tab: mirrors spacers/N into spacers/negative/N for every mode.
// Settings: variable names are configurable per file (stored in the file).
// Empty files: creates a starter set of grid and spacer variables.

var MAX_COLS = 12;
var FALLBACK_PAGE_WIDTH = 1920;

// Default variable names. Users can change them in Settings.
var DEFAULT_NAMES = {
  colPrefix: 'grid/col/col-',          // col-1 … col-12; col-12 is the container width
  columns: 'grid/col/columns',
  gutter: 'grid/gutter',
  gutterNegative: 'grid/gutter-negative',
  margin: 'grid/margin/margin',
  pageWidth: 'grid/page/width',
  spacerPrefix: 'spacers/',            // spacers/1 … spacers/15
  negativePrefix: 'spacers/negative/'  // spacers/negative/1 …
};

var NAMES = Object.assign({}, DEFAULT_NAMES);

var BASE_KEYS = ['col12', 'columns', 'gutter', 'gutterNegative', 'margin', 'pageWidth'];

figma.showUI(__html__, { width: 380, height: 720, themeColors: true });

// ---------- settings ----------

function col12Name() {
  return NAMES.colPrefix + MAX_COLS;
}

function baseName(key) {
  return key === 'col12' ? col12Name() : NAMES[key];
}

// Names are stored in the file, so everyone running the plugin there shares them.
function loadNames() {
  NAMES = Object.assign({}, DEFAULT_NAMES);
  var raw = figma.root.getPluginData('names');
  if (!raw) return;
  try {
    var saved = JSON.parse(raw);
    Object.keys(DEFAULT_NAMES).forEach(function (k) {
      if (typeof saved[k] === 'string' && saved[k].trim()) NAMES[k] = saved[k].trim();
    });
  } catch (e) {
    // Ignore unreadable settings and fall back to the defaults.
  }
}

function saveNames(names) {
  var clean = {};
  Object.keys(DEFAULT_NAMES).forEach(function (k) {
    var v = names && typeof names[k] === 'string' ? names[k].trim() : '';
    if (v && v !== DEFAULT_NAMES[k]) clean[k] = v;
  });
  figma.root.setPluginData('names', Object.keys(clean).length ? JSON.stringify(clean) : '');
  loadNames();
}

// ---------- math (same as in ui.html) ----------

function clean(x) {
  return Math.round(x * 1000) / 1000;
}

function roundValue(x, rounding) {
  var v = clean(x);
  if (rounding === 'floor') return Math.floor(v);
  if (rounding === 'none') return Math.round(v * 100) / 100;
  return Math.round(v);
}

// Width of a span of n columns inside a container of width W.
function spanWidth(n, W, gutter, columns) {
  if (n >= columns) return W;
  var col = (W - (columns - 1) * gutter) / columns;
  return n * col + (n - 1) * gutter;
}

function negate(v) {
  return v === 0 ? 0 : -v;
}

// ---------- reading ----------

function isAlias(raw) {
  return !!raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS';
}

async function resolveValue(variable, modeId, depth) {
  var raw = variable.valuesByMode[modeId];
  if (isAlias(raw)) {
    if (depth > 10) return null;
    var target = await figma.variables.getVariableByIdAsync(raw.id);
    if (!target) return null;
    var targetMode = modeId;
    if (target.variableCollectionId !== variable.variableCollectionId) {
      var tc = await figma.variables.getVariableCollectionByIdAsync(target.variableCollectionId);
      targetMode = tc ? tc.defaultModeId : Object.keys(target.valuesByMode)[0];
    }
    return resolveValue(target, targetMode, depth + 1);
  }
  return typeof raw === 'number' ? raw : null;
}

// Names an alias points through (nearest first), within the same collection.
// The UI uses this to let an aliased variable follow a value you're editing,
// e.g. margin → gutter.
async function aliasPath(variable, modeId) {
  var path = [];
  var v = variable;
  for (var depth = 0; depth < 10; depth++) {
    var raw = v.valuesByMode[modeId];
    if (!isAlias(raw)) break;
    var target = await figma.variables.getVariableByIdAsync(raw.id);
    if (!target || target.variableCollectionId !== variable.variableCollectionId) break;
    path.push(target.name);
    v = target;
  }
  return path;
}

async function readVar(byName, name, modeId) {
  var v = byName[name];
  if (!v) return { name: name, id: null, value: null, isAlias: false, aliasTo: null, aliasPath: [] };
  var raw = v.valuesByMode[modeId];
  var info = {
    name: name,
    id: v.id,
    value: await resolveValue(v, modeId, 0),
    isAlias: isAlias(raw),
    aliasTo: null,
    aliasPath: []
  };
  if (info.isAlias) {
    var target = await figma.variables.getVariableByIdAsync(raw.id);
    info.aliasTo = target ? target.name : null;
    info.aliasPath = await aliasPath(v, modeId);
  }
  return info;
}

async function getGridCollections() {
  var collections = await figma.variables.getLocalVariableCollectionsAsync();
  var vars = await figma.variables.getLocalVariablesAsync('FLOAT');
  var withGrid = collections.filter(function (c) {
    return vars.some(function (v) {
      return v.variableCollectionId === c.id && v.name === col12Name();
    });
  });
  return { all: collections, collections: withGrid, vars: vars };
}

// All local number variables, for the pickers in Settings. Values come from
// each collection's default mode; aliases are flagged instead of resolved.
function variableList(collections, vars) {
  var byId = {};
  collections.forEach(function (c) { byId[c.id] = c; });
  var list = [];
  vars.forEach(function (v) {
    var c = byId[v.variableCollectionId];
    if (!c) return;
    var raw = v.valuesByMode[c.defaultModeId];
    list.push({
      name: v.name,
      cid: c.id,
      cname: c.name,
      value: typeof raw === 'number' ? raw : null,
      alias: isAlias(raw)
    });
  });
  return list;
}

function indexByName(vars, collectionId) {
  var byName = {};
  vars.forEach(function (v) {
    if (v.variableCollectionId === collectionId) byName[v.name] = v;
  });
  return byName;
}

async function readMode(byName, modeId) {
  var base = {};
  for (var i = 0; i < BASE_KEYS.length; i++) {
    var key = BASE_KEYS[i];
    base[key] = await readVar(byName, baseName(key), modeId);
  }
  var cols = [];
  for (var n = 1; n <= MAX_COLS; n++) {
    var col = await readVar(byName, NAMES.colPrefix + n, modeId);
    col.n = n;
    cols.push(col);
  }
  return { base: base, cols: cols };
}

// ---------- spacers ----------

// Positive spacers are direct children of spacerPrefix (spacers/1, spacers/2 …).
// Their negative counterpart lives at negativePrefix + the same key.
function findSpacers(byName) {
  var list = [];
  Object.keys(byName).forEach(function (name) {
    if (name.indexOf(NAMES.spacerPrefix) !== 0) return;
    var key = name.slice(NAMES.spacerPrefix.length);
    if (!key || key.indexOf('/') !== -1) return;
    if (name.indexOf(NAMES.negativePrefix) === 0) return; // e.g. spacers/neg-1
    list.push({ key: key, pos: byName[name], neg: byName[NAMES.negativePrefix + key] || null });
  });
  list.sort(function (a, b) {
    var na = parseFloat(a.key), nb = parseFloat(b.key);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return list;
}

async function readSpacers(byName, modes) {
  var list = findSpacers(byName);
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var row = { key: s.key, posName: s.pos.name, negName: NAMES.negativePrefix + s.key, negId: s.neg ? s.neg.id : null, modes: {} };
    for (var m = 0; m < modes.length; m++) {
      var modeId = modes[m].modeId;
      row.modes[modeId] = {
        pos: await resolveValue(s.pos, modeId, 0),
        neg: s.neg ? await resolveValue(s.neg, modeId, 0) : null,
        negIsAlias: s.neg ? isAlias(s.neg.valuesByMode[modeId]) : false
      };
    }
    out.push(row);
  }
  return out;
}

// ---------- load ----------

// quiet: reload in the background (from Settings) without switching screens.
async function load(collectionId, modeId, quiet) {
  loadNames();
  var found = await getGridCollections();

  // Nothing to work with yet: offer to create a starter set.
  if (!found.collections.length) {
    figma.ui.postMessage({
      type: 'empty',
      names: NAMES,
      defaults: DEFAULT_NAMES,
      col12Name: col12Name(),
      collections: found.all.map(function (c) { return { id: c.id, name: c.name }; }),
      variables: variableList(found.all, found.vars),
      quiet: !!quiet
    });
    return;
  }

  var collection = found.collections.filter(function (c) { return c.id === collectionId; })[0] || found.collections[0];
  var mode = collection.modes.filter(function (m) { return m.modeId === modeId; })[0] ||
    collection.modes.filter(function (m) { return m.modeId === collection.defaultModeId; })[0];

  var byName = indexByName(found.vars, collection.id);
  var data = await readMode(byName, mode.modeId);
  var spacers = await readSpacers(byName, collection.modes);

  figma.ui.postMessage({
    type: 'data',
    names: NAMES,
    defaults: DEFAULT_NAMES,
    collections: found.collections.map(function (c) { return { id: c.id, name: c.name }; }),
    collectionId: collection.id,
    modes: collection.modes.map(function (m) { return { modeId: m.modeId, name: m.name }; }),
    modeId: mode.modeId,
    fallbackPageWidth: FALLBACK_PAGE_WIDTH,
    base: data.base,
    cols: data.cols,
    spacers: spacers,
    variables: variableList(found.all, found.vars),
    quiet: !!quiet
  });

  await figma.clientStorage.setAsync('last', { collectionId: collection.id, modeId: mode.modeId });
}

// ---------- writing ----------

// Value for a newly created col-N in a mode the user is not editing:
// calculated from that mode's own col-12, gutter and columns.
function valueForOtherMode(n, modeData, rounding) {
  var W = modeData.base.col12.value;
  var g = modeData.base.gutter.value || 0;
  var C = modeData.base.columns.value || MAX_COLS;
  if (typeof W !== 'number') return 0;
  return roundValue(spanWidth(n, W, g, C), rounding);
}

async function apply(msg) {
  var collection = await figma.variables.getVariableCollectionByIdAsync(msg.collectionId);
  if (!collection) throw new Error('The variable collection no longer exists. Reopen the plugin.');

  var vars = await figma.variables.getLocalVariablesAsync('FLOAT');
  var byName = indexByName(vars, collection.id);
  var scopes = byName[col12Name()] ? byName[col12Name()].scopes : ['WIDTH_HEIGHT', 'GAP'];

  var otherModes = {};
  var updated = 0;
  var created = 0;

  // Work from col-12 down to col-1, so new variables are created (and listed
  // in the variables panel) in that order. Grid rows without n come last.
  var items = msg.items.slice().sort(function (a, b) { return (b.n || 0) - (a.n || 0); });

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (typeof item.value !== 'number' || !isFinite(item.value)) continue;

    if (item.id) {
      var existing = await figma.variables.getVariableByIdAsync(item.id);
      if (!existing) continue;
      // Link: turn this variable into an alias (margin → gutter).
      if (item.alias) {
        var target = byName[item.alias];
        if (!target || target.id === existing.id) continue;
        existing.setValueForMode(msg.modeId, figma.variables.createVariableAlias(target));
        updated++;
        continue;
      }
      // Never replace an alias with a fixed number, unless you split it on purpose.
      if (isAlias(existing.valuesByMode[msg.modeId]) && !item.unlink) continue;
      existing.setValueForMode(msg.modeId, item.value);
      updated++;
      continue;
    }

    // Only col-N variables are created; other missing variables are skipped.
    if (!item.n || byName[item.name]) continue;
    var v = figma.variables.createVariable(item.name, collection, 'FLOAT');
    v.scopes = scopes;
    for (var m = 0; m < collection.modes.length; m++) {
      var modeId = collection.modes[m].modeId;
      if (modeId === msg.modeId) {
        v.setValueForMode(modeId, item.value);
      } else {
        if (!otherModes[modeId]) otherModes[modeId] = await readMode(byName, modeId);
        v.setValueForMode(modeId, valueForOtherMode(item.n, otherModes[modeId], msg.rounding));
      }
    }
    byName[item.name] = v;
    created++;
  }

  figma.commitUndo();

  var modeName = (collection.modes.filter(function (x) { return x.modeId === msg.modeId; })[0] || {}).name || '';
  var parts = [];
  if (updated) parts.push('updated ' + updated);
  if (created) parts.push('created ' + created);
  figma.notify(parts.length ? 'Grid Helper: ' + parts.join(', ') + ' in ' + modeName : 'Nothing to update');

  await load(collection.id, msg.modeId);
}

// Sets spacers/negative/N = −spacers/N in every mode. Creates missing negatives
// (scopes copied from the positive spacer). Aliased negative values are left alone.
async function syncNegatives(msg) {
  var collection = await figma.variables.getVariableCollectionByIdAsync(msg.collectionId);
  if (!collection) throw new Error('The variable collection no longer exists. Reopen the plugin.');

  var vars = await figma.variables.getLocalVariablesAsync('FLOAT');
  var list = findSpacers(indexByName(vars, collection.id));
  var created = 0;
  var updated = 0;
  var skipped = 0;

  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var neg = s.neg;
    var isNew = !neg;
    var changed = false;

    if (isNew) {
      neg = figma.variables.createVariable(NAMES.negativePrefix + s.key, collection, 'FLOAT');
      neg.scopes = s.pos.scopes.slice();
    }

    for (var m = 0; m < collection.modes.length; m++) {
      var modeId = collection.modes[m].modeId;
      var pos = await resolveValue(s.pos, modeId, 0);
      if (typeof pos !== 'number') continue;
      var target = negate(pos);
      if (!isNew) {
        var raw = neg.valuesByMode[modeId];
        if (isAlias(raw)) { skipped++; continue; }
        if (typeof raw === 'number' && Math.abs(raw - target) < 0.0005) continue;
      }
      neg.setValueForMode(modeId, target);
      changed = true;
    }

    if (isNew) created++;
    else if (changed) updated++;
  }

  figma.commitUndo();

  var parts = [];
  if (created) parts.push('created ' + created);
  if (updated) parts.push('updated ' + updated);
  if (skipped) parts.push('skipped ' + skipped + ' aliased value' + (skipped === 1 ? '' : 's'));
  figma.notify(parts.length ? 'Negative spacers: ' + parts.join(', ') : 'Negative spacers already in sync');

  await load(collection.id, msg.modeId);
}

// ---------- starter set ----------

var STARTER = {
  desktop: {
    pageWidth: 1920, columns: 12, col12: 1400, gutter: 32, margin: 260,
    spacers: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 72, 84, 100]
  },
  mobile: {
    pageWidth: 393, columns: 6, col12: 361, gutter: 12, margin: 16,
    spacers: [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48]
  }
};

function profileFor(modeName) {
  return /mobile|phone|small|^sm$|^xs$/i.test(modeName) ? STARTER.mobile : STARTER.desktop;
}

// Ordered list of variables in the starter set, with a value per profile.
function starterDefinitions() {
  var defs = [];
  function add(name, scopes, valueFn) { defs.push({ name: name, scopes: scopes, value: valueFn }); }
  var size = ['WIDTH_HEIGHT', 'GAP'];

  add(NAMES.pageWidth, size, function (p) { return p.pageWidth; });
  add(NAMES.columns, ['TEXT_CONTENT'], function (p) { return p.columns; });
  for (var n = MAX_COLS; n >= 1; n--) {
    (function (n) {
      add(NAMES.colPrefix + n, size, function (p) {
        return roundValue(spanWidth(n, p.col12, p.gutter, p.columns), 'floor');
      });
    })(n);
  }
  add(NAMES.gutter, size, function (p) { return p.gutter; });
  add(NAMES.gutterNegative, ['GAP'], function (p) { return negate(p.gutter); });
  add(NAMES.margin, size, function (p) { return p.margin; });
  for (var i = 1; i <= 15; i++) {
    (function (i) {
      add(NAMES.spacerPrefix + i, size, function (p) { return p.spacers[i - 1]; });
    })(i);
  }
  for (var j = 1; j <= 15; j++) {
    (function (j) {
      add(NAMES.negativePrefix + j, ['GAP'], function (p) { return negate(p.spacers[j - 1]); });
    })(j);
  }
  return defs;
}

async function createStarter(msg) {
  loadNames();
  var collection;
  var notes = [];

  if (msg.target && msg.target !== 'new') {
    collection = await figma.variables.getVariableCollectionByIdAsync(msg.target);
    if (!collection) throw new Error('That collection no longer exists. Pick another one.');
  } else {
    collection = figma.variables.createVariableCollection('Grid');
    collection.renameMode(collection.modes[0].modeId, 'Desktop');
    try {
      collection.addMode('Mobile');
    } catch (e) {
      // Plans with a single mode per collection: keep Desktop only.
      notes.push('your plan allows one mode, so only Desktop was created');
    }
  }

  var vars = await figma.variables.getLocalVariablesAsync('FLOAT');
  var byName = indexByName(vars, collection.id);
  var defs = starterDefinitions();
  var created = 0;
  var skipped = 0;

  for (var i = 0; i < defs.length; i++) {
    var def = defs[i];
    if (byName[def.name]) { skipped++; continue; }
    var v = figma.variables.createVariable(def.name, collection, 'FLOAT');
    v.scopes = def.scopes;
    for (var m = 0; m < collection.modes.length; m++) {
      var mode = collection.modes[m];
      v.setValueForMode(mode.modeId, def.value(profileFor(mode.name)));
    }
    byName[def.name] = v;
    created++;
  }

  figma.commitUndo();

  var text = 'Grid Helper: created ' + created + ' variables in “' + collection.name + '”';
  if (skipped) text += ', kept ' + skipped + ' that already existed';
  if (notes.length) text += ' (' + notes.join('; ') + ')';
  figma.notify(text, { timeout: 6000 });

  await load(collection.id, null);
}

// ---------- messages ----------

function friendly(e) {
  var text = String(e && e.message ? e.message : e);
  if (/read.?only|permission|view.?only|cannot edit/i.test(text)) {
    return 'This file is view-only for you, so Grid Helper can’t change its variables.';
  }
  return 'Something went wrong: ' + text;
}

figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === 'ready') {
      // UI has loaded: open on the last used collection and mode.
      var last = await figma.clientStorage.getAsync('last');
      await load(last && last.collectionId, last && last.modeId);
    }
    else if (msg.type === 'load') await load(msg.collectionId, msg.modeId, msg.quiet);
    else if (msg.type === 'apply') await apply(msg);
    else if (msg.type === 'syncNegatives') await syncNegatives(msg);
    else if (msg.type === 'createStarter') await createStarter(msg);
    else if (msg.type === 'saveNames') {
      saveNames(msg.names);
      figma.notify('Grid Helper: settings saved in this file');
      await load(msg.collectionId, msg.modeId);
    }
    else if (msg.type === 'close') figma.closePlugin();
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: friendly(e) });
  }
};
