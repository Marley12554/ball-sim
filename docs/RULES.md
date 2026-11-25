# Block list (draft for review)

## Connector shapes

An event carries some of three things: **self** (the object the rule is on), **other** (the second object involved) and **point** (where it happened). The connector shape shows which. An action fits a trigger only if the trigger provides everything the action needs. Filters pass the shape through unchanged.

## Objects

| block | notes |
|---|---|
| Ball | radius, mass, bounciness, gravity scale, look, group |
| Ring | radius, thickness, gaps (position, width), rotation speed |
| Track | spiral or freeform path, thickness |
| Wall | line or box outline |
| Zone | invisible area (circle or box) that only detects |
| Counter | a named number for the whole sim |

Every object belongs to a group. Rules attach to groups, so "all red balls" is one rule, not fifty.

## Triggers

| block | provides | params |
|---|---|---|
| Start | none | |
| Every | self (or none) | interval |
| After | none | time |
| Bounce | self, other (wall), point | min impact speed |
| Touch | self, other (ball), point | which group |
| Cross tether | self, other (tether owner), point | |
| Lose tether | self | |
| Leave | self, other (ring or zone), point | |
| Enter | self, other (zone), point | |
| Value reaches | self | property (speed, size, HP, tether count...), above/below, threshold |
| Counter reaches | none | counter, above/below, threshold |
| Group count reaches | none | group, above/below, threshold |
| Spawned | self | |
| Destroyed | self, point | |

## Filters

| block | params |
|---|---|
| Chance | percent |
| Only if | property compare on self or other |
| Only if other is | same group / different group / specific group |
| Every Nth time | N |

Every rule also has cooldown and max fires as settings, not separate blocks.

## Actions

| block | needs | params |
|---|---|---|
| Change property | self or other | property, add/multiply/set, amount, min/max clamp |
| Push | self or other | direction (along hit normal, away from point, toward point, random, fixed), strength |
| Explode | point | radius, strength, falloff |
| Duplicate | self or other | count, spread, keep velocity |
| Spawn | point or self (or random in zone) | object template, count |
| Destroy | self or other | |
| Attach tether | self, plus point or other | stiffness, rest length, max length |
| Cut tether | self, or other (crossed tether) | which: crossed / oldest / all |
| Change group | self or other | group |
| Change look | self or other | look or look preset |
| Change rotation | other (ring) | add/multiply/set |
| Counter | none | counter, add/set, amount |
| Set gravity | none | direction, strength |
| End simulation | none | outcome label |

## Presets as blocks

- **Ring escape**: Ball · Bounce → Change property (speed, x1.05). Ball · Leave (ring) → Destroy other. After 60s → End "Time up". Group count reaches 0 (rings) → End "Escaped".
- **Tether battle**: Ball · Bounce → Attach tether (point). Ball · Cross tether → Only if other is (different group) → Cut tether (crossed). Ball · Value reaches (tether count below 1) → Destroy self. Group count reaches 1 (balls) → End "Last ball".
- **Doubling jaw**: Ball · Touch (jaw) → Duplicate self. Group count reaches 2000 → Destroy (ring) + Explode.
- **Spiral drop**: Ball · Value reaches (speed below X) → Destroy self + Spawn (launch point) + Counter. Ball · Enter (center zone) → End.

## Open question

The jaw needs moving walls. A "Motion" setting on rings and walls (rotate, oscillate, open/close) covers it without a new trigger or action.
