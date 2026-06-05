/**
 * Config types for the `fargate:` top-level block in serverless.yml.
 *
 * These mirror the JSON Schema in schema.ts (which is what actually validates
 * user input via Serverless's configSchemaHandler). Keep the two in sync.
 */

export interface FargateConfig {
  cluster?: ClusterConfig;
  services: Record<string, ServiceConfig>;
}

export interface ClusterConfig {
  /** Reuse an existing cluster by ARN/name instead of creating one. */
  arn?: string;
  name?: string;
  containerInsights?: boolean;
}

export interface ServiceConfig {
  /** Physical name override; otherwise derived from `${service}-${stage}-<key>`. */
  name?: string;
  cpu?: number; // default 256
  memory?: number; // default 512
  desiredCount?: number; // default 1
  spot?: boolean; // default false (on-demand FARGATE)

  vpc: VpcConfig;
  image: ImageConfig;
  container: ContainerConfig;

  taskRole?: RoleConfig;
  /** Secret ARNs whose read permission is auto-granted to the execution role. */
  executionRole?: { secretArns?: string[] };

  logs?: { retentionInDays?: number }; // default 30
  loadBalancer: LoadBalancerConfig;
  domain?: DomainConfig;
  deployment?: DeploymentConfig;

  /** Raw-CloudFormation escape hatch, deep-merged onto generated resources. */
  overrides?: Record<string, unknown>;
}

export interface VpcConfig {
  id: string;
  subnets: string[];
  /** Default false (private placement). Set true on no-NAT VPCs. */
  assignPublicIp?: boolean;
  /** Extra SGs appended to the plugin-managed service SG. */
  securityGroups?: string[];
}

export interface ImageConfig {
  /** Mode A: reference a pre-built image. */
  uri?: string;
  /** Mode B: build from a Dockerfile. */
  context?: string;
  dockerfile?: string;
  platform?: string; // default linux/amd64
  tag?: 'sha' | 'latest' | string; // default 'sha'
  /** ECR image scanning on push (build mode). Default true. */
  scanOnPush?: boolean;
  /** ECR lifecycle policy for the created repo (build mode). */
  lifecycle?: LifecycleConfig;
  /**
   * Keep the ECR repo (and its images) on `serverless remove` instead of
   * deleting it. Default false — remove deletes the repo it created.
   */
  retainRepositoryOnRemove?: boolean;
}

export interface LifecycleConfig {
  keepLastTagged?: number; // default 20
  tagPrefixes?: string[]; // default ['sha-']
  expireUntaggedAfterDays?: number; // default 7
  /** Raw ECR lifecycle policy; if set, used verbatim instead of the above. */
  policyText?: unknown;
}

export interface ContainerConfig {
  port: number;
  command?: string[];
  environment?: Record<string, string>;
  /** ENV_NAME -> Secrets Manager / SSM reference (ValueFrom). */
  secrets?: Record<string, string>;
  healthCheck?: ContainerHealthCheck;
}

export interface ContainerHealthCheck {
  command: string[];
  interval?: number;
  timeout?: number;
  retries?: number;
  startPeriod?: number;
}

export interface RoleConfig {
  statements?: unknown[]; // IAM PolicyDocument statements
  managedPolicies?: string[];
  /** Opt-in: fold provider.iam role statements into the task role. */
  inheritProviderStatements?: boolean;
}

export interface LoadBalancerConfig {
  scheme?: 'internet-facing' | 'internal'; // default internet-facing
  subnets: string[];
  /** ALB idle timeout in seconds. The MCP preset sets 3600 for SSE. */
  idleTimeout?: number; // default 60 (AWS default)
  ingressCidr?: string; // default 0.0.0.0/0
  listeners?: ListenerConfig[];
  targetGroup?: TargetGroupConfig;
}

export interface ListenerConfig {
  port: number;
  protocol: 'HTTP' | 'HTTPS';
  redirectToHttps?: boolean;
  sslPolicy?: string;
  certificate?: { arn?: string; domain?: string; hostedZoneId?: string };
}

export interface TargetGroupConfig {
  healthCheckPath?: string; // default '/health'
  healthCheckIntervalSeconds?: number; // default 30
  healthyThresholdCount?: number; // default 2
  unhealthyThresholdCount?: number; // default 3
  deregistrationDelay?: number; // default 60
  stickiness?: boolean; // default false
}

export interface DomainConfig {
  name: string;
  /** Optional — auto-resolved from `name` via Route 53 if omitted. */
  hostedZoneId?: string;
}

export interface DeploymentConfig {
  minimumHealthyPercent?: number; // default 100
  maximumPercent?: number; // default 200
  circuitBreaker?: boolean; // default true
  rollback?: boolean; // default true
  gracePeriodSeconds?: number; // default 60
}
