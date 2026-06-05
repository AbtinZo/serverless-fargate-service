# Plugin manages ALB DNS and ACM itself

The plugin optionally manages the Route 53 alias record and the DNS-validated ACM
certificate for a service's domain, via an optional `domain:` block. We chose to
build this in rather than delegate to an existing DNS plugin because no ecosystem
plugin maps a custom domain to an ALB target: `serverless-domain-manager` is
API-Gateway/CloudFront only, and `serverless-alb-plugin` handles ALB _Lambda
events_, not Fargate + DNS. Since the plugin already creates the ALB (and thus knows
its `DNSName` and `CanonicalHostedZoneID`), and DNS-validated ACM is inherently
coupled to the hosted zone, building both in is simpler and more reliable than
stitching two tools together.

## Considered Options

- **serverless-domain-manager** — rejected: supports API Gateway/CloudFront only, no ALB.
- **Pre-issued certificate + external DNS** — still supported as a mode: when `domain:`
  is omitted the plugin creates only the ALB and exposes its hostname + zone ID as
  stack outputs, and the user may supply a `certificate.arn`. This is the cutover path.

## Consequences

- DNS is optional: present `domain:` → cert + alias managed by the plugin; omit it →
  ALB-only with outputs for external wiring (manual flip, Terraform, etc.).
- The plugin carries ACM + Route 53 logic it must maintain, rather than offloading it.
