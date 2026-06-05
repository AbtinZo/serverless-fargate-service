# Generic engine; MCP support is a preset, not plugin code

The plugin is a **general-purpose** engine for deploying long-running container web
services to ECS Fargate behind an ALB. Support for any specific workload — including
the MCP server that motivated it — ships as a **documented preset/example**
(`examples/mcp/`) and a test fixture, never as workload-aware branching inside the
plugin.

We chose this because nothing an MCP server needs from the _infrastructure_ is
MCP-specific: SSE is just a long ALB `idle_timeout`, OAuth/Cognito is just an IAM
statement + secrets, and `/sse`/`/health` are app-level concerns the plugin only sees
as a health-check path. Baking MCP concepts into the code would add coupling for zero
capability gain and would narrow the plugin's audience.

## Considered Options

- **MCP-first tool that happens to be reusable** — rejected: more opinionated, less
  publishable, and would carry workload-specific logic the infra layer doesn't need.
- **Generic engine + preset** _(chosen)_ — the engine stays domain-agnostic; MCP is its
  flagship example, proving the engine against a real, demanding workload.

## Consequences

- No `if (mcp)` anywhere; the canonical unit is a `Service` (see CONTEXT.md), and "MCP
  server" is one instance of it.
- The MCP preset must be kept working as the flagship fixture, so the generic engine is
  continuously validated against the production use case.
- Future workloads (other SSE servers, internal APIs, webhook receivers) are first-class
  with no plugin changes — only new presets/examples.
