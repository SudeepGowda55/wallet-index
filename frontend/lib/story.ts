// Plain mutable stores: the scroll timeline tweens `scene`, the terrain eases toward it each frame and writes `sim`.
export const HERO = { orbit: 0, dist: 12.5, lift: 7.2, fx: 0, fz: 0.6, shift: -0.13, rise: 0.16, vol: 0, flow: 1, skew: 0, vel: 0 };
export const scene = { ...HERO };
/** routing simulation state: basin fill level, flow share and projected screen position per wallet */
export const sim = { level: [0, 0, 0], share: [1 / 3, 1 / 3, 1 / 3], screen: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as number[][] };
