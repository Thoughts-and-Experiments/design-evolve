/**
 * Resolution and aspect ratio dimension calculations
 */

export type Resolution = '1K' | '2K' | '4K'
// Supported by Gemini API: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
export type AspectRatio = '1:1' | '9:16' | '16:9' | '4:3' | '3:4' | '2:3' | '3:2' | '4:5' | '5:4' | '21:9'

interface Dimensions {
  w: number
  h: number
}

/**
 * Default display width for canvas placement (in pixels).
 * Images are generated at full resolution but displayed at this width
 * (height calculated to maintain aspect ratio).
 */
export const DEFAULT_DISPLAY_WIDTH = 400

/**
 * Dimension mappings for each resolution and aspect ratio combination.
 * These match Gemini's supported output dimensions.
 */
const DIMENSION_MAP: Record<Resolution, Record<AspectRatio, Dimensions>> = {
  '1K': {
    '1:1': { w: 1024, h: 1024 },
    '9:16': { w: 576, h: 1024 },
    '16:9': { w: 1024, h: 576 },
    '4:3': { w: 896, h: 672 },
    '3:4': { w: 672, h: 896 },
  },
  '2K': {
    '1:1': { w: 1536, h: 1536 },
    '9:16': { w: 1152, h: 2048 },
    '16:9': { w: 2048, h: 1152 },
    '4:3': { w: 1792, h: 1344 },
    '3:4': { w: 1344, h: 1792 },
  },
  '4K': {
    '1:1': { w: 3072, h: 3072 },
    '9:16': { w: 2304, h: 4096 },
    '16:9': { w: 4096, h: 2304 },
    '4:3': { w: 3584, h: 2688 },
    '3:4': { w: 2688, h: 3584 },
  },
}

/**
 * Get dimensions for a given resolution and aspect ratio
 */
export function getDimensions(resolution: Resolution, aspectRatio: AspectRatio): Dimensions {
  return DIMENSION_MAP[resolution][aspectRatio]
}

/**
 * Get all supported resolutions
 */
export function getResolutions(): Resolution[] {
  return ['1K', '2K', '4K']
}

/**
 * Get all supported aspect ratios
 */
export function getAspectRatios(): AspectRatio[] {
  return ['1:1', '9:16', '16:9', '4:3', '3:4']
}

/**
 * Parse aspect ratio string, with fallback
 */
export function parseAspectRatio(str: string): AspectRatio {
  const valid: AspectRatio[] = ['1:1', '9:16', '16:9', '4:3', '3:4', '2:3', '3:2', '4:5', '5:4', '21:9']
  if (valid.includes(str as AspectRatio)) {
    return str as AspectRatio
  }
  return '9:16' // Default for mobile app screens
}

/**
 * Parse resolution string, with fallback
 */
export function parseResolution(str: string): Resolution {
  const valid: Resolution[] = ['1K', '2K', '4K']
  if (valid.includes(str as Resolution)) {
    return str as Resolution
  }
  return '2K' // Default
}

/**
 * Get display dimensions for canvas placement.
 * Scales the image to fit within displayWidth while maintaining aspect ratio.
 */
export function getDisplayDimensions(aspectRatio: AspectRatio, displayWidth: number = DEFAULT_DISPLAY_WIDTH): Dimensions {
  const [wRatio, hRatio] = aspectRatio.split(':').map(Number)
  const displayHeight = Math.round(displayWidth * (hRatio / wRatio))
  return { w: displayWidth, h: displayHeight }
}
