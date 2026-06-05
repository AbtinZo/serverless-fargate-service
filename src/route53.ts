/**
 * Resolve a Route 53 hosted zone ID from a domain name, so users can omit
 * `domain.hostedZoneId` and let the plugin derive it.
 *
 * The selection logic is a pure function (testable, no AWS); resolveHostedZoneId
 * is the thin AWS-CLI wrapper around it. ACM DNS validation requires a zone *ID*
 * (not a name), so this resolution must happen plugin-side, not in CloudFormation.
 */
import { execFileSync } from 'node:child_process';

export interface HostedZone {
  Id: string;
  Name: string;
  Config?: { PrivateZone?: boolean };
}

const stripDot = (n: string): string => n.replace(/\.$/, '').toLowerCase();

/**
 * Pick the hosted zone whose name is the longest suffix of `domainName`,
 * among public zones. Throws on zero matches or a genuine tie (duplicate
 * same-name zones) so the user supplies an explicit ID instead of a wrong guess.
 */
export function selectHostedZone(zones: HostedZone[], domainName: string): string {
  const fqdn = stripDot(domainName);
  const matches = zones
    .filter((z) => !z.Config?.PrivateZone)
    .filter((z) => {
      const zn = stripDot(z.Name);
      return fqdn === zn || fqdn.endsWith(`.${zn}`);
    })
    .sort((a, b) => stripDot(b.Name).length - stripDot(a.Name).length);

  if (matches.length === 0) {
    throw new Error(
      `No public Route 53 hosted zone found for '${domainName}'. ` +
        `Set domain.hostedZoneId explicitly.`,
    );
  }
  // Equal-length suffix matches must be the same zone name → ambiguous duplicate.
  if (matches.length > 1 && stripDot(matches[0].Name).length === stripDot(matches[1].Name).length) {
    throw new Error(
      `Multiple hosted zones match '${domainName}' (e.g. '${matches[0].Name}'). ` +
        `Set domain.hostedZoneId explicitly to disambiguate.`,
    );
  }
  return matches[0].Id.replace('/hostedzone/', '');
}

export function resolveHostedZoneId(domainName: string): string {
  const out = execFileSync('aws', ['route53', 'list-hosted-zones', '--output', 'json'], {
    encoding: 'utf8',
  });
  const zones: HostedZone[] = JSON.parse(out).HostedZones ?? [];
  return selectHostedZone(zones, domainName);
}
