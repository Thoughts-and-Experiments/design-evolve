#!/usr/bin/env bun

/**
 * upload CLI - Upload images to tldraw canvas
 *
 * Usage:
 *   upload image.png                     # Single image at viewport center
 *   upload img1.png img2.png img3.png    # Multiple images in a row
 *   upload *.png --x 100 --y 200         # Specify starting position
 *   upload *.png --layout column         # Vertical layout
 *   upload *.png --gap 100               # Custom gap between images
 */

import { existsSync, statSync, readFileSync } from 'fs'
import { resolve, extname } from 'path'

const EVAL_PORT = process.env.EVAL_PORT || '3031'
const EVAL_URL = `http://localhost:${EVAL_PORT}`

interface CliArgs {
  files: string[]
  x?: number
  y?: number
  layout: 'row' | 'column'
  gap: number
  help: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const result: CliArgs = {
    files: [],
    layout: 'row',
    gap: 50,
    help: false,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '--help' || arg === '-h') {
      result.help = true
      i++
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
    } else if (!arg.startsWith('-')) {
      // File path
      result.files.push(arg)
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
upload - Upload images to tldraw canvas

USAGE:
  upload [OPTIONS] FILE [FILE...]

ARGUMENTS:
  FILE    Image file(s) to upload (png, jpg, etc.)

OPTIONS:
  -h, --help              Show this help message
  --x <N>                 Starting X position (default: viewport center)
  --y <N>                 Starting Y position (default: viewport center)
  -l, --layout <TYPE>     Layout: row or column (default: row)
  -g, --gap <N>           Gap between images in pixels (default: 50)

EXAMPLES:
  upload screenshot.png
  upload v1.png v2.png v3.png
  upload /tmp/*.png --x 100 --y 200
  upload /tmp/*.png --layout column --gap 100

ENVIRONMENT:
  EVAL_PORT    Eval server port (default: 3031)
`)
}

async function checkHealth(): Promise<{ ok: boolean; browserConnected: boolean }> {
  try {
    const res = await fetch(`${EVAL_URL}/health`)
    const data = await res.json() as { status: string; browserConnected: boolean }
    return { ok: data.status === 'ok', browserConnected: data.browserConnected }
  } catch (e) {
    return { ok: false, browserConnected: false }
  }
}

async function evalCode(code: string): Promise<any> {
  const res = await fetch(`${EVAL_URL}/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  return res.json()
}

async function getViewportCenter(): Promise<{ x: number; y: number }> {
  const result = await evalCode(`
    const bounds = editor.getViewportScreenBounds();
    const camera = editor.getCamera();
    return {
      x: (-camera.x + bounds.w / 2) / camera.z,
      y: (-camera.y + bounds.h / 2) / camera.z
    };
  `)
  if (!result.success) {
    return { x: 100, y: 100 }
  }
  return result.result
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  }
  return mimeTypes[ext] || 'image/png'
}

function fileToDataUrl(filePath: string): string {
  const buffer = readFileSync(filePath)
  const base64 = buffer.toString('base64')
  const mimeType = getMimeType(filePath)
  return `data:${mimeType};base64,${base64}`
}

async function uploadImages(files: string[], startX: number, startY: number, layout: 'row' | 'column', gap: number): Promise<string[]> {
  const shapeIds: string[] = []
  let currentX = startX
  let currentY = startY

  for (const filePath of files) {
    const dataUrl = fileToDataUrl(filePath)

    // Code to run in browser - NO IIFE, EvalBridge already wraps in async
    const code = `
      const dataUrl = ${JSON.stringify(dataUrl)};
      const currentX = ${currentX};
      const currentY = ${currentY};

      // Get image dimensions
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      // Create asset ID
      const assetId = "asset:" + Math.random().toString(36).substr(2, 9);

      // Create the asset record
      editor.createAssets([{
        id: assetId,
        type: "image",
        typeName: "asset",
        props: {
          name: "uploaded-image",
          src: dataUrl,
          w: w,
          h: h,
          mimeType: "image/png",
          isAnimated: false,
        },
        meta: {},
      }]);

      // Create image shape
      const shapeId = "shape:" + Math.random().toString(36).substr(2, 9);
      editor.createShape({
        id: shapeId,
        type: "image",
        x: currentX,
        y: currentY,
        props: {
          assetId: assetId,
          w: w,
          h: h,
        }
      });

      return { shapeId, w, h };
    `

    const result = await evalCode(code)
    if (!result.success) {
      console.error(`Failed to upload ${filePath}: ${result.error}`)
      continue
    }

    const { shapeId, w, h } = result.result
    shapeIds.push(shapeId)

    // Update position for next image
    if (layout === 'row') {
      currentX += w + gap
    } else {
      currentY += h + gap
    }
  }

  // Select all uploaded shapes
  if (shapeIds.length > 0) {
    const selectCode = `editor.setSelectedShapes(${JSON.stringify(shapeIds)}); return true;`
    await evalCode(selectCode)
  }

  return shapeIds
}

async function main() {
  const args = parseArgs()

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  if (args.files.length === 0) {
    console.error('Error: No files specified')
    console.error('Usage: upload FILE [FILE...]')
    process.exit(1)
  }

  // Resolve and validate file paths
  const resolvedFiles: string[] = []
  for (const file of args.files) {
    const resolved = resolve(file)
    if (!existsSync(resolved)) {
      console.error(`Error: File not found: ${file}`)
      process.exit(1)
    }
    if (!statSync(resolved).isFile()) {
      console.error(`Error: Not a file: ${file}`)
      process.exit(1)
    }
    resolvedFiles.push(resolved)
  }

  console.log(`Uploading ${resolvedFiles.length} image(s)...`)

  // Check eval server health
  const health = await checkHealth()
  if (!health.ok) {
    console.error('Error: Eval server is not running')
    console.error('Make sure to start it: just dev')
    process.exit(1)
  }
  if (!health.browserConnected) {
    console.error('Error: Browser not connected to eval server')
    console.error('Open tldraw in your browser: http://localhost:3030')
    process.exit(1)
  }

  // Get starting position
  let startX = args.x
  let startY = args.y

  if (startX === undefined || startY === undefined) {
    console.log('Getting viewport center...')
    const center = await getViewportCenter()
    startX = startX ?? center.x
    startY = startY ?? center.y
  }

  console.log(`Placing at (${startX.toFixed(0)}, ${startY.toFixed(0)}) with ${args.layout} layout, ${args.gap}px gap`)

  // Upload images
  try {
    const shapeIds = await uploadImages(resolvedFiles, startX, startY, args.layout, args.gap)
    console.log(`\nUploaded ${shapeIds.length} image(s):`)
    for (const id of shapeIds) {
      console.log(`  - ${id}`)
    }
    console.log('\nImages are now selected on canvas.')
  } catch (e: any) {
    console.error(`Error: ${e.message}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
