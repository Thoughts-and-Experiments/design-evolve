#!/usr/bin/env bun

/**
 * generate CLI - Generate images with Gemini and place on tldraw canvas
 *
 * Features:
 * - Runs ALL generations in parallel
 * - Places images at correct display size (scaled from actual image dimensions)
 * - Auto-saves all images to disk
 *
 * Usage:
 *   bun scripts/generate.ts "A cozy firefly glowing softly"
 *   bun scripts/generate.ts "Screen 1" "Screen 2" "Screen 3" --layout row
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getDimensions, parseResolution, parseAspectRatio, DEFAULT_DISPLAY_WIDTH } from './lib/dimensions'
import type { Resolution, AspectRatio } from './lib/dimensions'
import { generateImage } from './lib/gemini'
import {
  checkHealth,
  getViewportCenter,
  getPositionBelowSelection,
  uploadImage,
  selectShapes,
} from './lib/canvas'

interface CliArgs {
  prompts: string[]
  resolution: Resolution
  aspectRatio: AspectRatio
  x?: number
  y?: number
  layout: 'row' | 'column'
  gap: number
  inputImages: string[]
  outputDir: string
  displayWidth: number
  help: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)

  // Default output dir with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const defaultOutputDir = `/tmp/generate-${timestamp}`

  const result: CliArgs = {
    prompts: [],
    resolution: '2K',
    aspectRatio: '9:16',
    layout: 'row',
    gap: 40,
    inputImages: [],
    outputDir: defaultOutputDir,
    displayWidth: DEFAULT_DISPLAY_WIDTH,
    help: false,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '--help' || arg === '-h') {
      result.help = true
      i++
    } else if (arg === '--resolution' || arg === '-r') {
      result.resolution = parseResolution(args[i + 1])
      i += 2
    } else if (arg === '--aspect-ratio' || arg === '-a') {
      result.aspectRatio = parseAspectRatio(args[i + 1])
      i += 2
    } else if (arg === '--x') {
      result.x = parseInt(args[i + 1], 10)
      i += 2
    } else if (arg === '--y') {
      result.y = parseInt(args[i + 1], 10)
      i += 2
    } else if (arg === '--layout' || arg === '-l') {
      result.layout = args[i + 1] as 'row' | 'column'
      i += 2
    } else if (arg === '--gap' || arg === '-g') {
      result.gap = parseInt(args[i + 1], 10)
      i += 2
    } else if (arg === '--input-image' || arg === '-i') {
      result.inputImages.push(args[i + 1])
      i += 2
    } else if (arg === '--output-dir' || arg === '-o') {
      result.outputDir = args[i + 1]
      i += 2
    } else if (arg === '--display-width' || arg === '-w') {
      result.displayWidth = parseInt(args[i + 1], 10)
      i += 2
    } else if (!arg.startsWith('-')) {
      result.prompts.push(arg)
      i++
    } else {
      console.error(`Unknown option: ${arg}`)
      process.exit(1)
    }
  }

  return result
}

function printHelp() {
  console.log(`
generate - Generate images with Gemini and place on tldraw canvas

USAGE:
  generate [OPTIONS] PROMPT [PROMPT...]

ARGUMENTS:
  PROMPT    One or more image generation prompts

OPTIONS:
  -h, --help              Show this help message
  -r, --resolution        1K | 2K | 4K (default: 2K)
  -a, --aspect-ratio      1:1 | 9:16 | 16:9 | 4:3 | 3:4 | 2:3 | 3:2 | 4:5 | 5:4 | 21:9 (default: 9:16)
  -i, --input-image       Grounding image(s) for style consistency (repeatable)
  --x <N>                 Starting X position (default: below selection or viewport center)
  --y <N>                 Starting Y position (default: below selection or viewport center)
  -l, --layout <TYPE>     Layout for multiple: row | column (default: row)
  -g, --gap <N>           Gap between images in pixels (default: 40)
  -w, --display-width <N> Canvas display width in pixels (default: 400)
  -o, --output-dir <DIR>  Save images to this directory (default: /tmp/generate-{timestamp})

EXAMPLES:
  generate "A cozy firefly glowing softly"
  generate "Mobile app login screen" --resolution 2K
  generate "Screen 1" "Screen 2" "Screen 3" --layout row
  generate "Square icon" --aspect-ratio 1:1 --resolution 1K

ENVIRONMENT:
  GEMINI_API_KEY    Gemini API key (required)
  EVAL_PORT         Eval server port (default: 3031)
`)
}

interface Job {
  prompt: string
  index: number
  x: number
  y: number
}

/**
 * Process a single job: generate image, save to disk, upload to canvas
 */
async function processJob(
  job: Job,
  args: CliArgs,
  totalJobs: number
): Promise<{ success: boolean; shapeId: string | null; displayWidth: number; displayHeight: number; error?: string }> {
  const prefix = `[${job.index + 1}/${totalJobs}]`
  const shortPrompt = job.prompt.length > 50 ? job.prompt.slice(0, 47) + '...' : job.prompt

  console.log(`${prefix} Generating: "${shortPrompt}"`)

  // Generate image
  const result = await generateImage({
    prompt: job.prompt,
    resolution: args.resolution,
    aspectRatio: args.aspectRatio,
    inputImage: args.inputImages.length > 0 ? args.inputImages : undefined,
  })

  if (!result.success || !result.imageData) {
    console.error(`${prefix} Error: ${result.error}`)
    return { success: false, shapeId: null, displayWidth: 0, displayHeight: 0, error: result.error }
  }

  // Save to disk
  const filename = `${String(job.index + 1).padStart(2, '0')}.png`
  const filepath = join(args.outputDir, filename)
  writeFileSync(filepath, result.imageData)
  console.log(`${prefix} Saved: ${filepath}`)

  // Upload to canvas (scaled to display width, preserving aspect ratio)
  const shapeId = await uploadImage({
    imageData: result.imageData,
    mimeType: result.mimeType || 'image/png',
    x: job.x,
    y: job.y,
    targetWidth: args.displayWidth,
  })

  if (shapeId) {
    console.log(`${prefix} Placed: ${shapeId}`)
  }

  // Return the actual display dimensions (we don't know them here, but we'll estimate)
  return { success: true, shapeId, displayWidth: args.displayWidth, displayHeight: 0 }
}

async function main() {
  const args = parseArgs()

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  if (args.prompts.length === 0) {
    console.error('Error: No prompts specified')
    console.error('Usage: generate PROMPT [PROMPT...]')
    process.exit(1)
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY environment variable not set')
    process.exit(1)
  }

  // Check canvas connection
  console.log('Checking canvas connection...')
  const health = await checkHealth()
  if (!health.ok || !health.browserConnected) {
    console.error('Error: Canvas not available. Make sure tldraw is open.')
    process.exit(1)
  }
  console.log('Canvas connected')

  // Create output directory
  mkdirSync(args.outputDir, { recursive: true })
  console.log(`Output dir: ${args.outputDir}\n`)

  // Get starting position: prefer below selection, fallback to viewport center
  let startX = args.x
  let startY = args.y
  if (startX === undefined || startY === undefined) {
    const belowSelection = await getPositionBelowSelection(100)
    if (belowSelection) {
      startX = startX ?? belowSelection.x
      startY = startY ?? belowSelection.y
      console.log('Positioning below selection')
    } else {
      const center = await getViewportCenter()
      startX = startX ?? center.x
      startY = startY ?? center.y
      console.log('Positioning at viewport center (no selection)')
    }
  }

  const genDimensions = getDimensions(args.resolution, args.aspectRatio)
  console.log(`Resolution: ${args.resolution} (${genDimensions.w}x${genDimensions.h})`)
  console.log(`Display width: ${args.displayWidth}px`)
  console.log(`Starting at: (${Math.round(startX)}, ${Math.round(startY)})`)
  console.log(`Generating ${args.prompts.length} image(s) in parallel...\n`)

  // Create jobs - we estimate positions based on display width
  // Actual heights will vary based on Gemini's output aspect ratio
  const estimatedHeight = Math.round(args.displayWidth * 1.5)  // Rough estimate for layout
  const jobs: Job[] = []
  let currentX = startX
  let currentY = startY

  for (let i = 0; i < args.prompts.length; i++) {
    jobs.push({
      prompt: args.prompts[i],
      index: i,
      x: currentX,
      y: currentY,
    })
    if (args.layout === 'row') {
      currentX += args.displayWidth + args.gap
    } else {
      currentY += estimatedHeight + args.gap
    }
  }

  // Run ALL generations in PARALLEL
  console.log('Starting parallel generation...\n')
  const results = await Promise.all(
    jobs.map(job => processJob(job, args, jobs.length))
  )

  // Collect successful shape IDs
  const finalShapeIds = results
    .filter(r => r.success && r.shapeId)
    .map(r => r.shapeId as string)

  // Select all generated images
  if (finalShapeIds.length > 0) {
    await selectShapes(finalShapeIds)
  }

  const successCount = results.filter(r => r.success).length
  console.log(`\nDone! Generated ${successCount}/${jobs.length} image(s).`)
  console.log(`Images saved to: ${args.outputDir}`)
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
