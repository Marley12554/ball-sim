# Ball Sim

A sandbox for building, watching and sharing physics simulations. Every simulation, presets included, is made from blocks: objects, triggers, filters and actions wired together in an editor.

**Live:** https://marley12554.github.io/ball-sim/

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # outputs dist/
```

`/dev.html` on the dev server renders a single preset without UI (`?p=spiral-drop&speed=4&skip=30`).

## Layout

- `engine/` deterministic 2D physics and a generic rule graph. No game code. See `engine/README.md`.
- `games/ball-sim/src/sim/` the simulation runtime, blocks, looks and presets.
- `games/ball-sim/src/render/` canvas renderer and sprite cache.
- `games/ball-sim/src/ui/` gallery, sim view and editor.
- `docs/` brief and block reference.

## Adding a block

Add an object to the right file in `games/ball-sim/src/sim/blocks/` and list it in that file's export array. The block carries its params, connector shape and behavior. The editor, inspector and runtime pick it up automatically.

Flags are from [flag-icons](https://github.com/lipis/flag-icons) (MIT).
