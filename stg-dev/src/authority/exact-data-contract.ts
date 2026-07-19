function compareCodePoints(left: string, right: string): number {
  const leftScalars = Array.from(left);
  const rightScalars = Array.from(right);
  const length = Math.min(leftScalars.length, rightScalars.length);
  for (let index = 0; index < length; index += 1) {
    const leftCodePoint = leftScalars[index]?.codePointAt(0) ?? 0;
    const rightCodePoint = rightScalars[index]?.codePointAt(0) ?? 0;
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint;
  }
  return leftScalars.length - rightScalars.length;
}

/** Capture only enumerable own data properties without invoking accessors. */
export function ownPlainDataRecord(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path} must be a plain object`);
  }
  let isArray: boolean;
  let prototype: object | null;
  let symbols: readonly symbol[];
  let descriptors: PropertyDescriptorMap;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value) as object | null;
    symbols = Object.getOwnPropertySymbols(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(`${path} could not be inspected safely`);
  }
  if (isArray || (prototype !== Object.prototype && prototype !== null)) {
    throw new Error(`${path} must be a plain object`);
  }
  if (symbols.length > 0) throw new Error(`${path} must not contain symbol keys`);
  const actualKeys = Object.keys(descriptors).sort(compareCodePoints);
  const expected = [...expectedKeys].sort(compareCodePoints);
  if (
    actualKeys.length !== expected.length
    || actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${path} parameter contract drifted`);
  }
  const result: Record<string, unknown> = {};
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined
      || !("value" in descriptor)
      || descriptor.enumerable !== true
    ) {
      throw new Error(`${path}.${key} must be an enumerable own data property`);
    }
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}

/** Capture a small dense JSON array without invoking accessors. */
export function ownDenseDataArray(value: unknown, path: string): readonly unknown[] {
  let isArray: boolean;
  let prototype: object | null;
  let symbols: readonly symbol[];
  let descriptors: PropertyDescriptorMap;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value) as object | null;
    symbols = Object.getOwnPropertySymbols(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(`${path} could not be inspected safely`);
  }
  if (!isArray || prototype !== Array.prototype) {
    throw new Error(`${path} must be a plain array`);
  }
  if (symbols.length > 0) throw new Error(`${path} must not contain symbol keys`);
  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined
    || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    throw new Error(`${path}.length must be an own non-negative safe integer`);
  }
  const length = lengthDescriptor.value as number;
  if (length > 16) throw new Error(`${path}.length must not exceed 16`);
  const expectedKeys = Array.from({length}, (_, index) => String(index)).sort(compareCodePoints);
  const actualKeys = Object.keys(descriptors)
    .filter((key) => key !== "length")
    .sort(compareCodePoints);
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`${path} must be dense and contain no metadata`);
  }
  const captured: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new Error(`${path}[${index}] must be an own enumerable data element`);
    }
    captured.push(descriptor.value);
  }
  return Object.freeze(captured);
}

/** Descriptor-safe deep equality for one explicitly admitted immutable V4 slice. */
export function assertExactDataContract(actual: unknown, expected: unknown, path: string): void {
  if (Array.isArray(expected)) {
    const captured = ownDenseDataArray(actual, path);
    if (captured.length !== expected.length) throw new Error(`${path} exact contract drifted`);
    for (let index = 0; index < expected.length; index += 1) {
      assertExactDataContract(captured[index], expected[index], `${path}[${index}]`);
    }
    return;
  }
  if (typeof expected === "object" && expected !== null) {
    const expectedRecord = expected as Readonly<Record<string, unknown>>;
    const expectedKeys = Object.keys(expectedRecord);
    const captured = ownPlainDataRecord(
      actual as Readonly<Record<string, unknown>>,
      expectedKeys,
      path,
    );
    for (const key of expectedKeys) {
      assertExactDataContract(captured[key], expectedRecord[key], `${path}.${key}`);
    }
    return;
  }
  if (!Object.is(actual, expected)) throw new Error(`${path} exact contract drifted`);
}
