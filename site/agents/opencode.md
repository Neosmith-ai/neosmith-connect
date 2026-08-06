# OpenCode + NeoSmith — research spike (T12)

> **Status:** research spike only — no `lib/harnesses/opencode.js` is implemented
> in this branch. This page is the deliverable for ticket T12 of the build brief:
> "a short writeup of OpenCode's actual config surface, with enough detail to
> write the harness module without further discovery."

## Summary

OpenCode is **file-writable**. Configuration lives in a JSON (or JSONC) file
with a `provider` block that supports `apiKey` and `baseURL` per provider —
exactly the shape the existing CLI harnesses (`claude.js`, `codex.js`,
`continue.js`) already target. A future `opencode.js` harness module can be
written without further discovery.

## Config locations (precedence low → high)

1. Remote config (`.well-known/opencode`)
2. **Global config**: `~/.config/opencode/opencode.json` (or `.jsonc`)
3. Custom config: `OPENCODE_CONFIG` env var pointing at any file
4. **Project config**: `opencode.json` in the project root (nearest git
   directory, traversing upward)
5. `.opencode` directories
6. Inline config: `OPENCODE_CONFIG_CONTENT` env var
7. Managed settings (admin-controlled)

Configs are **merged**, not replaced — non-conflicting keys from all sources
are preserved. This is the same merge-never-clobber invariant the CLI's
snapshot/restore model already enforces, so an `opencode.js` harness can
follow the `claude.js` pattern: snapshot the global config before adding a
NeoSmith provider entry, restore byte-for-byte on `off`.

## Provider block shape

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "neosmith/neosmith.intelligent-pro",
  "small_model": "neosmith/neosmith.intelligent-lite",
  "provider": {
    "neosmith": {
      "models": {},
      "options": {
        "apiKey": "{env:NEOSMITH_API_KEY}",
        "baseURL": "https://router.neosmith.ai/v1",
        "timeout": 600000,
        "chunkTimeout": 30000
      }
    }
  }
}
```

Key fields:
- `provider.<id>.options.apiKey` — accepts a literal or `{env:VAR}` /
  `{file:path}` substitution. The CLI's existing `keyMode` enum gets a new
  value: `"env-substitution"` (OpenCode reads the key from the env var named
  in the `{env:…}` reference, not from the file).
- `provider.<id>.options.baseURL` — the OpenAI-compatible base URL. For
  NeoSmith this is `https://router.neosmith.ai/v1`.
- `model` / `small_model` — top-level model selectors. Format is
  `<provider-id>/<model-id>`, so with `provider: { neosmith: … }` the
  selector becomes `neosmith/neosmith.intelligent-pro`.

## Harness module design (for the future implementer)

A `lib/harnesses/opencode.js` module would:

1. **`configFile`** = `~/.config/opencode/opencode.json` (global). Per-OS path
   resolution: `~/.config/opencode/opencode.json` on Linux, the equivalent
   `~/Library/Application Support/opencode/opencode.json` on macOS,
   `%APPDATA%\opencode\opencode.json` on Windows.
2. **`writable: true`**, `wire: "openai-completions"`,
   `keyMode: "env-substitution"`.
3. **`on(ctx)`**: read existing config (or `{}`), check `hasNeoSmith` (does
   any `provider.<id>.options.baseURL` include `router.neosmith.ai`?),
   `io.snapshot("opencode", CONFIG)`, merge in a `provider.neosmith` block
   with `baseURL` and `apiKey: "{env:NEOSMITH_API_KEY}"`, set top-level
   `model: "neosmith/neosmith.intelligent-pro"` and `small_model:
   "neosmith/neosmith.intelligent-lite"`, `io.writeJSON`.
4. **`off(ctx)`**: `io.restoreSnapshot("opencode", CONFIG)` with the same
   fallback-strip pattern as `claude.js`/`codex.js` if no snapshot exists.
5. **`status(ctx)`**: read config; on if `provider.neosmith.options.baseURL`
   includes `router.neosmith.ai`; detail reports the `model` selector.

The `keyMode: "env-substitution"` path is the one new piece — the CLI's
existing `env-key-ref` (used by codex) is close but not identical: codex
bakes `env_key = "OPENAI_API_KEY"` into its TOML and prints `export
OPENAI_API_KEY=…` for the shell profile. OpenCode uses JSONC `{env:VAR}`
substitution and reads the env var at runtime. The harness's `on()` should
print the equivalent `export NEOSMITH_API_KEY=…` line and store the literal
in `~/.neosmith/config.json` as today (so `neosmith verify` / `doctor` work).

## Open questions for the implementer

- Should the harness also write a project-level `opencode.json` in the
  current working directory, or only the global config? The brief's T6
  `neosmith setup` detects installed tools by their global config paths, so
  global-only is the consistent choice. Project-level is the user's
  responsibility.
- Does OpenCode's TUI `/connect` command write to the same global config,
  or to a separate keychain? If a separate keychain, a CLI `on()` that
  writes `apiKey` to the JSON file may be overridden by the TUI's keychain
  entry. Verify against a real OpenCode install before shipping.

## Sources

- [OpenCode docs — config](https://opencode.ai/docs/config)
- [OpenCode docs — overview](https://opencode.ai/docs)
