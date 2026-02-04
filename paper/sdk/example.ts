/**
 * Example usage of the tldraw Eval Client SDK
 *
 * Run with: npx tsx sdk/example.ts
 *
 * Make sure to:
 * 1. Start the dev server: npm run dev
 * 2. Start the eval server: npm run eval-server
 * 3. Open tldraw in browser: http://localhost:5173
 */

import { TldrawEvalClient } from './tldraw-eval-client'

async function main() {
  const client = new TldrawEvalClient()

  // Check connection
  console.log('Checking connection...')
  const health = await client.health()
  console.log('Server status:', health)

  if (!health.browserConnected) {
    console.error('Browser not connected! Open tldraw in your browser first.')
    process.exit(1)
  }

  // Get current state
  console.log('\n--- Current Canvas State ---')
  const state = await client.getCanvasState()
  console.log(`Shapes: ${state.shapes.length}`)
  console.log(`Viewport: ${JSON.stringify(state.viewport)}`)

  // Create some shapes
  console.log('\n--- Creating Shapes ---')

  const rect1 = await client.createRectangle(100, 100, 200, 100, 'blue')
  console.log(`Created rectangle: ${rect1}`)

  const rect2 = await client.createRectangle(100, 250, 200, 100, 'red')
  console.log(`Created rectangle: ${rect2}`)

  const arrow = await client.createArrow(200, 200, 200, 250)
  console.log(`Created arrow: ${arrow}`)

  const note = await client.createNote(350, 100, 'Hello from the SDK!')
  console.log(`Created note: ${note}`)

  // Get updated state
  console.log('\n--- Updated Canvas State ---')
  const newState = await client.getCanvasState()
  console.log(`Shapes: ${newState.shapes.length}`)

  // Execute raw code
  console.log('\n--- Raw Eval Example ---')
  const result = await client.eval(`
    const shapes = editor.getCurrentPageShapes()
    return {
      count: shapes.length,
      types: [...new Set(shapes.map(s => s.type))],
      bounds: editor.getSelectionPageBounds(),
    }
  `)
  console.log('Result:', result)

  // Demonstrate agent action execution
  console.log('\n--- Agent Action Example ---')
  const actionResult = await client.executeAction({
    _type: 'create',
    shape: {
      type: 'geo',
      shapeId: 'sdk-shape',
      x: 400,
      y: 300,
      w: 150,
      h: 80,
      geo: 'cloud',
      color: 'violet',
      text: 'Agent Action!',
    },
  })
  console.log('Action result:', actionResult)

  console.log('\n✅ Example complete!')
}

main().catch(console.error)
