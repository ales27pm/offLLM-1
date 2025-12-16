import { Platform } from 'react-native';
import CoreML from '../native/CoreMLInference';
import { loadONNXModel } from '../native/ONNXInference';
import { MODEL_VARIANTS } from './modelRegistry';

let currentVariant = null;
let loading = false;

export async function ensureModel(variant) {
  if (loading || variant === currentVariant) return false;
  const entry = MODEL_VARIANTS[variant];
  if (!entry) throw new Error(`Unknown model variant: ${variant}`);

  loading = true;
  try {
    if (Platform.OS === 'ios') {
      await CoreML.loadModel(entry.ios);
    } else {
      await loadONNXModel(entry.android);
    }
    currentVariant = variant;
    return true;
  } finally {
    loading = false;
  }
}

export function getCurrentVariant() {
  return currentVariant;
}

export function isModelLoading() {
  return loading;
}

