/**
 * Image build/push (Decision #2, build mode). Mirrors the current deploy.py
 * flow: ensure the ECR repo exists (with scan-on-push + a lifecycle policy),
 * build, log in, push a sha-tagged image.
 *
 * v0.1 shells out to `docker` and the `aws` CLI (documented prerequisites),
 * matching the existing harness. A future version may switch to the AWS SDK.
 *
 * The repo is created out-of-band (not in the CloudFormation stack) because the
 * image must exist before the stack's task definition references it. By default
 * the repo (and its images) is force-deleted on `serverless remove`; set
 * image.retainRepositoryOnRemove to keep it for rollback.
 */
import { execFileSync } from 'node:child_process';

export interface LifecycleConfig {
  /** Keep at most this many tagged images (matching tagPrefixes). Default 20. */
  keepLastTagged?: number;
  /** Tag prefixes the keep-rule applies to. Default ['sha-']. */
  tagPrefixes?: string[];
  /** Expire untagged images older than this many days. Default 7. */
  expireUntaggedAfterDays?: number;
  /** Raw ECR lifecycle policy text; if set, used verbatim instead of the above. */
  policyText?: unknown;
}

export interface RepoSettings {
  scanOnPush: boolean;
  /** Resolved ECR lifecycle policy as JSON text, or undefined to leave unset. */
  lifecyclePolicyText?: string;
}

export interface BuildPlan {
  serviceKey: string;
  repository: string;
  tag: string;
  imageUri: string;
  context: string;
  dockerfile: string;
  platform: string;
  region: string;
  registry: string; // <account>.dkr.ecr.<region>.amazonaws.com
  repo: RepoSettings;
}

export function gitShortSha(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

export function resolveTag(spec: string | undefined, cwd: string): string {
  if (!spec || spec === 'sha') return `sha-${gitShortSha(cwd)}`;
  return spec; // 'latest' or a literal tag
}

export function ecrUri(account: string, region: string, repo: string, tag: string): string {
  return `${account}.dkr.ecr.${region}.amazonaws.com/${repo}:${tag}`;
}

/**
 * Build the default ECR lifecycle policy — equivalent to the legacy 01-ecr.yml:
 * keep the last N tagged images, expire untagged images after D days.
 */
export function buildLifecyclePolicy(cfg: LifecycleConfig = {}): string {
  if (cfg.policyText) return JSON.stringify(cfg.policyText);
  const keep = cfg.keepLastTagged ?? 20;
  const prefixes = cfg.tagPrefixes ?? ['sha-'];
  const days = cfg.expireUntaggedAfterDays ?? 7;
  return JSON.stringify({
    rules: [
      {
        rulePriority: 1,
        description: `Keep last ${keep} tagged images`,
        selection: {
          tagStatus: 'tagged',
          tagPrefixList: prefixes,
          countType: 'imageCountMoreThan',
          countNumber: keep,
        },
        action: { type: 'expire' },
      },
      {
        rulePriority: 2,
        description: `Expire untagged after ${days} days`,
        selection: {
          tagStatus: 'untagged',
          countType: 'sinceImagePushed',
          countUnit: 'days',
          countNumber: days,
        },
        action: { type: 'expire' },
      },
    ],
  });
}

/** Resolve repo settings from optional image config, applying legacy defaults. */
export function resolveRepoSettings(image: {
  scanOnPush?: boolean;
  lifecycle?: LifecycleConfig;
}): RepoSettings {
  return {
    scanOnPush: image.scanOnPush ?? true,
    lifecyclePolicyText: buildLifecyclePolicy(image.lifecycle),
  };
}

export function ensureRepository(repo: string, region: string, settings: RepoSettings): void {
  let exists = true;
  try {
    execFileSync(
      'aws',
      ['ecr', 'describe-repositories', '--repository-names', repo, '--region', region],
      { stdio: 'ignore' },
    );
  } catch {
    exists = false;
  }

  if (!exists) {
    execFileSync(
      'aws',
      [
        'ecr',
        'create-repository',
        '--repository-name',
        repo,
        '--image-scanning-configuration',
        `scanOnPush=${settings.scanOnPush}`,
        '--region',
        region,
      ],
      { stdio: 'ignore' },
    );
  }

  // Apply (or refresh) the lifecycle policy idempotently, whether new or existing.
  if (settings.lifecyclePolicyText) {
    execFileSync(
      'aws',
      [
        'ecr',
        'put-lifecycle-policy',
        '--repository-name',
        repo,
        '--lifecycle-policy-text',
        settings.lifecyclePolicyText,
        '--region',
        region,
      ],
      { stdio: 'ignore' },
    );
  }
}

/**
 * Force-delete an ECR repo and all its images. Idempotent: a missing repo is
 * treated as already gone. Used by the `after:remove:remove` hook.
 */
export function deleteRepository(repo: string, region: string, log: (m: string) => void): void {
  try {
    execFileSync(
      'aws',
      ['ecr', 'delete-repository', '--repository-name', repo, '--force', '--region', region],
      { stdio: 'ignore' },
    );
    log(`deleted ECR repo ${repo}`);
  } catch {
    log(`ECR repo ${repo} not found (already gone)`);
  }
}

export function buildAndPush(plan: BuildPlan, log: (m: string) => void): void {
  ensureRepository(plan.repository, plan.region, plan.repo);

  log(`Building ${plan.imageUri}`);
  execFileSync(
    'docker',
    [
      'build',
      '--platform',
      plan.platform,
      '-f',
      plan.dockerfile,
      '-t',
      plan.imageUri,
      plan.context,
    ],
    { stdio: 'inherit' },
  );

  log(`Logging in to ${plan.registry}`);
  const password = execFileSync('aws', ['ecr', 'get-login-password', '--region', plan.region], {
    encoding: 'utf8',
  });
  execFileSync('docker', ['login', '--username', 'AWS', '--password-stdin', plan.registry], {
    input: password,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  log(`Pushing ${plan.imageUri}`);
  execFileSync('docker', ['push', plan.imageUri], { stdio: 'inherit' });
}
