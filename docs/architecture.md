# Architecture Boundaries

This project is organized to support web-first development now and desktop packaging later.

## Layers

- `src/core`: game logic and services with no UI or platform coupling.
- `src/adapters`: platform-specific implementations (web now, desktop later).
- `src/ui`: rendering and interaction logic.
- `src/app`: composition and app startup wiring.
- `src/shared`: shared constants/utilities that are safe across layers.

## Rules

- `core` must not import from `ui` or `adapters`.
- `ui` should talk to `core` through services, not direct storage or platform code.
- `adapters` implement infrastructure details (storage, logging sinks, clocks, files).
- Add new game features by updating `core` first, then wiring through `app` and `ui`.
