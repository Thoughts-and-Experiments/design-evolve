/**
 * tldraw Eval Client SDK
 *
 * A simple client for external agents to interact with tldraw via the eval server.
 *
 * Usage:
 *   import { TldrawEvalClient } from './tldraw-eval-client'
 *   const client = new TldrawEvalClient()
 *   await client.createShape({ type: 'geo', x: 100, y: 100, w: 200, h: 100 })
 */

export interface EvalResponse<T = any> {
  id: string
  success: boolean
  result?: T
  error?: string
}

export interface CanvasState {
  shapes: Shape[]
  bindings: any[]
  viewport: { x: number; y: number; w: number; h: number }
  selectedIds: string[]
}

export interface Shape {
  id: string
  type: string
  x: number
  y: number
  props: Record<string, any>
  [key: string]: any
}

export interface CreateShapeOptions {
  type: 'geo' | 'text' | 'arrow' | 'line' | 'note' | 'image' | 'frame'
  x: number
  y: number
  w?: number
  h?: number
  props?: Record<string, any>
}

export interface AgentAction {
  _type: string
  complete?: boolean
  [key: string]: any
}

export class TldrawEvalClient {
  private baseUrl: string

  constructor(baseUrl: string = 'http://localhost:3031') {
    this.baseUrl = baseUrl
  }

  /**
   * Execute arbitrary JavaScript code in the browser context
   */
  async eval<T = any>(code: string, timeout: number = 30000): Promise<EvalResponse<T>> {
    const response = await fetch(`${this.baseUrl}/eval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, timeout }),
    })
    return response.json()
  }

  /**
   * Check if the eval server is running and browser is connected
   */
  async health(): Promise<{ status: string; browserConnected: boolean }> {
    const response = await fetch(`${this.baseUrl}/health`)
    return response.json()
  }

  // ============== Canvas State ==============

  /**
   * Get the current canvas state (shapes, bindings, viewport, selection)
   */
  async getCanvasState(): Promise<CanvasState> {
    const response = await this.eval<CanvasState>('return getCanvasState()')
    if (!response.success) throw new Error(response.error)
    return response.result!
  }

  /**
   * Get a screenshot of the canvas as a data URL
   */
  async getScreenshot(options?: {
    format?: 'png' | 'jpeg' | 'webp'
    scale?: number
  }): Promise<string> {
    const optionsStr = options ? JSON.stringify(options) : ''
    const response = await this.eval<string>(`return await getScreenshot(${optionsStr})`)
    if (!response.success) throw new Error(response.error)
    return response.result!
  }

  /**
   * Get all shapes on the current page
   */
  async getShapes(): Promise<Shape[]> {
    const state = await this.getCanvasState()
    return state.shapes
  }

  /**
   * Get a shape by ID
   */
  async getShape(id: string): Promise<Shape | null> {
    const response = await this.eval<Shape | null>(`
      const shape = editor.getShape('${id}')
      return shape ? JSON.parse(JSON.stringify(shape)) : null
    `)
    if (!response.success) throw new Error(response.error)
    return response.result ?? null
  }

  // ============== Shape Operations ==============

  /**
   * Create a new shape on the canvas
   */
  async createShape(options: CreateShapeOptions): Promise<string> {
    const shapeId = `shape:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const shape = {
      id: shapeId,
      type: options.type,
      x: options.x,
      y: options.y,
      props: {
        w: options.w ?? 100,
        h: options.h ?? 100,
        ...options.props,
      },
    }
    const response = await this.eval(`
      editor.createShape(${JSON.stringify(shape)})
      return '${shapeId}'
    `)
    if (!response.success) throw new Error(response.error)
    return response.result
  }

  /**
   * Update an existing shape
   */
  async updateShape(id: string, updates: Partial<Shape>): Promise<void> {
    const response = await this.eval(`
      editor.updateShape({ id: '${id}', ...${JSON.stringify(updates)} })
    `)
    if (!response.success) throw new Error(response.error)
  }

  /**
   * Delete a shape
   */
  async deleteShape(id: string): Promise<void> {
    const response = await this.eval(`editor.deleteShape('${id}')`)
    if (!response.success) throw new Error(response.error)
  }

  /**
   * Delete all shapes on the current page
   */
  async clearCanvas(): Promise<void> {
    const response = await this.eval(`
      const shapes = editor.getCurrentPageShapes()
      editor.deleteShapes(shapes.map(s => s.id))
    `)
    if (!response.success) throw new Error(response.error)
  }

  /**
   * Select shapes by ID
   */
  async selectShapes(ids: string[]): Promise<void> {
    const response = await this.eval(`editor.setSelectedShapes(${JSON.stringify(ids)})`)
    if (!response.success) throw new Error(response.error)
  }

  /**
   * Clear selection
   */
  async clearSelection(): Promise<void> {
    const response = await this.eval(`editor.setSelectedShapes([])`)
    if (!response.success) throw new Error(response.error)
  }

  // ============== Viewport Operations ==============

  /**
   * Get the current viewport bounds
   */
  async getViewport(): Promise<{ x: number; y: number; w: number; h: number }> {
    const state = await this.getCanvasState()
    return state.viewport
  }

  /**
   * Set the viewport to show specific bounds
   */
  async setViewport(bounds: { x: number; y: number; w: number; h: number }): Promise<void> {
    const response = await this.eval(`
      editor.setCamera({
        x: -${bounds.x},
        y: -${bounds.y},
      })
    `)
    if (!response.success) throw new Error(response.error)
  }

  /**
   * Zoom to fit all shapes
   */
  async zoomToFit(): Promise<void> {
    const response = await this.eval(`editor.zoomToFit()`)
    if (!response.success) throw new Error(response.error)
  }

  // ============== Agent Actions ==============

  /**
   * Execute a single agent action (from the tldraw agent action schema)
   */
  async executeAction(action: AgentAction): Promise<{ success: boolean; diff?: any; error?: string }> {
    const response = await this.eval(`return executeAction(${JSON.stringify(action)})`)
    if (!response.success) throw new Error(response.error)
    return response.result
  }

  /**
   * Execute multiple agent actions
   */
  async executeActions(actions: AgentAction[]): Promise<{ success: boolean; diffs?: any[]; errors?: string[] }> {
    const response = await this.eval(`return executeActions(${JSON.stringify(actions)})`)
    if (!response.success) throw new Error(response.error)
    return response.result
  }

  // ============== Agent Prompt ==============

  /**
   * Send a prompt to the tldraw agent (uses the built-in agent)
   */
  async prompt(message: string): Promise<void> {
    const response = await this.eval(`
      await agent.prompt(${JSON.stringify(message)})
    `, 120000) // 2 minute timeout for agent prompts
    if (!response.success) throw new Error(response.error)
  }

  // ============== Convenience Methods ==============

  /**
   * Create a rectangle
   */
  async createRectangle(x: number, y: number, w: number, h: number, color?: string): Promise<string> {
    return this.createShape({
      type: 'geo',
      x, y, w, h,
      props: { geo: 'rectangle', color: color ?? 'black' },
    })
  }

  /**
   * Create an ellipse
   */
  async createEllipse(x: number, y: number, w: number, h: number, color?: string): Promise<string> {
    return this.createShape({
      type: 'geo',
      x, y, w, h,
      props: { geo: 'ellipse', color: color ?? 'black' },
    })
  }

  /**
   * Create a text shape
   */
  async createText(x: number, y: number, text: string, fontSize?: 's' | 'm' | 'l' | 'xl'): Promise<string> {
    return this.createShape({
      type: 'text',
      x, y,
      props: { text, size: fontSize ?? 'm' },
    })
  }

  /**
   * Create a note (sticky note)
   */
  async createNote(x: number, y: number, text: string, color?: string): Promise<string> {
    return this.createShape({
      type: 'note',
      x, y,
      props: { text, color: color ?? 'yellow' },
    })
  }

  /**
   * Create an arrow between two points
   */
  async createArrow(
    x1: number, y1: number,
    x2: number, y2: number,
    options?: { color?: string; arrowheadStart?: string; arrowheadEnd?: string }
  ): Promise<string> {
    const shapeId = `shape:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const response = await this.eval(`
      editor.createShape({
        id: '${shapeId}',
        type: 'arrow',
        x: ${x1},
        y: ${y1},
        props: {
          start: { x: 0, y: 0 },
          end: { x: ${x2 - x1}, y: ${y2 - y1} },
          color: '${options?.color ?? 'black'}',
          arrowheadStart: '${options?.arrowheadStart ?? 'none'}',
          arrowheadEnd: '${options?.arrowheadEnd ?? 'arrow'}',
        },
      })
      return '${shapeId}'
    `)
    if (!response.success) throw new Error(response.error)
    return response.result
  }
}

// Default export for convenience
export default TldrawEvalClient
