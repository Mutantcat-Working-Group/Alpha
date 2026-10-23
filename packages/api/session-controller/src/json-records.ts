/**
 * Reading untyped records out of foreign session files.
 *
 * Every foreign writer emits whatever shape its own version produced, so no
 * field arriving from one can be trusted to exist or to carry the expected
 * JSON type. The helpers below hold that narrowing in one place, letting each
 * adapter describe its own schema while sharing the same safe reads.
 * @module @mutantcat/dsh-api-session-controller/json-records
 */

/**
 * Narrow an unknown value to a plain object, else `{}`.
 * @param value - the raw field value, of whatever JSON type the writer emitted.
 * @returns the object, or `{}` when the value is not one.
 */
export function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Parse a JSON string into a plain object.
 * @param text - JSON text as stored in one foreign record field.
 * @returns the parsed object, or `{}` when the text is malformed or not an object.
 */
export function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return asObject(parsed)
  } catch { return {} }
}

/**
 * Parse one JSONL line into a plain object.
 * @param line - a single non-empty line of a foreign JSONL session file.
 * @returns the parsed object, or `undefined` when the line is malformed or not an object.
 */
export function parseJsonlRecord(line: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch { return undefined }
  return asObject(parsed)
}

/**
 * Read one string field out of a foreign record.
 * @param value - the raw field value, of whatever JSON type the writer emitted.
 * @returns the string, or `undefined` when the field is absent or not a string.
 */
export function jsonString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
