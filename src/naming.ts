/**
 * Naming helpers — follow Serverless Framework conventions (ADR/Decision #5):
 * PascalCase logical IDs, physical names derived from `${service}-${stage}`.
 * IAM roles are intentionally left CFN-auto-named to avoid CAPABILITY_NAMED_IAM.
 */

/** PascalCase a service key, e.g. "mcp-server" -> "McpServer". */
export function pascal(key: string): string {
  return key
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/** Logical resource ID, e.g. logicalId("mcp-server", "Alb") -> "McpServerAlb". */
export function logicalId(serviceKey: string, suffix: string): string {
  return `${pascal(serviceKey)}${suffix}`;
}

/**
 * Physical name, truncated to a max length (ALB/TG names cap at 32 chars).
 * Keeps the tail (most-specific part) when truncating.
 */
export function physicalName(prefix: string, serviceKey: string, maxLen = 255): string {
  const full = `${prefix}-${serviceKey}`;
  if (full.length <= maxLen) return full;
  return full.slice(full.length - maxLen);
}

/**
 * The base secret ARN with any ValueFrom JSON-key / version-stage suffix
 * stripped, suitable for an IAM resource grant.
 *
 *   arn:aws:secretsmanager:r:a:secret:name-AbC:KEY::stage  ->  arn:...:secret:name-AbC
 */
export function baseSecretArn(valueFrom: string): string {
  const parts = valueFrom.split(':');
  if (parts[2] === 'secretsmanager' && parts.length > 7) {
    return parts.slice(0, 7).join(':');
  }
  return valueFrom;
}

export function isSecretsManager(ref: string): boolean {
  return ref.split(':')[2] === 'secretsmanager';
}

export function isSsm(ref: string): boolean {
  return ref.split(':')[2] === 'ssm';
}
