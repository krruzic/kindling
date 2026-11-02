# Integration notes

What building [`examples/brawl`](../examples/brawl) (one small game through every package) found in the packages,
and what was changed. Each fix has a test in its package.

## @kindling/net

- **A core `Sim` didn't plug into lockstep.** `@kindling/core` sims expose named section hashes
  (`sections(): { total, sections: Record<string, number> }`), but `LockstepSim` only took a positional
  `sectionHashes(): number[]`, so every game needed an adapter and had to repeat the section names in the host's
  `sections` option. `LockstepSim` now also accepts `sections()`; the host derives the section names from the sim
  when the option is absent and sends them to guests. New helpers `hashRow(sim, names)` and `sectionNamesOf(sim)`.
  Test: "a core-style sim (named sections(), no sectionHashes) is hashed and desyncs are named".
