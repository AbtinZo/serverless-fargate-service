import { describe, it, expect } from 'vitest';
import { synthesize } from '../src/synthesize';
import { mcpConfig } from './fixtures/mcp';

const ctx = { service: 'mcp', stage: 'prod' };

function build() {
  return synthesize(mcpConfig, ctx);
}

const R = () => build().Resources;
const id = (s: string) => `McpServer${s}`;

describe('synthesize(mcp preset)', () => {
  // --- Snapshot (regression net) -----------------------------------------
  it('matches the CloudFormation snapshot', () => {
    expect(build()).toMatchSnapshot();
  });

  // --- Explicit security-critical assertions (cannot silently drift) ------

  it('sets the ALB idle timeout to 3600 for SSE', () => {
    const attrs = R()[id('Alb')].Properties.LoadBalancerAttributes;
    const idle = attrs.find((a: any) => a.Key === 'idle_timeout.timeout_seconds');
    expect(idle.Value).toBe('3600');
  });

  it('injects secrets as ValueFrom, never as plaintext environment', () => {
    const container = R()[id('TaskDefinition')].Properties.ContainerDefinitions[0];
    const secretNames = container.Secrets.map((s: any) => s.Name).sort();
    expect(secretNames).toEqual(['MONGO_URI', 'REDIS_URI']);
    for (const s of container.Secrets) expect(typeof s.ValueFrom).toBe('string');
    // The secret VALUES must not leak into the plaintext Environment block.
    const envNames = (container.Environment ?? []).map((e: any) => e.Name);
    expect(envNames).not.toContain('MONGO_URI');
    expect(envNames).not.toContain('REDIS_URI');
  });

  it('scopes the execution role to exactly the (base) secret ARNs', () => {
    const policies = R()[id('ExecutionRole')].Properties.Policies;
    const sm = policies.find((p: any) => p.PolicyName === 'ReadSecretsManager');
    const resources = sm.PolicyDocument.Statement[0].Resource;
    expect(resources).toEqual([
      'arn:aws:secretsmanager:us-east-2:111111111111:secret:example/mongo-uri-AbC123',
      'arn:aws:secretsmanager:us-east-2:111111111111:secret:example/redis-uri-DeF456',
    ]);
    // Not a wildcard.
    expect(resources).not.toContain('*');
  });

  it('does not open the container port to the world (ALB-only ingress)', () => {
    const svcSg = R()[id('ServiceSecurityGroup')].Properties.SecurityGroupIngress[0];
    expect(svcSg.FromPort).toBe(8000);
    expect(svcSg.SourceSecurityGroupId).toEqual({ Ref: id('AlbSecurityGroup') });
    expect(svcSg.CidrIp).toBeUndefined();
  });

  it('redirects HTTP to HTTPS', () => {
    const http = R()[id('Listener80')].Properties;
    expect(http.Protocol).toBe('HTTP');
    expect(http.DefaultActions[0].Type).toBe('redirect');
    expect(http.DefaultActions[0].RedirectConfig.StatusCode).toBe('HTTP_301');
  });

  it('enables the deployment circuit breaker with rollback', () => {
    const cb = R()[id('Service')].Properties.DeploymentConfiguration.DeploymentCircuitBreaker;
    expect(cb).toEqual({ Enable: true, Rollback: true });
  });

  it('creates a DNS-validated ACM cert and a Route 53 alias', () => {
    expect(R()[id('Certificate')].Properties.ValidationMethod).toBe('DNS');
    const dns = R()[id('DnsRecord')].Properties;
    expect(dns.Name).toBe('mcp.example.com');
    expect(dns.AliasTarget.DNSName).toEqual({ 'Fn::GetAtt': [id('Alb'), 'DNSName'] });
  });

  it('places tasks per assignPublicIp (no-NAT VPC -> ENABLED)', () => {
    const net = R()[id('Service')].Properties.NetworkConfiguration.AwsvpcConfiguration;
    expect(net.AssignPublicIp).toBe('ENABLED');
  });
});
