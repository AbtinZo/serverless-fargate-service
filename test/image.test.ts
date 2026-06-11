import { describe, it, expect } from 'vitest';
import { buildLifecyclePolicy, resolveRepoSettings, formatTag } from '../src/image';

describe('formatTag', () => {
  it('uses sha-<sha> on a clean working tree', () => {
    expect(formatTag('sha', 'abc1234', false)).toBe('sha-abc1234');
    expect(formatTag(undefined, 'abc1234', false)).toBe('sha-abc1234');
  });

  it('appends -dirty when the working tree has changes', () => {
    // Cosmetic only — the digest reference is what actually forces a rollout —
    // but it distinguishes dirty builds from clean ones in ECR.
    expect(formatTag('sha', 'abc1234', true)).toBe('sha-abc1234-dirty');
  });

  it('passes a literal tag through unchanged', () => {
    expect(formatTag('v1.2.3', 'abc1234', true)).toBe('v1.2.3');
    expect(formatTag('latest', 'abc1234', false)).toBe('latest');
  });
});

describe('ECR lifecycle policy', () => {
  it('defaults match the legacy 01-ecr.yml (keep last 20 sha-, expire untagged 7d)', () => {
    const policy = JSON.parse(buildLifecyclePolicy());
    expect(policy.rules).toHaveLength(2);

    const keep = policy.rules[0];
    expect(keep.selection).toMatchObject({
      tagStatus: 'tagged',
      tagPrefixList: ['sha-'],
      countType: 'imageCountMoreThan',
      countNumber: 20,
    });
    expect(keep.action.type).toBe('expire');

    const untagged = policy.rules[1];
    expect(untagged.selection).toMatchObject({
      tagStatus: 'untagged',
      countType: 'sinceImagePushed',
      countUnit: 'days',
      countNumber: 7,
    });
  });

  it('honors overrides', () => {
    const policy = JSON.parse(
      buildLifecyclePolicy({ keepLastTagged: 5, tagPrefixes: ['v'], expireUntaggedAfterDays: 1 }),
    );
    expect(policy.rules[0].selection.countNumber).toBe(5);
    expect(policy.rules[0].selection.tagPrefixList).toEqual(['v']);
    expect(policy.rules[1].selection.countNumber).toBe(1);
  });

  it('uses raw policyText verbatim when provided', () => {
    const raw = { rules: [{ rulePriority: 9, custom: true }] };
    expect(JSON.parse(buildLifecyclePolicy({ policyText: raw }))).toEqual(raw);
  });

  it('resolveRepoSettings defaults scanOnPush to true and includes a policy', () => {
    const s = resolveRepoSettings({});
    expect(s.scanOnPush).toBe(true);
    expect(s.lifecyclePolicyText).toBeTruthy();
    expect(resolveRepoSettings({ scanOnPush: false }).scanOnPush).toBe(false);
  });
});
