import { describe, expect, it } from 'vitest';
import { inviteLink, roomFromPath } from './link';

describe('roomFromPath', () => {
  it('reads a random code', () => {
    expect(roomFromPath('/r/ABC234')).toBe('ABC234');
    expect(roomFromPath('/r/ABC234/')).toBe('ABC234');
  });

  it('reads a chosen name, normalised the way the relay stores it', () => {
    expect(roomFromPath('/r/dave')).toBe('dave');
    expect(roomFromPath('/r/Dave')).toBe('dave');
    expect(roomFromPath('/r/friday-night-2/')).toBe('friday-night-2');
    expect(roomFromPath('/r/dave%20z')).toBeNull();
  });

  it('passes a lowercase code through for the relay to resolve', () => {
    expect(roomFromPath('/r/abc234')).toBe('abc234');
  });

  it('ignores anything else', () => {
    expect(roomFromPath('/')).toBeNull();
    expect(roomFromPath('/r/')).toBeNull();
    expect(roomFromPath('/r/ab')).toBeNull();
    expect(roomFromPath('/r/admin')).toBeNull();
    expect(roomFromPath('/r/dave/extra')).toBeNull();
    expect(roomFromPath('/rooms/dave')).toBeNull();
    expect(roomFromPath('/r/%E0%A4%A')).toBeNull();
  });
});

describe('inviteLink', () => {
  it('puts the room under /r/', () => {
    expect(inviteLink('https://snakeboom.com', 'dave')).toBe('https://snakeboom.com/r/dave');
    expect(inviteLink('http://localhost:5199', 'ABC234')).toBe('http://localhost:5199/r/ABC234');
  });
});
