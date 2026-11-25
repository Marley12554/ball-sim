# Blocks

## Connectors

An event carries some of: **self**, **other**, **point**, **tether**. A trigger's output connector shows what it gives, and an action or filter's input connector shows what it needs. A wire only connects when the source gives everything the target needs. Options inside a block that need more than the wire gives are disabled.

| shape | gives / needs |
|---|---|
| circle | nothing |
| square | self |
| diamond | self + point |
| triangle | self + other + point |
| star | self + other + point + tether |

Object blocks wire into triggers through the round object port.

## Objects

| block | notes |
|---|---|
| Balls | count, look, size, density, bounciness, drag, gravity scale, HP, hit other balls, placement (point, scatter, circle, line, grid), launch direction and speed |
| Rings | count, radius, spacing, thickness, gaps (count, width, placement), spin and spin pattern, color |
| Wall | box, line or arc, with motion (still, spin, swing, slide) |
| Spiral | inner radius, spacing, turns, spin |
| Zone | circle or box area that only detects |
| Counter | named number, optionally shown on screen |

## Triggers

Every trigger also has **Cooldown** (per object) and **Max fires** (per object, 0 = no limit).

| block | gives | params |
|---|---|---|
| Start | nothing | |
| Every | self + point with objects, else nothing | interval |
| After | self + point with objects, else nothing | time |
| Bounce | self, other (wall), point | which wall |
| Touch | self, other (ball), point | with which balls |
| Cross tether | + tether | |
| Lose tether | self + point | |
| Leave | self, other (ring or zone), point | which ring or zone |
| Enter | self, other (ring or zone), point | which ring or zone |
| Value reaches | self + point | speed, size, HP, tethers, age; above/below |
| Counter reaches | nothing | counter, above/below |
| Count reaches | self + point (first remaining member) | group, at most/at least |
| Spawned | self + point | |
| Destroyed | self + point | |

## Filters

| block | params |
|---|---|
| Chance | percent |
| Only if | self/other value (or impact speed) above/below |
| Only if other | other group / same group / in / not in |
| Every Nth | N |

## Actions

Most actions take a target: **self**, **other** or **a whole group**.

| block | params |
|---|---|
| Change | property (speed, size, HP, bounciness, mass, gravity, drag, spin), add/multiply/set, amount, optional limit. Target can also be *future spawns* of a group |
| Push | forward, away from / toward the hit, to center, random, angle; strength |
| Explode | at the event point, center or a position; radius, strength |
| Duplicate | copies, spread |
| Spawn | group, count, at its placement / self / event point / center |
| Destroy | target |
| Attach tether | to the hit point (sticks to the wall), other ball or center; pull, damping, rest length, max length, max per ball |
| Cut tether | the crossed one, oldest, newest or all |
| Move to group | target, group |
| Change look | target, look or look preset |
| Counter | add/multiply/set |
| Set gravity | direction or to center, strength |
| End | outcome label. `{self}` and `{time}` are filled in |

## Presets

All built from the blocks above, with no special code: Ring Escape, Tether Battle, Doubling Jaw, Spiral Drop, Arena, Growth, Split.
