# Ball Sim Sandbox: brief

Source of truth for scope and decisions until the user says otherwise.

## What this is

A passive physics simulation sandbox. Not a game: no player skill, no levels, no score. People build simulations out of blocks, watch them run and share them. Inspired by ball-sim videos (ring escape, spiral drop, doubling chaos, arena fights, string/tether battles), but the examples are just examples. The rule set must be general enough to build things nobody listed.

## Core design: objects + triggers + actions

No scripting language. Every sim, presets included, is built from blocks: objects, triggers, filters and actions. Each preset must be buildable from blocks alone. If one needs special code, fix the blocks.

Block design rules:

- One block per distinct idea. Amounts, properties and targets are parameters, not separate blocks ("Change property" covers speed, size, mass and so on with add/multiply/set).
- No two blocks should do the same or nearly the same thing.
- Blocks that can't work together physically don't connect. Connector shapes encode what an event knows (self, other, point), and an action's connector only fits triggers that provide what it needs. Combos that are legal but cancel out get a warning, not a block.
- Adding a new block should mean adding one file to a registry. More rules will be added over time.

Block reference: `docs/RULES.md`.

## Required examples

- Ring escape: nested rings with gaps, the ball changes on each bounce, escaping destroys that ring, timer ends it.
- Spiral drop, doubling jaw, arena fights.
- Tether battles: each bounce attaches a string from the ball to the wall at the contact point. Strings pull. Balls cut each other's strings by crossing them. A ball with no strings left disappears.

## Technical decisions

- Web: TypeScript, Vite, Canvas 2D (WebGL later if needed), Vitest. GitHub Pages.
- Custom physics. Circles vs circles, arcs with gaps, segments. Tethers are an engine feature.
- Deterministic across browsers: fixed timestep, seeded RNG, no `Math.sin/cos/atan2/...` in the sim step (own implementations in `engine/src/dmath.ts`).
- Thousands of objects: flat typed arrays, spatial hash, per-body substepping against walls.
- Guards: object cap, tether cap, contact cap, max trigger firings per frame, adaptive slowdown (fewer steps per frame, never a different step size).
- Repo: engine in `/engine`, this project in `/games/ball-sim`, shooter later in `/games/shooter`. Keep `engine/README.md` current in the same commit as any engine change.

## Ball appearance

- Solid colors, gradients, patterns, country flags (large set), user-uploaded images.
- Appearance presets so nobody picks every ball by hand: fully random, countries only, palette-based, and so on. Random looks use the sim's seeded RNG, so replays look identical.
- Implementation: each look is pre-drawn once to an offscreen sprite and stamped, so it stays fast at thousands of balls.

## Visual direction

Dark, clean, modern, refined. Techno, but not neon or noisy. Shares a general theme with Circuit Jam (blocks wired into a circuit) but is its own thing. Do not copy or reference Circuit Jam or Color Lab code or UI.

- Palette: ground `#0A0B0D`, panels `#121418`, hairlines `#23272E`, text `#E7E9EC`, secondary `#868D98`, accent signal orange `#FF5A1F`. Color mostly comes from the sims.
- Type: Geist for UI, Geist Mono for numbers you can scrub.
- Home: gallery of live looping sim previews with title, object count, rule count, seed.
- Sim view: full-bleed canvas, minimal overlay controls that fade when idle.
- Editor: node canvas. Blocks placed on a grid, wired together by typed connectors like a circuit. Precise, clean, values you can scrub.
- Wording: "simulations", never "levels" or "games". No win screens or reward pop-ups. Endings are a calm outcome label.

## Writing in the UI

- Almost none. No instructional captions explaining a drag-and-drop canvas.
- When text is needed (a toast, a label), write it like a person would: short, plain sentences. No semicolon chains, no choppy robotic phrasing.

## Round 2 decisions (user feedback)

- Fun to watch, not a lab tool: color everywhere (palette gradients, glow), neutral graphite background with drifting light, grain and light pulses, particles, sound on everything.
- Watch = a fresh random sim of that mode every time. Short codes (`RE2-4F9K2` = mode, variant, seed) rebuild an exact sim. Long codes/links for custom sims.
- Downward gravity in every mode except Arena (top-down). Radial gravity only as an editor option. All containers are circles except Arena.
- Balls hold still in their starting pose for about 1.5 s before anything moves.
- Entering a sim is a transition: the card expands to fill the screen with a bloom and grid sweep.
- Modes: Ring Escape (Classic, Gauntlet 1,000 rings, Gauntlet 10K), Leak, Doubling Sledge, Spiral Drop, Mitosis, Arena (Duel, Free-for-all, Teams, Boss, Weapons Duel, Weapons Brawl), Tether Battle, Growth.
- Arena: squares, HP 10, both take 1 on contact, powerups (red +1 damage 2 s, green heal 1, cyan shield 1, magenta teleport), stackable, spawning every 5 to 10 s. Health cards on the sides. Sudden death after a minute (fighters grow and speed up).
- Weapons: sword, spear, sledgehammer, match (burn + ground flames), lightning rod, shield. Each grows stronger with hits.
- Ring Gauntlet: hundreds of thin rings spinning together, gaps aligned into one rotating tunnel, no gravity, fixed camera, rings-left score in the center. The ball breaks out through the tunnel (passed rings turn to powder), the tunnel wall knocks it back, and the remaining rings snap back so the innermost is at the starting radius, then stop.
- The sim view keeps the action clear of the top bar and the control bar.
- No music yet.

## Round 3 decisions (user feedback)

- Presets are not random. Clicking a gallery card zooms its preview into a stage with a sidebar: variant list (Classic is the default), ball look chips, a weapon guide for weapon variants, Watch and Edit a copy. Gallery cards loop the default variant.
- Short codes can carry a look letter: `AR5-4F9K2-C` (C colors, G gradients, P patterns, S spectrum, T countries, R anything).
- Editing is easy to find: a labeled Edit chip in the sim view, Edit a copy in the panel, and copies open with the balls block selected so colors are right there.
- Rings burst only after about 3 s of being packed solid. Balls may squeeze and overlap a little under pressure.
- Doubling Sledge: a crushed ball comes out of the far face of the head that hit it, as if it clipped through. Nothing hides or fades.
- Spiral Drop: the channel is barely wider than a ball so balls slide. One more ball each round, a bit faster.
- Ring Gauntlet: the tunnel is a wedge (constant angle), calmer colors, the score fits inside the innermost ring. Slower spin (about 60°/s). The ball ricochets around the hole: every wall touch counts as a bounce and kicks it back across the circle, so it never slides along a ring. Closing rings keep their distance from the ball. The camera stays centered and pulls back when the ball breaks far out.
- Arena: speed stays constant (no drift from bounces). Sudden death only grows the fighters. Every weapon has a special move charged by five hits, explained in the panel. The boss is the Twemoji smiling imp.

## Build order

1. Physics core. **Done.**
2. Rule system: block registry, typed connectors, cooldowns, guards. **Done.**
3. Ring escape preset from blocks only. **Done.**
4. Spiral drop, doubling jaw, tether battle presets. **Done.**
5. Editor UI (phone-usable), save/load JSON. **Done** (autosave to the browser, export/import files).
6. Arena mode: HP, abilities as blocks with cooldowns. **Done.** Non-rotating squares are not built yet: all bodies are circles.
7. Sharing (link with the sim compressed into it) and recording clips (WebM/MP4). **Done.**

## Future: gate shooter

Reuses the engine (grid, many entities, trigger/action system). Keep engine separate from sim code, but no multi-game framework yet.
