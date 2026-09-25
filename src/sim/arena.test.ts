import { describe, expect, it } from 'vitest';
import { circleHitsTiles, circleHitsWall, createTiles, setTile, tileSolid } from './arena';
import { ARENA_HEIGHT, ARENA_WIDTH } from './config';

describe('arena', () => {
  it('detects the arena border', () => {
    expect(circleHitsWall(7, 500, 7)).toBe(false);
    expect(circleHitsWall(6.9, 500, 7)).toBe(true);
    expect(circleHitsWall(ARENA_WIDTH - 7, 500, 7)).toBe(false);
    expect(circleHitsWall(ARENA_WIDTH - 6.9, 500, 7)).toBe(true);
    expect(circleHitsWall(800, 6.5, 7)).toBe(true);
    expect(circleHitsWall(800, ARENA_HEIGHT - 6.5, 7)).toBe(true);
    expect(circleHitsWall(Number.NaN, 500, 7)).toBe(true);
  });

  it('detects circles touching solid tiles', () => {
    const tiles = createTiles();
    setTile(tiles, 10, 10, true); // covers x 200..220, y 200..220
    expect(tileSolid(tiles, 10, 10)).toBe(true);
    expect(tileSolid(tiles, -1, 0)).toBe(false);
    expect(circleHitsTiles(tiles, 210, 210, 7)).toBe(true);
    expect(circleHitsTiles(tiles, 226, 210, 7)).toBe(true);
    expect(circleHitsTiles(tiles, 228, 210, 7)).toBe(false);
    expect(circleHitsTiles(tiles, 224, 224, 7)).toBe(true);
    expect(circleHitsTiles(tiles, 226, 226, 7)).toBe(false);
  });


});
