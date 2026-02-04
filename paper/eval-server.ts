/**
 * Eval Server - WebSocket bridge between external agents and the browser
 *
 * This server acts as a relay:
 * 1. External agents POST to /eval with { code: "..." }
 * 2. Server forwards to browser via WebSocket
 * 3. Browser executes and returns result
 * 4. Server returns result to the external agent
 *
 * Usage:
 *   npx tsx eval-server.ts
 *
 * Then external agents can:
 *   POST http://localhost:3001/eval
 *   { "code": "return editor.getCurrentPageShapes().length" }
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { WebSocketServer, WebSocket } from 'ws'

const PORT = parseInt(process.env.EVAL_PORT || '3031')

// Track connected browsers
let browserSocket: WebSocket | null = null

// Track pending requests
const pendingRequests = new Map<string, {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}>()

// Create HTTP server for the REST API
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      browserConnected: browserSocket !== null && browserSocket.readyState === WebSocket.OPEN,
    }))
    return
  }

  // Eval endpoint
  if (req.method === 'POST' && req.url === '/eval') {
    // Check if browser is connected
    if (!browserSocket || browserSocket.readyState !== WebSocket.OPEN) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: false,
        error: 'No browser connected. Open tldraw in your browser first.',
      }))
      return
    }

    // Read request body
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }

    try {
      const { code, timeout = 30000 } = JSON.parse(body)

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: 'Missing "code" field' }))
        return
      }

      // Generate request ID
      const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

      // Create promise for the response
      const responsePromise = new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          pendingRequests.delete(id)
          reject(new Error(`Request timed out after ${timeout}ms`))
        }, timeout)

        pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle })
      })

      // Send to browser
      browserSocket.send(JSON.stringify({ id, code }))

      // Wait for response
      const response = await responsePromise

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(response))
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: false,
        error: e.message || String(e),
      }))
    }
    return
  }

  // API documentation
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>tldraw Eval Server</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; border-radius: 4px; }
    code { background: #f5f5f5; padding: 0.2rem 0.4rem; border-radius: 2px; }
    h1 { color: #333; }
    h2 { color: #666; margin-top: 2rem; }
    .status { padding: 0.5rem 1rem; border-radius: 4px; display: inline-block; }
    .connected { background: #d4edda; color: #155724; }
    .disconnected { background: #f8d7da; color: #721c24; }
  </style>
</head>
<body>
  <h1>🎨 tldraw Eval Server</h1>
  <p>Browser status: <span id="status" class="status">checking...</span></p>

  <h2>Usage</h2>
  <p>Send POST requests to <code>/eval</code> with JavaScript code to execute in the browser:</p>

  <pre>curl -X POST http://localhost:${PORT}/eval \\
  -H "Content-Type: application/json" \\
  -d '{"code": "return getCanvasState()"}'</pre>

  <h2>Available Context</h2>
  <ul>
    <li><code>editor</code> - The tldraw Editor instance</li>
    <li><code>agent</code> - The TldrawAgent instance</li>
    <li><code>agentApp</code> - The TldrawAgentApp instance</li>
    <li><code>getCanvasState()</code> - Get shapes, bindings, viewport, selectedIds</li>
    <li><code>getScreenshot(options?)</code> - Get canvas screenshot as data URL</li>
    <li><code>executeAction(action)</code> - Execute a single agent action</li>
    <li><code>executeActions(actions)</code> - Execute multiple agent actions</li>
  </ul>

  <h2>Examples</h2>

  <h3>Get canvas state</h3>
  <pre>{"code": "return getCanvasState()"}</pre>

  <h3>Get screenshot</h3>
  <pre>{"code": "return await getScreenshot({ format: 'png' })"}</pre>

  <h3>Create a shape</h3>
  <pre>{"code": "editor.createShape({ type: 'geo', x: 100, y: 100, props: { w: 200, h: 100, geo: 'rectangle' } }); return getCanvasState()"}</pre>

  <h3>Execute agent action</h3>
  <pre>{"code": "return executeAction({ _type: 'create', shape: { type: 'geo', shapeId: 'my-rect', x: 100, y: 100, w: 200, h: 100, geo: 'rectangle', color: 'blue' } })"}</pre>

  <h3>Run arbitrary code</h3>
  <pre>{"code": "const shapes = editor.getCurrentPageShapes(); return { count: shapes.length, types: shapes.map(s => s.type) }"}</pre>

  <script>
    async function checkStatus() {
      try {
        const res = await fetch('/health')
        const data = await res.json()
        const statusEl = document.getElementById('status')
        if (data.browserConnected) {
          statusEl.textContent = '✅ Browser connected'
          statusEl.className = 'status connected'
        } else {
          statusEl.textContent = '❌ Browser not connected'
          statusEl.className = 'status disconnected'
        }
      } catch (e) {
        document.getElementById('status').textContent = '❌ Server error'
      }
    }
    checkStatus()
    setInterval(checkStatus, 2000)
  </script>
</body>
</html>
    `)
    return
  }

  res.writeHead(404)
  res.end('Not Found')
})

// Create WebSocket server for browser connection
const wss = new WebSocketServer({ server, path: '/eval' })

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  console.log('[Eval Server] Browser connected')

  // Only allow one browser connection at a time
  if (browserSocket && browserSocket.readyState === WebSocket.OPEN) {
    console.log('[Eval Server] Closing previous browser connection')
    browserSocket.close()
  }

  browserSocket = ws

  ws.on('message', (data: Buffer) => {
    try {
      const response = JSON.parse(data.toString())
      const pending = pendingRequests.get(response.id)

      if (pending) {
        clearTimeout(pending.timeout)
        pendingRequests.delete(response.id)
        pending.resolve(response)
      }
    } catch (e) {
      console.error('[Eval Server] Error parsing browser response:', e)
    }
  })

  ws.on('close', () => {
    console.log('[Eval Server] Browser disconnected')
    if (browserSocket === ws) {
      browserSocket = null
    }
  })

  ws.on('error', (error) => {
    console.error('[Eval Server] WebSocket error:', error)
  })
})

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                   tldraw Eval Server                           ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  HTTP API:    http://localhost:${PORT}                           ║
║  WebSocket:   ws://localhost:${PORT}/eval                        ║
║                                                                ║
║  Waiting for browser to connect...                             ║
║  Open tldraw in your browser to establish connection.          ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`)
})
