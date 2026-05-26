# map-test-dots

Test sprite sheet containing a single SDF dot icon, for binding city/town/village/capital labels to their dots in the borbalo map style.

## Sprite URL

```
https://raw.githubusercontent.com/kobajgenti/map-test-dots/main/dots
```

Add to a style's `sprite` array:

```json
{ "id": "dots", "url": "https://raw.githubusercontent.com/kobajgenti/map-test-dots/main/dots" }
```

Then reference the icon as `dots:dot` in symbol layers (e.g. `"icon-image": "dots:dot"`).

## Contents

- `dots.png` — 24×24 white filled circle on transparent (1×)
- `dots@2x.png` — 48×48 white filled circle on transparent (retina, 2×)
- `dots.json` / `dots@2x.json` — sprite manifests with `"sdf": true`

The icon is SDF, so `icon-color` controls its color and `icon-halo-color` / `icon-halo-width` can add a halo ring.
