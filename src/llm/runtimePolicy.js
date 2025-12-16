import { getPressureLevel } from '../system/memoryPressure';

export function preferredQuantization() {
  const level = getPressureLevel();
  if (level === 'critical') return 'int4';
  if (level === 'high') return 'int8';
  return 'fp16';
}

