/**
 * Native fetch-based Gemini API client for image generation
 */

import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
import type { Resolution } from './dimensions'

const GEMINI_MODEL = 'gemini-2.0-flash-exp-image-generation'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiPart {
  text?: string
  inlineData?: {
    mimeType: string
    data: string // base64
  }
}

interface GeminiContent {
  parts: GeminiPart[]
}

interface GeminiRequest {
  contents: GeminiContent[]
  generationConfig: {
    responseModalities: string[]
    imageDimension?: string
  }
}

interface GeminiResponsePart {
  text?: string
  inlineData?: {
    mimeType: string
    data: string // base64
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: GeminiResponsePart[]
    }
  }>
  error?: {
    code: number
    message: string
    status: string
  }
}

export interface GenerateImageOptions {
  prompt: string
  resolution?: Resolution
  inputImage?: string | string[] // Path(s) to input image(s) for grounding
  apiKey?: string
}

export interface GenerateImageResult {
  success: boolean
  imageData?: Buffer
  mimeType?: string
  textResponse?: string
  error?: string
}

/**
 * Get MIME type for an image file
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  }
  return mimeTypes[ext] || 'image/png'
}

/**
 * Load an image file as base64
 */
function loadImageAsBase64(filePath: string): { data: string; mimeType: string } {
  if (!existsSync(filePath)) {
    throw new Error(`Input image not found: ${filePath}`)
  }
  const buffer = readFileSync(filePath)
  const data = buffer.toString('base64')
  const mimeType = getMimeType(filePath)
  return { data, mimeType }
}

/**
 * Get API key from options or environment
 */
function getApiKey(provided?: string): string {
  const key = provided || process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error(
      'No API key provided. Please either:\n' +
      '  1. Set GEMINI_API_KEY environment variable\n' +
      '  2. Pass apiKey in options'
    )
  }
  return key
}

/**
 * Generate an image using Gemini API
 */
export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
  const { prompt, resolution = '2K', inputImage, apiKey: providedKey } = options

  let apiKey: string
  try {
    apiKey = getApiKey(providedKey)
  } catch (e: any) {
    return { success: false, error: e.message }
  }

  // Build the parts array
  const parts: GeminiPart[] = []

  // Add input image(s) for grounding (can be single path or array of paths)
  if (inputImage) {
    const images = Array.isArray(inputImage) ? inputImage : [inputImage]
    for (const imgPath of images) {
      try {
        const { data, mimeType } = loadImageAsBase64(imgPath)
        parts.push({ inlineData: { mimeType, data } })
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  }

  // Add the text prompt
  parts.push({ text: prompt })

  // Build request body
  // Note: Resolution/image size parameter not yet supported in REST API
  // The SDK uses image_config.image_size but the REST equivalent is unclear
  const requestBody: GeminiRequest = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  }

  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const data: GeminiResponse = await response.json()

    // Check for API error
    if (data.error) {
      return {
        success: false,
        error: `Gemini API error: ${data.error.message} (${data.error.status})`,
      }
    }

    // Extract response parts
    const candidates = data.candidates
    if (!candidates || candidates.length === 0) {
      return { success: false, error: 'No candidates in response' }
    }

    const responseParts = candidates[0].content.parts
    let imageData: Buffer | undefined
    let mimeType: string | undefined
    let textResponse: string | undefined

    for (const part of responseParts) {
      if (part.text) {
        textResponse = part.text
      }
      if (part.inlineData) {
        mimeType = part.inlineData.mimeType
        imageData = Buffer.from(part.inlineData.data, 'base64')
      }
    }

    if (!imageData) {
      return {
        success: false,
        error: 'No image data in response',
        textResponse,
      }
    }

    return {
      success: true,
      imageData,
      mimeType,
      textResponse,
    }
  } catch (e: any) {
    return {
      success: false,
      error: `Network error: ${e.message}`,
    }
  }
}
