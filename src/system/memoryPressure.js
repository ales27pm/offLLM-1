import { AppState } from 'react-native';

let pressureScore = 0;
let lastTick = Date.now();

export function tickPressure() {
  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;

  if (dt < 12) pressureScore += 2;
  else if (dt < 20) pressureScore += 1;
  else pressureScore -= 1;

  pressureScore = Math.max(0, Math.min(pressureScore, 100));
}

export function getPressureLevel() {
  if (pressureScore > 60) return 'critical';
  if (pressureScore > 30) return 'high';
  return 'normal';
}

AppState.addEventListener('change', state => {
  if (state !== 'active') pressureScore += 10;
});

