/** Id-based image pre-selection: which model names it recognizes and what an id edit writes. */
import { describe, expect, it } from 'vitest'
import { idInputPatch, imageInputFor, knownImageModel } from '../src/client/image-capability.ts'

describe('knownImageModel', () => {
  it('recognizes vision families with and without a vendor prefix or alias', () => {
    for (const id of [
      'gpt-4o',
      'openai/gpt-4.1-mini',
      'gpt-4-turbo',
      'gpt-4-vision-preview',
      'gpt-5-mini',
      'o3-2025-04-16',
      'openai/o4-mini',
      'claude-3-5-sonnet',
      'anthropic/claude-sonnet-4-5',
      'gemini-2.5-flash',
      'gemma-3-27b',
      'qwen2.5-vl-72b',
      'deepseek-vl2',
      'glm-4v',
      'step-1v',
      'llava-1.6',
      'pixtral-large',
      'internvl2',
      'llama-4-scout',
      'grok-2-vision',
      'some-vendor-omni',
      'acme-multimodal-chat',
    ]) {
      expect(knownImageModel(id)).toBe(true)
    }
  })

  it('leaves text-only families and unknown names alone', () => {
    // `o1-mini`, `o1-preview`, `o3-mini`, and plain `gpt-4` take text only, and
    // an embedding or unknown alias names no image capability at all.
    for (const id of ['', '   ', 'deepseek-v4-pro', 'gpt-4', 'o1-mini', 'o1-preview', 'o3-mini',
      'claude-2.1', 'deepseek-embedding', 'my-vllm', 'acme-large']) {
      expect(knownImageModel(id)).toBe(false)
    }
  })
})

describe('imageInputFor', () => {
  it('answers text plus image for a recognized id and nothing otherwise', () => {
    expect(imageInputFor('gpt-4o')).toEqual(['text', 'image'])
    expect(imageInputFor('acme-large')).toBeUndefined()
  })
})

describe('idInputPatch', () => {
  const field = 'input' as const

  it('pre-selects image when a row declares nothing and the id names a vision family', () => {
    expect(idInputPatch({ field, previousId: '', nextId: 'gpt-4o', declared: [] }))
      .toEqual({ input: ['text', 'image'] })
    expect(idInputPatch({ field, previousId: '', nextId: 'qwen-vl-max', declared: undefined }))
      .toEqual({ input: ['text', 'image'] })
  })

  it('keeps a declaration the user composed, including a text-only override', () => {
    expect(idInputPatch({ field, previousId: 'gpt-4o', nextId: 'claude-3-5-sonnet', declared: ['text'] }))
      .toEqual({})
    // Image plus a modality this rule never writes is not the rule's to replace.
    expect(idInputPatch({ field, previousId: 'gpt-4o', nextId: 'acme-large', declared: ['image'] }))
      .toEqual({})
    // Nor is a text-only declaration on a family this rule does not recognize.
    expect(idInputPatch({ field, previousId: 'acme-large', nextId: 'acme-small', declared: ['text', 'image'] }))
      .toEqual({})
  })

  it('drops the declaration it wrote when the new id names no vision family', () => {
    expect(idInputPatch({ field, previousId: 'gpt-4o', nextId: 'acme-large', declared: ['text', 'image'] }))
      .toEqual({ input: undefined })
    // The same modalities in another order are not this rule's declaration.
    expect(idInputPatch({ field, previousId: 'gpt-4o', nextId: 'acme-large', declared: ['image', 'text'] }))
      .toEqual({})
    expect(idInputPatch({ field, previousId: 'gpt-4o', nextId: 'acme-large', declared: ['text', 'image', 'image'] }))
      .toEqual({})
  })

  it('leaves a row alone when neither id names a vision family', () => {
    expect(idInputPatch({ field, previousId: 'acme-large', nextId: 'acme-small', declared: undefined }))
      .toEqual({})
    // A declaration holding no modality this build knows is no declaration.
    expect(idInputPatch({ field, previousId: 'acme-large', nextId: 'acme-small', declared: ['text', 7] }))
      .toEqual({})
    expect(idInputPatch({ field, previousId: 'acme-large', nextId: 'qwen-vl-max', declared: [7] }))
      .toEqual({ input: ['text', 'image'] })
  })

  it('writes the adapter-owned field of the editor that asks', () => {
    expect(idInputPatch({
      field: 'inputModalities', previousId: '', nextId: 'gemini-pro', declared: undefined,
    })).toEqual({ inputModalities: ['text', 'image'] })
  })
})
