export function setupLLMDI(di, { deviceProfile, performanceMetrics, kvCache }) {
  di.register("deviceProfile", deviceProfile);
  di.register("performanceMetrics", performanceMetrics);
  di.register("kvCache", kvCache);
}
