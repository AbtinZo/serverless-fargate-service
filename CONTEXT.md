# serverless-fargate-service

A general-purpose Serverless Framework (v4) plugin for deploying long-running container
web services to AWS ECS Fargate behind a fully-tunable Application Load Balancer.
Named to contrast with `serverless-fargate-tasks` (one-off tasks) — this deploys
long-running `Service`s fronted by an ALB.
The engine is domain-agnostic; specific workloads (e.g. an MCP server) are supported
through documented presets, not plugin code.

## Language

**Service**:
A long-running container deployed to ECS Fargate behind an ALB and reachable over
HTTPS. The single unit the plugin deploys.
_Avoid_: app, task, MCP server, container (use these for narrower meanings below).

**Preset**:
A documented, copy-pasteable block of `Service` configuration tuned for a specific
workload (e.g. the MCP preset: long idle timeout, `/health` check, secret wiring).
Ships as an example/recipe, never as branching logic inside the plugin.
_Avoid_: template, recipe, profile.

**MCP server**:
One concrete workload the plugin can deploy via the MCP `Preset`. It is an instance
of `Service`, not a first-class plugin concept.
_Avoid_: using "MCP server" to mean the plugin's general capability.

**Execution role**:
The IAM role ECS uses to _start_ a `Service`'s task — pull the image, read injected
secrets, write logs. The plugin fully owns and manages it; the user never declares it
directly (they declare secrets, and the plugin grants the reads).
_Avoid_: task role, service role.

**Task role**:
The IAM role the running application _code_ assumes at runtime to call other AWS APIs.
The user declares its statements; the plugin grants nothing here by default
(least-privilege; opt-in inheritance of provider statements).
_Avoid_: execution role, app role.
