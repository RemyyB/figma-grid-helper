# Grid Columns

Calculates `grid/col/col-1` … `col-12` from col-12, gutter and columns, and writes the result to one variable mode at a time.

## Install

Figma desktop → Plugins → Development → Import plugin from manifest… → pick `manifest.json` in this folder.

## Use

1. Pick the mode (Desktop / Mobile). Inputs load from that mode's variables.
2. Change col-12, gutter, columns or page width to experiment. The table shows current vs new.
3. Tick the rows you want written and hit Update. Only the selected mode changes. Cmd+Z undoes the whole batch.

## Formula

```
column    = (col-12 − (columns − 1) × gutter) / columns
col-N     = N × column + (N − 1) × gutter      (N ≥ columns → col-12)
margin    = (page width − col-12) / 2
gutter-negative = −gutter
```

Rounding: Floor (default; stacked spans never exceed col-12), Round (nearest px) or Off (2 decimals).

## Notes

- Missing col-N variables (Desktop had no col-10 / col-11) are created. The mode you're editing gets the value from the table; other modes get a value calculated from their own col-12, gutter and columns. New variables copy col-12's scopes and are created from col-12 down to col-1. Figma's plugin API can't move existing variables, so a new col-N is added at the end of the group; drag it into place once in the variables panel if the set already exists.
- Aliased variables are never overwritten. They show `→ target` and follow their alias: if margin is an alias of gutter, changing gutter changes margin in the preview too.
- When margin is aliased in a mode, it drives the container instead: `col-12 = page width − 2 × margin`. The col-12 field is then locked (`auto`).
- An aliased col-12, gutter or columns locks its input; change the variable it points to instead.
- Variable names live in `CONFIG` at the top of `code.js`.
