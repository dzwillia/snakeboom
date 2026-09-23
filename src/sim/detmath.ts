// Deterministic trig: only + - * / and Math.floor, which every JS engine computes
// identically (IEEE 754). Math.sin/cos/atan2 are allowed to differ between engines.

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
const SQRT3 = 1.7320508075688772;
const TAN_PI_12 = 0.2679491924311227;

/** Wraps an angle into [-PI, PI). */
export function wrapAngle(a: number): number {
  return a - TWO_PI * Math.floor((a + PI) / TWO_PI);
}

/** Sine via Taylor series through x^17 on [-PI/2, PI/2] (error < 1e-13). */
export function detSin(a: number): number {
  let x = wrapAngle(a);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 *
                        (-1 / 39916800 +
                          x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000 + x2 * (1 / 355687428096000)))))))))
  );
}

export function detCos(a: number): number {
  return detSin(a + HALF_PI);
}

/** atan on |z| <= tan(PI/12) via its Taylor series through z^23. */
function atanSmall(z: number): number {
  const z2 = z * z;
  return (
    z *
    (1 +
      z2 *
        (-1 / 3 +
          z2 *
            (1 / 5 +
              z2 *
                (-1 / 7 +
                  z2 *
                    (1 / 9 +
                      z2 *
                        (-1 / 11 +
                          z2 *
                            (1 / 13 +
                              z2 * (-1 / 15 + z2 * (1 / 17 + z2 * (-1 / 19 + z2 * (1 / 21 + z2 * (-1 / 23))))))))))))
  );
}

export function detAtan(v: number): number {
  const neg = v < 0;
  let z = neg ? -v : v;
  let invert = false;
  if (z > 1) {
    z = 1 / z;
    invert = true;
  }
  let shift = 0;
  if (z > TAN_PI_12) {
    // atan(z) = PI/6 + atan((z*sqrt3 - 1) / (sqrt3 + z))
    z = (z * SQRT3 - 1) / (SQRT3 + z);
    shift = PI / 6;
  }
  let r = shift + atanSmall(z);
  if (invert) r = HALF_PI - r;
  return neg ? -r : r;
}

export function detAtan2(y: number, x: number): number {
  if (x > 0) return detAtan(y / x);
  if (x < 0) return y >= 0 ? detAtan(y / x) + PI : detAtan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}
