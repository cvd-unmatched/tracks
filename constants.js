export const CAR_L = 18;
export const CAR_W = 9;
export const SENSOR_COUNT = 5;
export const SENSOR_ANGLES = [-Math.PI/2, -Math.PI/4, 0, Math.PI/4, Math.PI/2];
export const SENSOR_RANGE = 160;
export const ACCEL = 0.25;
export const NN_TOPOLOGY = [SENSOR_COUNT + 1, 8, 2];
export const STALE_LIMIT = 150;

// Live-tweakable car physics (changed by UI sliders)
export const carConfig = {
  maxSpeed: 5.5,
  minSpeed: 0.8,
  turnRate: 0.055,
};
