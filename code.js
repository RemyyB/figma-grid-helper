// Grid Columns
// Grid tab: reads the grid variables for one mode, lets the UI calculate
// col-1 … col-12, and writes the chosen values back to that mode only.
// Spacers tab: mirrors spacers/N into spacers/negative/N for every mode.

// Variable names. Change these if your naming differs.
var CONFIG = {
  col12: 'grid/col/col-12',
  columns: 'grid/col/columns',
  gutter: 'grid/gutter',
  gutterNegative: 'grid/gutter-negative',
  margin: 'grid/margin/margin',
  pageWidth: 'grid/page/width',
  colPrefix: 'grid/col/col-',
  maxCols: 12,
  fallbackPageWidth: 1920,
  spacerPrefix: 'spacers/',           // spacers/1 … spacers/15
  negativePrefix: 'spacers/negative/' // spacers/negative/1 …
};

var BASE_KEYS = ['col12', 'columns', 'gutter', 'gutterNegative', 'margin', 'pageWidth'];

figma.showUI(__html__, { width: 380, height: 720, themeColors: true });

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
// e.g. margin → grid/gutter.
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
      return v.variableCollectionId === c.id && v.name === CONFIG.col12;
    });
  });
  return { collections: withGrid, vars: vars };
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
    base[key] = await readVar(byName, CONFIG[key], modeId);
  }
  var cols = [];
  for (var n = 1; n <= CONFIG.maxCols; n++) {
    var col = await readVar(byName, CONFIG.colPrefix + n, modeId);
    col.n = n;
    cols.push(col);
  }
  return { base: base, cols: cols };
}

// ---------- spacers ----------

function negate(v) {
  return v === 0 ? 0 : -v;
}

// Positive spacers are direct children of spacerPrefix (spacers/1, spacers/2 …).
// Their negative counterpart lives at negativePrefix + the same key.
function findSpacers(byName) {
  var list = [];
  Object.keys(byName).forEach(function (name) {
    if (name.indexOf(CONFIG.spacerPrefix) !== 0) return;
    var key = name.slice(CONFIG.spacerPrefix.length);
    if (!key || key.indexOf('/') !== -1) return;
    list.push({ key: key, pos: byName[name], neg: byName[CONFIG.negativePrefix + key] || null });
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
    var row = { key: s.key, posName: s.pos.name, negName: CONFIG.negativePrefix + s.key, negId: s.neg ? s.neg.id : null, modes: {} };
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

async function load(collectionId, modeId) {
  var found = await getGridCollections();
  if (!found.collections.length) {
    figma.ui.postMessage({
      type: 'error',
      message: 'No local variable named "' + CONFIG.col12 + '" found in this file.'
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
    collections: found.collections.map(function (c) { return { id: c.id, name: c.name }; }),
    collectionId: collection.id,
    modes: collection.modes.map(function (m) { return { modeId: m.modeId, name: m.name }; }),
    modeId: mode.modeId,
    fallbackPageWidth: CONFIG.fallbackPageWidth,
    base: data.base,
    cols: data.cols,
    spacers: spacers
  });

  await figma.clientStorage.setAsync('last', { collectionId: collection.id, modeId: mode.modeId });
}

// ---------- writing ----------

// Value for a newly created col-N in a mode the user is not editing:
// calculated from that mode's own col-12, gutter and columns.
function valueForOtherMode(n, modeData, rounding) {
  var W = modeData.base.col12.value;
  var g = modeData.base.gutter.value || 0;
  var C = modeData.base.columns.value || CONFIG.maxCols;
  if (typeof W !== 'number') return 0;
  return roundValue(spanWidth(n, W, g, C), rounding);
}

async function apply(msg) {
  var collection = await figma.variables.getVariableCollectionByIdAsync(msg.collectionId);
  if (!collection) throw new Error('Collection not found.');

  var vars = await figma.variables.getLocalVariablesAsync('FLOAT');
  var byName = indexByName(vars, collection.id);
  var scopes = byName[CONFIG.col12] ? byName[CONFIG.col12].scopes : ['WIDTH_HEIGHT', 'GAP'];

  var otherModes = {};
  var updated = 0;
  var created = 0;

  for (var i = 0; i < msg.items.length; i++) {
    var item = msg.items[i];
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
  figma.notify(parts.length ? 'Grid Columns: ' + parts.join(', ') + ' in ' + modeName : 'Nothing to update');

  await load(collection.id, msg.modeId);
}

// Sets spacers/negative/N = −spacers/N in every mode. Creates missing negatives
// (scopes copied from the positive spacer). Aliased negative values are left alone.
async function syncNegatives(msg) {
  var collection = await figma.variables.getVariableCollectionByIdAsync(msg.collectionId);
  if (!collection) throw new Error('Collection not found.');

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
      neg = figma.variables.createVariable(CONFIG.negativePrefix + s.key, collection, 'FLOAT');
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

// ---------- messages ----------

figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === 'ready') {
      // UI has loaded: open on the last used collection and mode.
      var last = await figma.clientStorage.getAsync('last');
      await load(last && last.collectionId, last && last.modeId);
    }
    else if (msg.type === 'load') await load(msg.collectionId, msg.modeId);
    else if (msg.type === 'apply') await apply(msg);
    else if (msg.type === 'syncNegatives') await syncNegatives(msg);
    else if (msg.type === 'close') figma.closePlugin();
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String(e && e.message ? e.message : e) });
  }
};
