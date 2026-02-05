/**
 * Canvas operations for tldraw via eval server
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

/**
 * Get position below the current selection (with gap)
 * Returns null if nothing is selected
 */
export async function getPositionBelowSelection(gap: number = 100): Promise<{ x: number; y: number } | null> {
  const result = await evalCode(`
    const selectedIds = editor.getSelectedShapeIds();
    if (selectedIds.length === 0) return null;

    const bounds = editor.getSelectionPageBounds();
    if (!bounds) return null;

    return {
      x: bounds.x,
      y: bounds.y + bounds.h + ${gap}
    };
  `)
  if (!result.success || !result.result) {
    return null
  }
  return result.result
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
 * Upload an image to the canvas.
 * If targetWidth is provided, scales image to that width while preserving aspect ratio.
 * If targetHeight is provided (and no targetWidth), scales to that height.
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

    // Scale to target width while preserving aspect ratio
    if (targetWidth) {
      const scale = targetWidth / w;
      w = targetWidth;
      h = Math.round(h * scale);
    } else if (targetHeight) {
      const scale = targetHeight / h;
      h = targetHeight;
      w = Math.round(w * scale);
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
 * Select shapes on the canvas
 */
export async function selectShapes(shapeIds: string[]): Promise<boolean> {
  const code = `editor.setSelectedShapes(${JSON.stringify(shapeIds)}); return true;`
  const result = await evalCode(code)
  return result.success
}
