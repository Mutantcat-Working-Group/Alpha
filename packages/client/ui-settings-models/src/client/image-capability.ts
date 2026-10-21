/**
 * Recognition of model ids whose published models accept image input, and the
 * declaration one id edit materializes from it.
 *
 * A row's input types have three sources: the row's own declaration, the
 * installed catalog's entry for that id, and the route's `defaultInput`. An id
 * neither of the first two describes — one typed by hand, or one a listing
 * endpoint advertises without modality fields — falls through to the route
 * default, so a vision model arrives looking text-only. The id itself names a
 * family whose published models accept images, which is enough to pre-select
 * Image in the editor: the hint is written into the drafted row, never into
 * the configuration the user did not save, and unchecking Image keeps the last
 * word.
 *
 * The list below is a naming convention, not a capability registry. A family
 * it misses keeps today's behavior — the route default, corrected by hand.
 */

/** The declaration an image-capable id pre-selects: images join text, never replace it. */
const IMAGE_INPUT: readonly string[] = ['text', 'image']

/**
 * Model-id markers for families whose published models accept image input.
 * Anchors are avoided except where a shorter marker would over-match, because
 * route ids carry vendor prefixes and gateway aliases.
 */
const IMAGE_ID_PATTERNS: readonly RegExp[] = [
  // OpenAI: the 4o, 4.1, and turbo families; every gpt-5 build; and the
  // o-series reasoning models, whose mini and preview builds take text only.
  /gpt-4o/,
  /gpt-4\.1/,
  /gpt-4-turbo/,
  /gpt-4-vision/,
  /chatgpt-4o/,
  /gpt-5/,
  /(?:^|[/])o[13](?!-(?:mini|preview)(?:$|[/-]))/,
  /o4-mini/,
  // Anthropic: Claude 3 and later accept images; Claude 2 and Instant do not.
  /claude-(?:[34]|sonnet|opus|haiku)/,
  // Google: Gemini is multimodal throughout, as are Gemma 3 and PaliGemma.
  /gemini-(?:\d|pro|flash|ultra)/,
  /gemma-3/,
  /paligemma/,
  // Open-weight vision families.
  /llava/,
  /pixtral/,
  /internvl/,
  /minicpm-v/,
  /moondream/,
  /idefics/,
  /cogvlm/,
  /llama-4/,
  /llama-3\.2[^/]*vision/,
  /phi-(?:4-multimodal|3\.5-vision)/,
  // Vendor vision suffixes and standalone `vl` aliases (qwen-vl-max,
  // deepseek-vl2, glm-4v, step-1v, grok-2-vision, ...).
  /(?:^|[-_/])vl(?:\d|[-_/]|$)/,
  /glm-4(?:\.\d)?v/,
  /step-1v/,
  /yi-vision/,
  /hunyuan[^/]*vision/,
  /ernie[^/]*-vl/,
  /doubao[^/]*vision/,
  /abab[^/]*vision/,
  /spark[^/]*vision/,
  /grok-(?:[2-9]|.*vision)/,
  // Markers naming the capability itself, wherever a vendor puts them.
  /vision/,
  /visual/,
  /multimodal/,
  /omni/,
]

/**
 * Whether a model id names a family documented to accept image input.
 * @param modelId - the route-facing model id, with or without a vendor prefix.
 * @returns `true` when the id matches a known image-capable family.
 */
export function knownImageModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase()
  return id.length > 0 && IMAGE_ID_PATTERNS.some(pattern => pattern.test(id))
}

/**
 * The declaration an id pre-selects, for a caller adopting a model rather than
 * editing an existing row.
 * @param modelId - the id about to be written.
 * @returns text plus image, or `undefined` when the id names no such family.
 */
export function imageInputFor(modelId: string): readonly string[] | undefined {
  return knownImageModel(modelId) ? [...IMAGE_INPUT] : undefined
}

/** A stored declaration read as a modality list, or `undefined` when absent or empty. */
function declaredInput(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const modalities = value.filter((entry): entry is string => typeof entry === 'string')
  return modalities.length === 0 ? undefined : modalities
}

/** Whether two declarations name the same modalities in the same order. */
function sameInput(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((modality, at) => modality === right[at])
}

/**
 * The declaration an id edit materializes for one row, as the fragment its
 * editor merges into that row.
 *
 * A declaration the user composed survives an id edit; one this rule wrote,
 * and a row that declared nothing at all, follow the new id: it gains Image
 * when the new id names an image-capable family, and loses the declaration
 * this rule wrote when it names no such family. Removal is the fragment's
 * `undefined` value, which both editors drop from the row rather than store.
 *
 * @param options - the adapter's declaration field and the row's two ids.
 * @returns the field to merge: a modalities array, or `undefined` to clear it.
 */
export function idInputPatch(options: {
  /** Adapter-owned declaration field: `inputModalities` for DeepSeek, `input` for pi-ai. */
  field: 'input' | 'inputModalities'
  /** The row's id before this edit. */
  previousId: string
  /** The id this edit writes. */
  nextId: string
  /** The row's stored declaration, if it has one. */
  declared: unknown
}): Record<string, readonly string[] | undefined> {
  const declared = declaredInput(options.declared)
  const wroteIt = declared !== undefined
    && knownImageModel(options.previousId)
    && sameInput(declared, IMAGE_INPUT)
  if (declared !== undefined && !wroteIt) return {}
  const preselect = imageInputFor(options.nextId)
  if (preselect !== undefined) return { [options.field]: preselect }
  return wroteIt ? { [options.field]: undefined } : {}
}
