/**
 * EvalBridge - Connects the browser to external agents via WebSocket
 *
 * This module enables external agents (like Claude running locally) to:
 * 1. Execute arbitrary JavaScript in the browser context
 * 2. Access the tldraw editor, agent, and app APIs
 * 3. Get canvas state, screenshots, and action results
 */

export interface EvalRequest {
  id: string
  code: string
}

export interface EvalResponse {
  id: string
  success: boolean
  result?: any
  error?: string
}

export interface CanvasState {
  shapes: any[]
  bindings: any[]
  viewport: { x: number; y: number; w: number; h: number }
  selectedIds: string[]
}

class EvalBridge {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000

  /**
   * Connect to the eval WebSocket server
   */
  connect(port: number = 3031) {
    const url = `ws://localhost:${port}/eval`
    console.log(`[EvalBridge] Connecting to ${url}...`)

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      console.log('[EvalBridge] Connected to eval server')
      this.reconnectAttempts = 0
    }

    this.ws.onmessage = async (event) => {
      try {
        const request: EvalRequest = JSON.parse(event.data)
        console.log(`[EvalBridge] Received eval request: ${request.id}`)
        const response = await this.handleEvalRequest(request)
        this.ws?.send(JSON.stringify(response))
      } catch (e) {
        console.error('[EvalBridge] Error handling message:', e)
      }
    }

    this.ws.onclose = () => {
      console.log('[EvalBridge] Disconnected from eval server')
      this.attemptReconnect(port)
    }

    this.ws.onerror = (error) => {
      console.error('[EvalBridge] WebSocket error:', error)
    }
  }

  private attemptReconnect(port: number) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      console.log(`[EvalBridge] Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`)
      setTimeout(() => this.connect(port), this.reconnectDelay)
    }
  }

  /**
   * Handle an eval request by executing code in the browser context
   */
  private async handleEvalRequest(request: EvalRequest): Promise<EvalResponse> {
    const { id, code } = request

    try {
      // Create a context with useful globals
      const context = {
        editor: (window as any).editor,
        agent: (window as any).agent,
        agentApp: (window as any).agentApp,
        // Helper functions
        getCanvasState: () => this.getCanvasState(),
        getScreenshot: (options?: any) => this.getScreenshot(options),
        executeAction: (action: any) => this.executeAction(action),
        executeActions: (actions: any[]) => this.executeActions(actions),
      }

      // Create an async function that has access to our context
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
      const fn = new AsyncFunction(
        ...Object.keys(context),
        `"use strict"; return (async () => { ${code} })()`
      )

      // Execute the code
      const result = await fn(...Object.values(context))

      // Serialize the result (handle non-JSON-serializable values)
      const serializedResult = this.serializeResult(result)

      return {
        id,
        success: true,
        result: serializedResult,
      }
    } catch (e: any) {
      console.error('[EvalBridge] Eval error:', e)
      return {
        id,
        success: false,
        error: e.message || String(e),
      }
    }
  }

  /**
   * Get the current canvas state
   */
  getCanvasState(): CanvasState {
    const editor = (window as any).editor
    if (!editor) {
      throw new Error('Editor not available')
    }

    const shapes = editor.getCurrentPageShapesSorted()
    const bindings = editor.getBindingsInvolvingShape ?
      shapes.flatMap((s: any) => editor.getBindingsInvolvingShape(s.id) || []) : []
    const viewport = editor.getViewportPageBounds()
    const selectedIds = editor.getSelectedShapeIds()

    return {
      shapes: shapes.map((s: any) => this.serializeShape(s)),
      bindings: bindings.map((b: any) => ({ ...b })),
      viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
      selectedIds: [...selectedIds],
    }
  }

  /**
   * Get a screenshot of the canvas
   */
  async getScreenshot(options?: {
    format?: 'png' | 'jpeg' | 'webp'
    bounds?: { x: number; y: number; w: number; h: number }
    scale?: number
  }): Promise<string> {
    const editor = (window as any).editor
    if (!editor) {
      throw new Error('Editor not available')
    }

    const shapes = editor.getCurrentPageShapesSorted()
    if (shapes.length === 0) {
      throw new Error('No shapes to screenshot')
    }

    const result = await editor.toImage(shapes, {
      format: options?.format || 'png',
      bounds: options?.bounds,
      scale: options?.scale || 1,
      background: true,
    })

    // Convert blob to data URL
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(result.blob)
    })
  }

  /**
   * Execute a single agent action
   */
  executeAction(action: any): { success: boolean; diff?: any; error?: string } {
    const agent = (window as any).agent
    if (!agent) {
      throw new Error('Agent not available')
    }

    try {
      // Import AgentHelpers dynamically to avoid circular deps
      const { AgentHelpers } = (window as any).__evalHelpers || {}
      const helpers = AgentHelpers ? new AgentHelpers(agent) : null

      // Ensure action has complete flag
      action.complete = action.complete ?? true

      const { diff } = agent.actions.act(action, helpers)
      return { success: true, diff }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  /**
   * Execute multiple agent actions
   */
  executeActions(actions: any[]): { success: boolean; diffs?: any[]; errors?: string[] } {
    const results = actions.map(action => this.executeAction(action))
    const errors = results.filter(r => !r.success).map(r => r.error!)
    const diffs = results.filter(r => r.success).map(r => r.diff)

    return {
      success: errors.length === 0,
      diffs,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Serialize a shape for JSON transport
   */
  private serializeShape(shape: any): any {
    // Create a plain object copy
    return JSON.parse(JSON.stringify(shape))
  }

  /**
   * Serialize any result for JSON transport
   */
  private serializeResult(result: any): any {
    if (result === undefined) return null
    if (result === null) return null
    if (typeof result === 'function') return '[Function]'
    if (typeof result === 'symbol') return result.toString()
    if (result instanceof Error) return { error: result.message, stack: result.stack }
    if (result instanceof Map) return Object.fromEntries(result)
    if (result instanceof Set) return [...result]

    try {
      // Try to JSON stringify and parse to get a clean copy
      return JSON.parse(JSON.stringify(result))
    } catch {
      return String(result)
    }
  }

  /**
   * Disconnect from the eval server
   */
  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

// Export singleton instance
export const evalBridge = new EvalBridge()

// Auto-connect in development
if (import.meta.env.DEV) {
  // Wait for the app to be ready
  const checkAndConnect = () => {
    if ((window as any).editor) {
      evalBridge.connect()
    } else {
      setTimeout(checkAndConnect, 100)
    }
  }
  checkAndConnect()
}
