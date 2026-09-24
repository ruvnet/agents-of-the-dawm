# Agents of the Dawm

Planning repository for **Agents of the Dawm: Floodline**, an original browser action game about repairing a coastal flood network and rescuing a stranded tram. The current deliverable is a design proposal. There is no game implementation or deployed Site in this repository.

## Read the proposal

1. [SPARC delivery plan](docs/plan/sparc-delivery-plan.md) maps requirements to phase gates and evidence.
2. [Vertical slice script](docs/creative/vertical-slice-script.md) specifies the 12 to 15 minute player experience.
3. [Swarm runbook](docs/plan/swarm-runbook.md) assigns Ruflo and platform agents to future implementation work.

## Architecture decisions

| Decision | Subject |
| --- | --- |
| [ADR 0001](docs/adr/0001-original-scope-and-ip.md) | Original game scope, rights, and release boundary |
| [ADR 0002](docs/adr/0002-browser-rendering-and-performance.md) | Renderer, Tidewater reference, asset budgets, and browser support |
| [ADR 0003](docs/adr/0003-worldgraph-wasm-and-ruv-integrations.md) | WorldGraph and optional RuV WASM integration |
| [ADR 0004](docs/adr/0004-gravity-simulation-and-rescue-contract.md) | Gravity simulation, combat, and rescue state |
| [ADR 0005](docs/adr/0005-ruflo-sparc-governance.md) | SPARC gates and swarm governance |

All ADRs are **Proposed** until their assumptions are validated in a playable prototype. Estimates and performance budgets are targets, not measurements. The repository currently has no project license. No Remedy assets or characters, Tidewater assets, or Tidewater code are included.
