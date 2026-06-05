/**
 * Flagship fixture: the MCP preset, sanitized. Mirrors the production needs the
 * plugin must satisfy (SSE idle timeout, secrets as ValueFrom, /health, no-NAT
 * public placement). The test asserts the synthesized CloudFormation against it.
 *
 * All identifiers below are placeholders (example.com, fake ARNs) — not real infra.
 */
import type { FargateConfig } from '../../src/types';

const MONGO_ARN = 'arn:aws:secretsmanager:us-east-2:111111111111:secret:example/mongo-uri-AbC123';
const REDIS_ARN = 'arn:aws:secretsmanager:us-east-2:111111111111:secret:example/redis-uri-DeF456';

export const mcpConfig: FargateConfig = {
  cluster: { containerInsights: false },
  services: {
    'mcp-server': {
      cpu: 512,
      memory: 1024,
      desiredCount: 1,
      vpc: {
        id: 'vpc-00000000',
        subnets: ['subnet-aaa', 'subnet-bbb', 'subnet-ccc'],
        assignPublicIp: true, // no-NAT VPC — see Decision #8
      },
      image: { uri: '111111111111.dkr.ecr.us-east-2.amazonaws.com/example-mcp:sha-abc1234' },
      container: {
        port: 8000,
        environment: {
          STAGE: 'prod',
          CW_REGION: 'us-east-2',
          MCP_ISSUER: 'https://mcp.example.com',
        },
        secrets: {
          MONGO_URI: MONGO_ARN,
          REDIS_URI: REDIS_ARN,
        },
        healthCheck: {
          command: [
            'CMD-SHELL',
            'python -c "import urllib.request; urllib.request.urlopen(\'http://localhost:8000/health\')" || exit 1',
          ],
          interval: 30,
          timeout: 5,
          retries: 3,
          startPeriod: 60,
        },
      },
      taskRole: {
        statements: [
          {
            Effect: 'Allow',
            Action: ['logs:FilterLogEvents', 'logs:GetLogEvents'],
            Resource: 'arn:aws:logs:us-east-2:111111111111:log-group:/aws/lambda/*:*',
          },
          {
            Effect: 'Allow',
            Action: ['cognito-idp:AdminInitiateAuth'],
            Resource: 'arn:aws:cognito-idp:us-east-2:111111111111:userpool/us-east-2_EXAMPLE01',
          },
        ],
      },
      logs: { retentionInDays: 30 },
      loadBalancer: {
        scheme: 'internet-facing',
        subnets: ['subnet-aaa', 'subnet-bbb', 'subnet-ccc'],
        idleTimeout: 3600, // SSE — the knob SCF would not expose
        listeners: [
          { port: 80, protocol: 'HTTP', redirectToHttps: true },
          { port: 443, protocol: 'HTTPS' },
        ],
        targetGroup: {
          healthCheckPath: '/health',
          deregistrationDelay: 60,
          stickiness: false,
        },
      },
      domain: { name: 'mcp.example.com', hostedZoneId: 'Z0EXAMPLE000000001' },
      deployment: { circuitBreaker: true, rollback: true, gracePeriodSeconds: 60 },
    },
  },
};
