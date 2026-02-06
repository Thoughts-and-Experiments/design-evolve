#!/usr/bin/env npx tsx
/**
 * Export selected images from tldraw canvas
 * Usage: npx tsx scripts/export-selected-images.ts [output-dir]
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const EVAL_URL = 'http://localhost:3031/eval'

async function evalCode(code: string): Promise<any> {
  const res = await fetch(EVAL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  })
  const json = await res.json()
  if (!json.success) {
    throw new Error(json.error)
  }
  return json.result
}

async function main() {
  const outputDir = process.argv[2] || '/tmp/firefly-refs'

  // Create output directory
  mkdirSync(outputDir, { recursive: true })
  console.log(`Output directory: ${outputDir}`)

  // Get selected image shapes
  const selectedImages = await evalCode(`
    const selected = editor.getSelectedShapes()
    return selected
      .filter(s => s.type === 'image')
      .map(s => ({ id: s.id, assetId: s.props.assetId }))
  `)

  console.log(`Found ${selectedImages.length} selected images`)

  // Export each image
  for (let i = 0; i < selectedImages.length; i++) {
    const { assetId } = selectedImages[i]
    const filename = `ref${i + 1}.png`
    const filepath = join(outputDir, filename)

    console.log(`Exporting ${filename} from ${assetId}...`)

    // Get base64 data
    const base64 = await evalCode(`
      const asset = editor.getAsset('${assetId}')
      return asset.props.src.replace('data:image/png;base64,', '')
    `)

    // Decode and save
    const buffer = Buffer.from(base64, 'base64')
    writeFileSync(filepath, buffer)
    console.log(`  -> ${filepath} (${buffer.length} bytes)`)
  }

  console.log('Done!')
}

main().catch(e => {
  console.error('Error:', e)
  process.exit(1)
})
