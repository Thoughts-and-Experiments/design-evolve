/**
 * Canvas operations for tldraw via eval server
 * Based on the working upload.ts implementation
 */

const EVAL_PORT = process.env.EVAL_PORT || '3031'
const EVAL_URL = `http://localhost:${EVAL_PORT}`

interface EvalResult {
  success: boolean
  result?: any
  error?: string
}

/**
 * Execute code on the canvas via eval server
 */
export async function evalCode(code: string): Promise<EvalResult> {
  try {
    const res = await fetch(`${EVAL_URL}/eval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    return await res.json()
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

/**
 * Check eval server health
 */
export async function checkHealth(): Promise<{ ok: boolean; browserConnected: boolean }> {
  try {
    const res = await fetch(`${EVAL_URL}/health`)
    const data = (await res.json()) as { status: string; browserConnected: boolean }
    return { ok: data.status === 'ok', browserConnected: data.browserConnected }
  } catch (e) {
    return { ok: false, browserConnected: false }
  }
}

/**
 * Get viewport center coordinates
 */
export async function getViewportCenter(): Promise<{ x: number; y: number }> {
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

export interface PlaceholderOptions {
  x: number
  y: number
  w: number
  h: number
  prompt: string
  index?: number
}

/**
 * Create a placeholder rectangle on the canvas
 */
export async function createPlaceholder(options: PlaceholderOptions): Promise<string | null> {
  const { x, y, w, h, prompt, index } = options
  const displayPrompt = prompt.length > 40 ? prompt.slice(0, 37) + '...' : prompt
  const shapeId = `placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const code = `
    const shapeId = "shape:${shapeId}";

    editor.createShape({
      id: shapeId,
      type: "geo",
      x: ${x},
      y: ${y},
      props: {
        w: ${w},
        h: ${h},
        geo: "rectangle",
        color: "grey",
        fill: "semi",
        dash: "dashed",
      }
    });

    return shapeId;
  `

  const result = await evalCode(code)
  if (!result.success) {
    console.error('Failed to create placeholder:', result.error)
    return null
  }
  return result.result
}

/**
 * Update placeholder to show error state
 */
export async function markPlaceholderError(shapeId: string): Promise<boolean> {
  const code = `
    editor.updateShape({
      id: "${shapeId}",
      props: { color: "red" }
    });
    return true;
  `
  const result = await evalCode(code)
  return result.success
}

/**
 * Delete a shape by ID
 */
export async function deleteShape(shapeId: string): Promise<boolean> {
  const code = `editor.deleteShape("${shapeId}"); return true;`
  const result = await evalCode(code)
  return result.success
}

export interface UploadImageOptions {
  imageData: Buffer
  mimeType: string
  x: number
  y: number
  targetWidth?: number
  targetHeight?: number
}

/**
 * Upload an image to the canvas (same approach as upload.ts)
 */
export async function uploadImage(options: UploadImageOptions): Promise<string | null> {
  const { imageData, mimeType, x, y, targetWidth, targetHeight } = options

  const base64 = imageData.toString('base64')
  const dataUrl = `data:${mimeType};base64,${base64}`

  const code = `
    const dataUrl = ${JSON.stringify(dataUrl)};
    const targetX = ${x};
    const targetY = ${y};
    const targetWidth = ${targetWidth || 'null'};
    const targetHeight = ${targetHeight || 'null'};

    // Get image dimensions
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });

    let w = img.naturalWidth;
    let h = img.naturalHeight;

    // Scale to target dimensions if provided
    if (targetWidth && targetHeight) {
      w = targetWidth;
      h = targetHeight;
    }

    // Create asset
    const assetId = "asset:" + Math.random().toString(36).substr(2, 9);
    editor.createAssets([{
      id: assetId,
      type: "image",
      typeName: "asset",
      props: {
        name: "generated-image",
        src: dataUrl,
        w: img.naturalWidth,
        h: img.naturalHeight,
        mimeType: "${mimeType}",
        isAnimated: false,
      },
      meta: {},
    }]);

    // Create image shape
    const shapeId = "shape:" + Math.random().toString(36).substr(2, 9);
    editor.createShape({
      id: shapeId,
      type: "image",
      x: targetX,
      y: targetY,
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
    console.error('Failed to upload image:', result.error)
    return null
  }
  return result.result.shapeId
}

/**
 * Replace a placeholder with an uploaded image
 */
export async function replacePlaceholder(
  placeholderId: string,
  imageData: Buffer,
  mimeType: string
): Promise<string | null> {
  // Get placeholder position
  const posResult = await evalCode(`
    const shape = editor.getShape("${placeholderId}");
    if (!shape) return null;
    return { x: shape.x, y: shape.y, w: shape.props.w, h: shape.props.h };
  `)

  if (!posResult.success || !posResult.result) {
    return null
  }

  const { x, y, w, h } = posResult.result

  // Upload image at placeholder position
  const imageShapeId = await uploadImage({
    imageData,
    mimeType,
    x,
    y,
    targetWidth: w,
    targetHeight: h,
  })

  if (imageShapeId) {
    await deleteShape(placeholderId)
  }

  return imageShapeId
}

/**
 * Select shapes on the canvas
 */
export async function selectShapes(shapeIds: string[]): Promise<boolean> {
  const code = `editor.setSelectedShapes(${JSON.stringify(shapeIds)}); return true;`
  const result = await evalCode(code)
  return result.success
}
