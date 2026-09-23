import { describe, expect, it } from 'vitest';
import { circleHitsTiles, circleHitsWall, createTiles, destroyTilesInCircle, setTile, tileSolid } from './arena';

describe('arena', () => {
  it('detects the arena border', () => {
    expect(circleHitsWall(7, 500, 7)).toBe(false);
    expect(circleHitsWall(6.9, 500, 7)).toBe(true);
    expect(circleHitsWall(1593, 500, 7)).toBe(false);
    expect(circleHitsWall(1593.1, 500, 7)).toBe(true);
    expect(circleHitsWall(800, 6.5, 7)).toBe(true);
    expect(circleHitsWall(800, 993.5, 7)).toBe(true);
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

  it('destroys every solid tile a blast touches and reports them in order', () => {
    const tiles = createTiles();
    setTile(tiles, 10, 10, true);
    setTile(tiles, 11, 10, true);
    setTile(tiles, 20, 20, true);
    expect(destroyTilesInCircle(tiles, 215, 210, 12)).toEqual([10 * 80 + 10, 10 * 80 + 11]);
    expect(tileSolid(tiles, 10, 10)).toBe(false);
    expect(tileSolid(tiles, 11, 10)).toBe(false);
    expect(tileSolid(tiles, 20, 20)).toBe(true);
    expect(destroyTilesInCircle(tiles, 215, 210, 12)).toEqual([]);
  });

  // Review Focus 3: blasts at the edges and corners.
  it('handles blasts at the arena edges and corners', () => {
    const tiles = createTiles();
    setTile(tiles, 0, 0, true);
    setTile(tiles, 79, 49, true);
    expect(destroyTilesInCircle(tiles, 0, 0, 70)).toEqual([0]);
    expect(destroyTilesInCircle(tiles, 1600, 1000, 70)).toEqual([49 * 80 + 79]);
    expect(destroyTilesInCircle(tiles, -500, -500, 70)).toEqual([]);
    expect(destroyTilesInCircle(tiles, Number.NaN, 10, 70)).toEqual([]);
  });
});
