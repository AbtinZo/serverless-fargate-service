/**
 * JSON Schema registered with Serverless's configSchemaHandler so config errors
 * surface at `serverless package` time instead of as raw CloudFormation failures.
 * Mirrors the interfaces in types.ts.
 */
export const FARGATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['services'],
  properties: {
    cluster: {
      type: 'object',
      additionalProperties: false,
      properties: {
        arn: { type: 'string' },
        name: { type: 'string' },
        containerInsights: { type: 'boolean' },
      },
    },
    services: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['vpc', 'image', 'container', 'loadBalancer'],
        properties: {
          name: { type: 'string' },
          cpu: { type: 'number' },
          memory: { type: 'number' },
          desiredCount: { type: 'number' },
          spot: { type: 'boolean' },
          vpc: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'subnets'],
            properties: {
              id: { type: 'string' },
              subnets: { type: 'array', items: { type: 'string' }, minItems: 1 },
              assignPublicIp: { type: 'boolean' },
              securityGroups: { type: 'array', items: { type: 'string' } },
            },
          },
          image: {
            type: 'object',
            additionalProperties: false,
            properties: {
              uri: { type: 'string' },
              context: { type: 'string' },
              dockerfile: { type: 'string' },
              platform: { type: 'string' },
              tag: { type: 'string' },
              scanOnPush: { type: 'boolean' },
              retainRepositoryOnRemove: { type: 'boolean' },
              lifecycle: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  keepLastTagged: { type: 'number' },
                  tagPrefixes: { type: 'array', items: { type: 'string' } },
                  expireUntaggedAfterDays: { type: 'number' },
                  policyText: { type: 'object' },
                },
              },
            },
          },
          container: {
            type: 'object',
            additionalProperties: false,
            required: ['port'],
            properties: {
              port: { type: 'number' },
              command: { type: 'array', items: { type: 'string' } },
              environment: { type: 'object', additionalProperties: { type: 'string' } },
              secrets: { type: 'object', additionalProperties: { type: 'string' } },
              healthCheck: {
                type: 'object',
                additionalProperties: false,
                required: ['command'],
                properties: {
                  command: { type: 'array', items: { type: 'string' } },
                  interval: { type: 'number' },
                  timeout: { type: 'number' },
                  retries: { type: 'number' },
                  startPeriod: { type: 'number' },
                },
              },
            },
          },
          taskRole: {
            type: 'object',
            additionalProperties: false,
            properties: {
              statements: { type: 'array' },
              managedPolicies: { type: 'array', items: { type: 'string' } },
              inheritProviderStatements: { type: 'boolean' },
            },
          },
          executionRole: {
            type: 'object',
            additionalProperties: false,
            properties: { secretArns: { type: 'array', items: { type: 'string' } } },
          },
          logs: {
            type: 'object',
            additionalProperties: false,
            properties: { retentionInDays: { type: 'number' } },
          },
          loadBalancer: {
            type: 'object',
            additionalProperties: false,
            required: ['subnets'],
            properties: {
              scheme: { enum: ['internet-facing', 'internal'] },
              subnets: { type: 'array', items: { type: 'string' }, minItems: 1 },
              idleTimeout: { type: 'number' },
              ingressCidr: { type: 'string' },
              listeners: { type: 'array' },
              targetGroup: { type: 'object' },
            },
          },
          domain: {
            type: 'object',
            additionalProperties: false,
            required: ['name'],
            properties: {
              name: { type: 'string' },
              hostedZoneId: { type: 'string' },
            },
          },
          deployment: { type: 'object' },
          overrides: { type: 'object' },
        },
      },
    },
  },
} as const;
