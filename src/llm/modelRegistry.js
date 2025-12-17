export const MODEL_VARIANTS = {
  fp16: {
    ios: "Dolphin3.0-Llama3.2-3B-fp16.mlpackage",
    android: "dolphin_fp16.onnx",
  },
  int8: {
    ios: "Dolphin3.0-Llama3.2-3B-int8.mlpackage",
    android: "dolphin_int8.onnx",
  },
  int4: {
    ios: "Dolphin3.0-Llama3.2-3B-int4-lut.mlpackage",
    android: "dolphin_int4.onnx",
  },
};

export const DRAFT_MODEL = {
  ios: "Dolphin3.0-Llama3.2-3B-draft-int4.mlpackage",
  android: "dolphin_draft_int4.onnx",
};
