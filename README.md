# serverless-fargate-service

Deploy **long-running container web services** to AWS ECS Fargate **behind a fully-tunable Application Load Balancer** — ACM, HTTPS, Route 53, Secrets Manager, health checks, and SSE-friendly idle timeouts — all defined in one `serverless.yml`.

Named to contrast with [`serverless-fargate-tasks`](https://www.serverless.com/plugins/serverless-fargate-tasks) (one-off tasks): this deploys **services** that stay up and serve HTTP.

> Status: **v0.1 / pre-release.** Greenfield deploys only (no resource import). Serverless Framework **v4**.

## Why this exists

| Capability                                           | `serverless-fargate` | `serverless-fargate-tasks` | Serverless Container FW | **this**                      |
| ---------------------------------------------------- | -------------------- | -------------------------- | ----------------------- | ----------------------------- |
| ECS service / task / cluster                         | ✅                   | ✅                         | ✅                      | ✅                            |
| ALB you control (idle_timeout, TLS policy, TG attrs) | ❌                   | ❌                         | ❌ abstracted           | ✅                            |
| ACM DNS-validated cert + Route 53 alias              | ❌                   | ❌                         | auto only               | ✅ both (auto **or** BYO ARN) |
| Secrets Manager / SSM → container secrets            | ❌                   | ❌                         | ✅                      | ✅                            |
| Raw-CloudFormation escape hatch per resource         | container only       | ❌                         | ❌                      | ✅                            |
| No license gate (MIT)                                | ✅                   | ✅                         | ❌                      | ✅                            |

The motivating use case: a remote **MCP server** (Server-Sent Events) that needs a long ALB idle timeout, secrets wiring, and a custom HTTPS domain — none of which the existing plugins expose. See [`examples/mcp/`](examples/mcp/serverless.yml) for a minimal real-world config, or [`examples/reference/`](examples/reference/serverless.yml) for an annotated example exercising every field.

## Install

```bash
npm install --save-dev serverless-fargate-service
```

```yaml
plugins:
  - serverless-fargate-service
```

## Quick start

```yaml
fargate:
  services:
    api:
      cpu: 512
      memory: 1024
      vpc: { id: vpc-xxxx, subnets: [subnet-a, subnet-b] }
      image: { context: ., dockerfile: Dockerfile }
      container:
        port: 8000
        secrets: { DB_URL: arn:aws:secretsmanager:...:secret:db-AbC }
      loadBalancer:
        subnets: [subnet-a, subnet-b]
        listeners:
          - { port: 80, protocol: HTTP, redirectToHttps: true }
          - { port: 443, protocol: HTTPS }
      domain: { name: api.example.com, hostedZoneId: ZXXXX }
```

`serverless deploy` builds the image, ensures the ECR repo, pushes a sha-tagged image, and creates the cluster, ALB, ACM cert, Route 53 record, IAM roles, task definition, and service — as one CloudFormation stack.

## Design notes & decisions

Key design choices:

- **Generic engine, not workload-aware** — specific workloads (e.g. an MCP server) are documented presets/examples, not plugin code.
- **`assignPublicIp` defaults to `false`** (private). No-NAT VPCs must set `true`.
- **Execution role** (plugin-managed: pull image, read secrets, write logs) vs **task role** (you declare what your code calls). Least-privilege by default.
- **DNS/ACM optional** — omit `domain:` to get an ALB-only stack with its hostname as an output, and wire DNS yourself.
- **`domain.hostedZoneId` auto-resolved** — omit it and the plugin derives the zone from `domain.name` via Route 53 (longest public-zone suffix match); set it explicitly to override or disambiguate split-horizon zones. Requires `route53:ListHostedZones` for the deploying principal.
- **ECR repo lifecycle (build mode)** — the plugin creates the repo out-of-band (the image must exist before the stack references it) and, by default, **deletes it and its images on `serverless remove`** so teardown is clean. Set `image.retainRepositoryOnRemove: true` to keep images for rollback.
- **Immutable digest deploys (build mode)** — the task definition is pinned to the image **digest** (`repo@sha256:…`), not the tag. So every content change — committed, uncommitted/dirty, or a base-image/dependency change — produces a new digest and rolls the service, while identical content never causes a spurious rollout. The build runs during `serverless deploy` (not `serverless package`).

## Development

```bash
npm install
npm test        # CFN snapshot + security assertions, no AWS calls
npm run build
```

Local consumption from another repo before publish: `npm link`, then `npm link serverless-fargate-service`.

## License

MIT
