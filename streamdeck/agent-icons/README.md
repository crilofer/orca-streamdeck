# Agent logos

PNG favicons of the coding agents Orca can run, copied from Orca's `src/shared/agent-icons/`
(MIT) so the deck shows the same mark Orca does. Agents whose mark Orca draws as an SVG (Claude,
Codex, Droid, OpenCode, Copilot, Aider, Pi, Kilo) live as paths in `src/agent-logos.ts` instead.

Each logo is its owner's trademark, used only to say which agent runs in a terminal.

After adding or replacing a file: `pnpm icons:agents` rewrites `src/agent-logo-bitmaps.ts`.
