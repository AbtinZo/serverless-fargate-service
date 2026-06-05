import { describe, it, expect } from 'vitest';
import { selectHostedZone, HostedZone } from '../src/route53';

const zone = (Name: string, Id: string, PrivateZone = false): HostedZone => ({
  Id,
  Name,
  Config: { PrivateZone },
});

describe('selectHostedZone', () => {
  it('picks the longest-suffix public zone', () => {
    const zones = [
      zone('example.com.', '/hostedzone/ZAPEX'),
      zone('dev.example.com.', '/hostedzone/ZDEV'),
    ];
    expect(selectHostedZone(zones, 'mcp.dev.example.com')).toBe('ZDEV');
    expect(selectHostedZone(zones, 'mcp.example.com')).toBe('ZAPEX');
  });

  it('matches the apex domain itself', () => {
    expect(selectHostedZone([zone('example.com.', '/hostedzone/ZAPEX')], 'example.com')).toBe(
      'ZAPEX',
    );
  });

  it('strips the /hostedzone/ prefix from the Id', () => {
    expect(selectHostedZone([zone('example.com.', '/hostedzone/Z123ABC')], 'mcp.example.com')).toBe(
      'Z123ABC',
    );
  });

  it('excludes private zones (split-horizon) in favor of the public one', () => {
    const zones = [
      zone('example.com.', '/hostedzone/ZPRIVATE', true),
      zone('example.com.', '/hostedzone/ZPUBLIC', false),
    ];
    expect(selectHostedZone(zones, 'mcp.example.com')).toBe('ZPUBLIC');
  });

  it('is case-insensitive and tolerant of trailing dots', () => {
    expect(selectHostedZone([zone('Example.Com', '/hostedzone/ZUP')], 'MCP.example.com.')).toBe(
      'ZUP',
    );
  });

  it('throws when no public zone matches', () => {
    expect(() =>
      selectHostedZone([zone('other.com.', '/hostedzone/ZX')], 'mcp.example.com'),
    ).toThrow(/No public Route 53 hosted zone/);
  });

  it('throws on ambiguous duplicate same-name zones', () => {
    const zones = [
      zone('example.com.', '/hostedzone/ZONE1'),
      zone('example.com.', '/hostedzone/ZONE2'),
    ];
    expect(() => selectHostedZone(zones, 'mcp.example.com')).toThrow(/Multiple hosted zones match/);
  });
});
