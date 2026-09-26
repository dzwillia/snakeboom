import { describe, expect, it } from 'vitest';
import { releaseSlug, releaseUrl } from './release';

describe('releaseSlug', () => {
  it('turns a tag into its subdomain label', () => {
    expect(releaseSlug('v0.17.0')).toBe('v0-17-0');
    expect(releaseSlug('v0.18.0-rc.1')).toBe('v0-18-0-rc-1');
  });

  it('has no slug for dev builds or junk', () => {
    expect(releaseSlug('v0.17.0-dev')).toBeNull();
    expect(releaseSlug('0.17.0')).toBeNull();
    expect(releaseSlug('dev')).toBeNull();
    expect(releaseSlug('')).toBeNull();
  });
});

describe('releaseUrl', () => {
  it('links the current site to the release’s own address', () => {
    expect(releaseUrl('v0.17.0', 'https://api.snakeboom.com', 'snakeboom.com')).toBe('https://v0-17-0.snakeboom.com/');
    expect(releaseUrl('v0.17.0', 'https://api.snakeboom.com', 'www.snakeboom.com')).toBe('https://v0-17-0.snakeboom.com/');
  });

  it('is null once the page is already at that address', () => {
    expect(releaseUrl('v0.17.0', 'https://api.v0-17-0.snakeboom.com', 'v0-17-0.snakeboom.com')).toBeNull();
  });

  it('is null for dev builds and local relays', () => {
    expect(releaseUrl('v0.17.0-dev', 'https://api.snakeboom.com', 'snakeboom.com')).toBeNull();
    expect(releaseUrl('v0.17.0', 'http://localhost:3001', 'localhost')).toBeNull();
    expect(releaseUrl('v0.17.0', 'not a url', 'snakeboom.com')).toBeNull();
  });
});
