export const hasOwn = (object, key) =>
  object != null && Object.prototype.hasOwnProperty.call(object, key);

export const resolveOptionValue = (
  key,
  {
    originalParameters = {},
    contextOptions = {},
    parameterValues = {},
    fallback,
  },
) => {
  if (hasOwn(parameterValues, key)) {
    return parameterValues[key];
  }
  if (hasOwn(contextOptions, key)) {
    return contextOptions[key];
  }
  if (hasOwn(originalParameters, key)) {
    return originalParameters[key];
  }
  return fallback;
};

export const matchesType = (expectedType, value) => {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return (
        value !== null && typeof value === "object" && !Array.isArray(value)
      );
    default:
      return true;
  }
};

export const applyParameterDefaults = (tool, parameters = {}) => {
  if (!tool.parameters) {
    return { ...parameters };
  }

  const resolved = { ...parameters };
  for (const [paramName, paramConfig] of Object.entries(tool.parameters)) {
    if (resolved[paramName] === undefined && hasOwn(paramConfig, "default")) {
      resolved[paramName] =
        typeof paramConfig.default === "function"
          ? paramConfig.default()
          : paramConfig.default;
    }
  }

  return resolved;
};

export const extractResultAnalytics = (result) => {
  if (!result || typeof result !== "object") {
    return null;
  }
  if (Array.isArray(result.results)) {
    return { resultCount: result.results.length };
  }
  if (Array.isArray(result.entries)) {
    return { resultCount: result.entries.length };
  }
  return null;
};

const normaliseEnumCandidate = (value) => {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }
  return value;
};

export const isEnumValueAllowed = (enumValues, value) => {
  if (!Array.isArray(enumValues)) {
    return true;
  }
  const normalisedEnum = enumValues.map(normaliseEnumCandidate);
  const normalisedValue = normaliseEnumCandidate(value);
  return normalisedEnum.includes(normalisedValue);
};

export const validateParameters = (tool, parameters = {}) => {
  if (!tool.parameters) {
    return;
  }

  for (const [paramName, paramConfig] of Object.entries(tool.parameters)) {
    const hasValue = hasOwn(parameters, paramName);

    if (paramConfig.required && !hasValue) {
      throw new Error(`Missing required parameter: ${paramName}`);
    }

    if (!hasValue) {
      continue;
    }

    const value = parameters[paramName];

    if (paramConfig.type && !matchesType(paramConfig.type, value)) {
      throw new Error(
        `Invalid type for parameter ${paramName}: expected ${paramConfig.type}`,
      );
    }

    if (paramConfig.enum && !isEnumValueAllowed(paramConfig.enum, value)) {
      throw new Error(
        `Invalid value for parameter: ${paramName}. Expected one of ${paramConfig.enum.join(", ")} (case-insensitive, trimmed)`,
      );
    }

    if (paramConfig.validate && !paramConfig.validate(value)) {
      throw new Error(`Invalid value for parameter: ${paramName}`);
    }
  }
};



