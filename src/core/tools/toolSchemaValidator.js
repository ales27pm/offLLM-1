import Ajv from "ajv";
import { getToolSchema } from "./toolSchemas";

const ajv = new Ajv({ allErrors: true, strict: true });
const validators = new Map();

const compileSchema = (name) => {
  const schema = getToolSchema(name);
  if (!schema) return null;
  if (validators.has(name)) return validators.get(name);
  const validate = ajv.compile(schema);
  validators.set(name, validate);
  return validate;
};

export const validateToolArgs = (name, args, options = {}) => {
  const { allowMissingSchema = false } = options;
  const schema = getToolSchema(name);
  if (!schema) {
    if (allowMissingSchema) {
      return { valid: true, errors: [] };
    }
    return {
      valid: false,
      errors: [`Missing schema for tool '${name}'`],
    };
  }
  const validate = compileSchema(name);
  if (!validate) {
    return {
      valid: false,
      errors: [`Unable to compile schema for tool '${name}'`],
    };
  }
  const isValid = validate(args);
  if (isValid) return { valid: true, errors: [] };
  const errors = (validate.errors || []).map((err) => {
    const path = err.instancePath || "(root)";
    return `${path} ${err.message}`.trim();
  });
  return { valid: false, errors };
};
