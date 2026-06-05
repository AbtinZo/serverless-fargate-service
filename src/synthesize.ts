/**
 * Pure synthesis: (serviceKey, config, stage, service) -> CloudFormation fragment.
 *
 * No AWS calls, no Serverless internals — so it can be unit-tested directly and
 * snapshot-asserted. index.ts merges the result into the compiled template.
 */
import { FargateConfig, ServiceConfig, ListenerConfig } from './types';
import { logicalId, physicalName, baseSecretArn, isSecretsManager, isSsm } from './naming';

type Resources = Record<string, any>;
type Outputs = Record<string, any>;

export interface Fragment {
  Resources: Resources;
  Outputs: Outputs;
}

const DEFAULTS = {
  cpu: 256,
  memory: 512,
  desiredCount: 1,
  logRetention: 30,
  idleTimeout: 60,
  ingressCidr: '0.0.0.0/0',
  healthCheckPath: '/health',
  hcInterval: 30,
  healthyThreshold: 2,
  unhealthyThreshold: 3,
  deregistrationDelay: 60,
  minHealthy: 100,
  maxPercent: 200,
  gracePeriod: 60,
  sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
};

function deepMerge<T extends Record<string, any>>(base: T, override?: Record<string, unknown>): T {
  if (!override) return base;
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k], v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function synthesizeService(
  serviceKey: string,
  svc: ServiceConfig,
  cluster: FargateConfig['cluster'],
  ctx: { service: string; stage: string },
): Fragment {
  const id = (s: string) => logicalId(serviceKey, s);
  const prefix = `${ctx.service}-${ctx.stage}`;
  const name = svc.name ?? physicalName(prefix, serviceKey);
  const R: Resources = {};
  const O: Outputs = {};
  const ov = (svc.overrides ?? {}) as Record<string, any>;

  // --- Cluster (create unless an existing ARN is supplied) -----------------
  let clusterRef: any;
  const clusterId = id('Cluster');
  if (cluster?.arn) {
    clusterRef = cluster.arn;
  } else {
    R[clusterId] = {
      Type: 'AWS::ECS::Cluster',
      Properties: {
        ClusterName: cluster?.name ?? prefix,
        CapacityProviders: ['FARGATE', 'FARGATE_SPOT'],
        ClusterSettings: [
          { Name: 'containerInsights', Value: cluster?.containerInsights ? 'enabled' : 'disabled' },
        ],
      },
    };
    clusterRef = { Ref: clusterId };
  }

  // --- Log group -----------------------------------------------------------
  const logGroupId = id('LogGroup');
  R[logGroupId] = {
    Type: 'AWS::Logs::LogGroup',
    Properties: {
      LogGroupName: `/ecs/${name}`,
      RetentionInDays: svc.logs?.retentionInDays ?? DEFAULTS.logRetention,
    },
  };

  // --- Security groups -----------------------------------------------------
  const albSgId = id('AlbSecurityGroup');
  const svcSgId = id('ServiceSecurityGroup');
  R[albSgId] = {
    Type: 'AWS::EC2::SecurityGroup',
    Properties: {
      GroupDescription: `ALB ingress for ${name}`,
      VpcId: svc.vpc.id,
      SecurityGroupIngress: [
        {
          IpProtocol: 'tcp',
          FromPort: 80,
          ToPort: 80,
          CidrIp: svc.loadBalancer.ingressCidr ?? DEFAULTS.ingressCidr,
        },
        {
          IpProtocol: 'tcp',
          FromPort: 443,
          ToPort: 443,
          CidrIp: svc.loadBalancer.ingressCidr ?? DEFAULTS.ingressCidr,
        },
      ],
    },
  };
  R[svcSgId] = {
    Type: 'AWS::EC2::SecurityGroup',
    Properties: {
      GroupDescription: `Task ingress for ${name} (from ALB only)`,
      VpcId: svc.vpc.id,
      SecurityGroupIngress: [
        {
          IpProtocol: 'tcp',
          FromPort: svc.container.port,
          ToPort: svc.container.port,
          SourceSecurityGroupId: { Ref: albSgId },
        },
      ],
    },
  };

  // --- IAM: execution role (plugin-owned) + task role (user-declared) ------
  const execRoleId = id('ExecutionRole');
  const secretRefs = [
    ...Object.values(svc.container.secrets ?? {}),
    ...(svc.executionRole?.secretArns ?? []),
  ];
  const smArns = [...new Set(secretRefs.filter(isSecretsManager).map(baseSecretArn))];
  const ssmArns = [...new Set(secretRefs.filter(isSsm))];
  const execPolicies: any[] = [];
  if (smArns.length) {
    execPolicies.push({
      PolicyName: 'ReadSecretsManager',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: smArns }],
      },
    });
  }
  if (ssmArns.length) {
    execPolicies.push({
      PolicyName: 'ReadSsmParameters',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: ['ssm:GetParameters'], Resource: ssmArns }],
      },
    });
  }
  R[execRoleId] = {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'ecs-tasks.amazonaws.com' },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      ManagedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'],
      ...(execPolicies.length ? { Policies: execPolicies } : {}),
    },
  };

  const taskRoleId = id('TaskRole');
  const taskStatements = (svc.taskRole?.statements ?? []) as any[];
  R[taskRoleId] = {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'ecs-tasks.amazonaws.com' },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      ...(svc.taskRole?.managedPolicies ? { ManagedPolicyArns: svc.taskRole.managedPolicies } : {}),
      ...(taskStatements.length
        ? {
            Policies: [
              {
                PolicyName: 'TaskPolicy',
                PolicyDocument: { Version: '2012-10-17', Statement: taskStatements },
              },
            ],
          }
        : {}),
    },
  };

  // --- ACM certificate (only when a domain + listener want a managed cert) -
  const httpsListener = (svc.loadBalancer.listeners ?? []).find((l) => l.protocol === 'HTTPS');
  let certArn: any;
  const byoArn = httpsListener?.certificate?.arn;
  if (byoArn) {
    certArn = byoArn;
  } else if (svc.domain && httpsListener) {
    const certId = id('Certificate');
    R[certId] = {
      Type: 'AWS::CertificateManager::Certificate',
      Properties: {
        DomainName: svc.domain.name,
        ValidationMethod: 'DNS',
        DomainValidationOptions: [
          { DomainName: svc.domain.name, HostedZoneId: svc.domain.hostedZoneId },
        ],
      },
    };
    certArn = { Ref: certId };
  }

  // --- ALB + target group --------------------------------------------------
  const albId = id('Alb');
  const tgId = id('TargetGroup');
  R[albId] = deepMerge(
    {
      Type: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
      Properties: {
        Name: physicalName(prefix, serviceKey, 32),
        Scheme: svc.loadBalancer.scheme ?? 'internet-facing',
        Type: 'application',
        Subnets: svc.loadBalancer.subnets,
        SecurityGroups: [{ Ref: albSgId }],
        LoadBalancerAttributes: [
          {
            Key: 'idle_timeout.timeout_seconds',
            Value: String(svc.loadBalancer.idleTimeout ?? DEFAULTS.idleTimeout),
          },
        ],
      },
    },
    ov.loadBalancer,
  );
  const tg = svc.loadBalancer.targetGroup ?? {};
  R[tgId] = {
    Type: 'AWS::ElasticLoadBalancingV2::TargetGroup',
    Properties: {
      Name: physicalName(`${prefix}-tg`, serviceKey, 32),
      Port: svc.container.port,
      Protocol: 'HTTP',
      TargetType: 'ip',
      VpcId: svc.vpc.id,
      HealthCheckPath: tg.healthCheckPath ?? DEFAULTS.healthCheckPath,
      HealthCheckIntervalSeconds: tg.healthCheckIntervalSeconds ?? DEFAULTS.hcInterval,
      HealthyThresholdCount: tg.healthyThresholdCount ?? DEFAULTS.healthyThreshold,
      UnhealthyThresholdCount: tg.unhealthyThresholdCount ?? DEFAULTS.unhealthyThreshold,
      Matcher: { HttpCode: '200' },
      TargetGroupAttributes: [
        {
          Key: 'deregistration_delay.timeout_seconds',
          Value: String(tg.deregistrationDelay ?? DEFAULTS.deregistrationDelay),
        },
        { Key: 'stickiness.enabled', Value: String(tg.stickiness ?? false) },
      ],
    },
  };

  // --- Listeners -----------------------------------------------------------
  const listeners: ListenerConfig[] = svc.loadBalancer.listeners ?? [];
  const listenerLogicalIds: string[] = [];
  for (const l of listeners) {
    const lid = id(`Listener${l.port}`);
    listenerLogicalIds.push(lid);
    if (l.protocol === 'HTTP' && l.redirectToHttps) {
      R[lid] = {
        Type: 'AWS::ElasticLoadBalancingV2::Listener',
        Properties: {
          LoadBalancerArn: { Ref: albId },
          Port: l.port,
          Protocol: 'HTTP',
          DefaultActions: [
            {
              Type: 'redirect',
              RedirectConfig: { Protocol: 'HTTPS', Port: '443', StatusCode: 'HTTP_301' },
            },
          ],
        },
      };
    } else {
      R[lid] = {
        Type: 'AWS::ElasticLoadBalancingV2::Listener',
        Properties: {
          LoadBalancerArn: { Ref: albId },
          Port: l.port,
          Protocol: l.protocol,
          ...(l.protocol === 'HTTPS'
            ? {
                SslPolicy: l.sslPolicy ?? DEFAULTS.sslPolicy,
                Certificates: [{ CertificateArn: certArn }],
              }
            : {}),
          DefaultActions: [{ Type: 'forward', TargetGroupArn: { Ref: tgId } }],
        },
      };
    }
  }

  // --- Task definition -----------------------------------------------------
  const taskDefId = id('TaskDefinition');
  const containerName = serviceKey;
  const environment = Object.entries(svc.container.environment ?? {}).map(([Name, Value]) => ({
    Name,
    Value,
  }));
  const secrets = Object.entries(svc.container.secrets ?? {}).map(([Name, ValueFrom]) => ({
    Name,
    ValueFrom,
  }));
  R[taskDefId] = deepMerge(
    {
      Type: 'AWS::ECS::TaskDefinition',
      Properties: {
        Family: name,
        NetworkMode: 'awsvpc',
        RequiresCompatibilities: ['FARGATE'],
        Cpu: String(svc.cpu ?? DEFAULTS.cpu),
        Memory: String(svc.memory ?? DEFAULTS.memory),
        ExecutionRoleArn: { 'Fn::GetAtt': [execRoleId, 'Arn'] },
        TaskRoleArn: { 'Fn::GetAtt': [taskRoleId, 'Arn'] },
        ContainerDefinitions: [
          {
            Name: containerName,
            Image: svc.image.uri ?? { Ref: id('ImageUri') }, // resolved by index.ts in build mode
            Essential: true,
            ...(svc.container.command ? { Command: svc.container.command } : {}),
            PortMappings: [{ ContainerPort: svc.container.port, Protocol: 'tcp' }],
            ...(environment.length ? { Environment: environment } : {}),
            ...(secrets.length ? { Secrets: secrets } : {}),
            LogConfiguration: {
              LogDriver: 'awslogs',
              Options: {
                'awslogs-group': { Ref: logGroupId },
                'awslogs-region': { Ref: 'AWS::Region' },
                'awslogs-stream-prefix': containerName,
              },
            },
            ...(svc.container.healthCheck
              ? {
                  HealthCheck: {
                    Command: svc.container.healthCheck.command,
                    Interval: svc.container.healthCheck.interval ?? 30,
                    Timeout: svc.container.healthCheck.timeout ?? 5,
                    Retries: svc.container.healthCheck.retries ?? 3,
                    StartPeriod: svc.container.healthCheck.startPeriod ?? 60,
                  },
                }
              : {}),
          },
        ],
      },
    },
    ov.taskDefinition,
  );

  // --- ECS service ---------------------------------------------------------
  const serviceId = id('Service');
  const dep = svc.deployment ?? {};
  const useSpot = svc.spot === true;
  R[serviceId] = deepMerge(
    {
      Type: 'AWS::ECS::Service',
      DependsOn: listenerLogicalIds,
      Properties: {
        ServiceName: name,
        Cluster: clusterRef,
        TaskDefinition: { Ref: taskDefId },
        DesiredCount: svc.desiredCount ?? DEFAULTS.desiredCount,
        ...(useSpot
          ? { CapacityProviderStrategy: [{ CapacityProvider: 'FARGATE_SPOT', Weight: 1 }] }
          : { LaunchType: 'FARGATE' }),
        NetworkConfiguration: {
          AwsvpcConfiguration: {
            Subnets: svc.vpc.subnets,
            SecurityGroups: [{ Ref: svcSgId }, ...(svc.vpc.securityGroups ?? [])],
            AssignPublicIp: svc.vpc.assignPublicIp ? 'ENABLED' : 'DISABLED',
          },
        },
        LoadBalancers: [
          {
            ContainerName: containerName,
            ContainerPort: svc.container.port,
            TargetGroupArn: { Ref: tgId },
          },
        ],
        DeploymentConfiguration: {
          MinimumHealthyPercent: dep.minimumHealthyPercent ?? DEFAULTS.minHealthy,
          MaximumPercent: dep.maximumPercent ?? DEFAULTS.maxPercent,
          DeploymentCircuitBreaker: {
            Enable: dep.circuitBreaker ?? true,
            Rollback: dep.rollback ?? true,
          },
        },
        HealthCheckGracePeriodSeconds: dep.gracePeriodSeconds ?? DEFAULTS.gracePeriod,
      },
    },
    ov.service,
  );

  // --- DNS (optional) ------------------------------------------------------
  if (svc.domain) {
    R[id('DnsRecord')] = {
      Type: 'AWS::Route53::RecordSet',
      Properties: {
        HostedZoneId: svc.domain.hostedZoneId,
        Name: svc.domain.name,
        Type: 'A',
        AliasTarget: {
          DNSName: { 'Fn::GetAtt': [albId, 'DNSName'] },
          HostedZoneId: { 'Fn::GetAtt': [albId, 'CanonicalHostedZoneID'] },
          EvaluateTargetHealth: true,
        },
      },
    };
    O[id('ServiceUrl')] = { Value: `https://${svc.domain.name}` };
  }

  // --- Outputs -------------------------------------------------------------
  O[id('AlbDnsName')] = { Value: { 'Fn::GetAtt': [albId, 'DNSName'] } };
  O[id('AlbHostedZoneId')] = { Value: { 'Fn::GetAtt': [albId, 'CanonicalHostedZoneID'] } };
  O[id('LogGroupName')] = { Value: { Ref: logGroupId } };

  return { Resources: R, Outputs: O };
}

export function synthesize(
  config: FargateConfig,
  ctx: { service: string; stage: string },
): Fragment {
  const out: Fragment = { Resources: {}, Outputs: {} };
  for (const [key, svc] of Object.entries(config.services)) {
    const frag = synthesizeService(key, svc, config.cluster, ctx);
    Object.assign(out.Resources, frag.Resources);
    Object.assign(out.Outputs, frag.Outputs);
  }
  return out;
}
