# tldraw Eval API

This project includes an eval endpoint that allows external agents (like Claude running locally) to programmatically control the tldraw canvas.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Local Dev Setup                               │
│                                                                      │
│  ┌──────────────────┐     WebSocket      ┌────────────────────────┐ │
│  │  Eval Server     │◄──────────────────►│  Browser (tldraw)      │ │
│  │  :3031           │                    │  :3030                 │ │
│  │                  │                    │                        │ │
│  │  POST /eval      │   eval(code) ──►   │  window.editor         │ │
│  │  { code: "..." } │   ◄── result       │  window.agent          │ │
│  └──────────────────┘                    │  window.agentApp       │ │
│           ▲                              └────────────────────────┘ │
└───────────│──────────────────────────────────────────────────────────┘
            │
   ┌────────┴────────┐
   │  External Agent │
   │  (Claude, etc.) │
   └─────────────────┘
```

## Quick Start

```bash
# Run all servers (recommended)
just dev

# Or run individually:
just vite      # Terminal 1: tldraw on :3030
just eval      # Terminal 2: eval server on :3031

# Open browser to http://localhost:3030
```

### URLs

| Service | HTTP | HTTPS (via localhostess) |
|---------|------|--------------------------|
| tldraw | http://localhost:3030 | https://paper.localhost (NAME=paper) |
| Eval Server | http://localhost:3031 | https://paper-eval.localhost (NAME=paper-eval) |

## API Reference

### `POST /eval`

Execute JavaScript code in the browser context.

**Request:**
```json
{
  "code": "return editor.getCurrentPageShapes().length",
  "timeout": 30000
}
```

**Response:**
```json
{
  "id": "req_123",
  "success": true,
  "result": 5
}
```

### Available Context

Inside your eval code, you have access to:

| Variable | Description |
|----------|-------------|
| `editor` | The tldraw Editor instance |
| `agent` | The TldrawAgent instance |
| `agentApp` | The TldrawAgentApp instance |
| `getCanvasState()` | Get shapes, bindings, viewport, selection |
| `getScreenshot(opts?)` | Get canvas as data URL |
| `executeAction(action)` | Execute a tldraw agent action |
| `executeActions(actions)` | Execute multiple agent actions |

## Examples

### Get Canvas State

```bash
curl -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "return getCanvasState()"}'
```

### Create a Shape

```bash
curl -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "editor.createShape({ type: \"geo\", x: 100, y: 100, props: { w: 200, h: 100, geo: \"rectangle\" } }); return getCanvasState()"}'
```

### Get Screenshot

```bash
curl -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "return await getScreenshot({ format: \"png\" })"}'
```

### Execute Agent Action

```bash
curl -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{
    "code": "return executeAction({ _type: \"create\", shape: { type: \"geo\", shapeId: \"my-rect\", x: 100, y: 100, w: 200, h: 100, geo: \"rectangle\", color: \"blue\" } })"
  }'
```

### Run Complex Logic

```bash
curl -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{
    "code": "const shapes = editor.getCurrentPageShapes(); const boxes = shapes.filter(s => s.type === \"geo\"); for (const box of boxes) { editor.updateShape({ id: box.id, props: { color: \"red\" } }) }; return { updated: boxes.length }"
  }'
```

## TypeScript SDK

A TypeScript client is available at `sdk/tldraw-eval-client.ts`:

```typescript
import { TldrawEvalClient } from './sdk/tldraw-eval-client'

const client = new TldrawEvalClient()

// Create shapes
await client.createRectangle(100, 100, 200, 100, 'blue')
await client.createNote(300, 100, 'Hello!')

// Get state
const state = await client.getCanvasState()
console.log(state.shapes)

// Execute raw code
const result = await client.eval('return editor.getCurrentPageShapes().length')

// Execute agent actions
await client.executeAction({
  _type: 'create',
  shape: { type: 'geo', shapeId: 'my-shape', x: 0, y: 0, w: 100, h: 100, geo: 'rectangle' }
})
```

Run the example:
```bash
npx tsx sdk/example.ts
```

## Agent Actions

The eval endpoint supports all 25+ tldraw agent actions. Key actions:

| Action | Description |
|--------|-------------|
| `create` | Create a new shape |
| `update` | Modify shape properties |
| `delete` | Remove a shape |
| `move` | Move a shape |
| `label` | Change shape text |
| `align` | Align multiple shapes |
| `distribute` | Space shapes evenly |
| `stack` | Stack shapes with gaps |
| `resize` | Scale shapes |
| `rotate` | Rotate shapes |

See `shared/schema/AgentActionSchemas.ts` for the full schema.

## Use Cases

1. **External AI Agents**: Let Claude, GPT, or other agents manipulate the canvas
2. **Automated Testing**: Script canvas operations for tests
3. **Integrations**: Connect tldraw to other tools/workflows
4. **Batch Operations**: Run bulk operations on shapes
5. **Custom Tooling**: Build external UIs that control tldraw

## Security Note

⚠️ The eval endpoint executes arbitrary JavaScript code. Only run this in trusted local development environments. Never expose the eval server to the internet.
