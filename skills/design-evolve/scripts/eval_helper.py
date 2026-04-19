"""
Eval helper for tldraw canvas operations via the eval server.

Usage from other scripts:
    from eval_helper import eval_code, place_image, create_frames, screenshot_region

Usage from CLI:
    python eval_helper.py eval "editor.zoomToFit(); return 'ok'"
    python eval_helper.py place-images /tmp/generate-123 --display-width 400
    python eval_helper.py create-frames
    python eval_helper.py screenshot shape:frame-0 /tmp/screenshot.png
    python eval_helper.py clear
    python eval_helper.py zoom-to-fit
"""

import json
import sys
import base64
import os
import glob as globmod
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError

EVAL_URL = os.environ.get("EVAL_URL", "http://localhost:3031")


def eval_code(code: str) -> dict:
    """Execute JS code on the canvas via eval server. Returns {success, result?, error?}."""
    req = Request(
        f"{EVAL_URL}/eval",
        data=json.dumps({"code": code}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except URLError as e:
        return {"success": False, "error": str(e)}


def health_check() -> dict:
    """Check eval server health."""
    try:
        with urlopen(f"{EVAL_URL}/health", timeout=5) as resp:
            return json.loads(resp.read())
    except URLError as e:
        return {"status": "error", "error": str(e)}


def clear_canvas() -> dict:
    """Delete all shapes on the current page."""
    return eval_code(
        "const shapes = Array.from(editor.getCurrentPageShapes()); "
        "if (shapes.length > 0) { editor.deleteShapes(shapes.map(s => s.id)); } "
        "return { cleared: shapes.length }"
    )


def zoom_to_fit() -> dict:
    """Zoom canvas to fit all content."""
    return eval_code('editor.zoomToFit(); return "ok"')


def get_images() -> list:
    """Get all image shapes on canvas, sorted by y position."""
    result = eval_code(
        "const images = Array.from(editor.getCurrentPageShapes())"
        ".filter(s => s.type === 'image').sort((a, b) => a.y - b.y); "
        "return images.map(s => ({ id: String(s.id), x: s.x, y: s.y, "
        "w: s.props.w, h: s.props.h, assetId: String(s.props.assetId) }))"
    )
    if result.get("success"):
        return result["result"]
    return []


def place_image(image_path: str, display_width: int = 400, shape_id: str = None, x: float = None, y: float = None) -> dict:
    """
    Place an image on the canvas.
    If x/y not provided, places below the last image with a 160px gap.
    If shape_id not provided, generates a random one.
    Returns {shapeId, w, h, yPos}.
    """
    img_b64 = base64.b64encode(Path(image_path).read_bytes()).decode()
    data_url = f"data:image/png;base64,{img_b64}"

    sid_part = shape_id or f"img-{os.urandom(4).hex()}"
    asset_id_part = f"asset-{os.urandom(4).hex()}"

    # Build placement code
    if x is not None and y is not None:
        pos_code = f"const xPos = {x}; const yPos = {y};"
    else:
        pos_code = (
            "const existing = Array.from(editor.getCurrentPageShapes()).filter(s => s.type === 'image'); "
            "let yPos = 100; const xPos = 100; "
            "if (existing.length > 0) { let maxBottom = 0; "
            "for (const s of existing) { const bottom = s.y + s.props.h; if (bottom > maxBottom) maxBottom = bottom; } "
            "yPos = maxBottom + 160; }"
        )

    code = (
        f"const dataUrl = {json.dumps(data_url)}; "
        "const img = new Image(); "
        "await new Promise((r,e) => { img.onload = r; img.onerror = e; img.src = dataUrl; }); "
        f"const scale = {display_width} / img.naturalWidth; "
        f"const w = {display_width}; const h = Math.round(img.naturalHeight * scale); "
        f"{pos_code} "
        f"const assetId = 'asset:{asset_id_part}'; "
        f"const shapeId = 'shape:{sid_part}'; "
        "editor.createAssets([{ id: assetId, type: 'image', typeName: 'asset', "
        "props: { name: shapeId, src: dataUrl, w: img.naturalWidth, h: img.naturalHeight, "
        "mimeType: 'image/png', isAnimated: false }, meta: {} }]); "
        "editor.createShape({ id: shapeId, type: 'image', x: xPos, y: yPos, "
        "props: { assetId: assetId, w: w, h: h } }); "
        "return { shapeId, w, h, yPos, xPos }"
    )
    return eval_code(code)


def place_images(src_dir: str, display_width: int = 400) -> list:
    """Place all PNG images from a directory onto the canvas. Returns list of results."""
    files = sorted(globmod.glob(os.path.join(src_dir, "*.png")))
    results = []
    for i, img_file in enumerate(files):
        print(f"Placing image {i+1}/{len(files)}: {os.path.basename(img_file)}")
        result = place_image(img_file, display_width, shape_id=f"seed-img-{i+1}")
        results.append(result)
        if not result.get("success"):
            print(f"  ERROR: {result.get('error')}")
        else:
            print(f"  OK: {result['result']}")
    return results


def create_frames(padding: int = 60, top_padding: int = 80, prefix: str = "", iter_label: str = "") -> dict:
    """
    Create labeled frame rectangles around all images on canvas.
    prefix: e.g. "iter1-" for evolution frames.
    iter_label: e.g. " — Iter 1" appended to label text.
    """
    code = (
        "const images = Array.from(editor.getCurrentPageShapes())"
        ".filter(s => s.type === 'image').sort((a, b) => a.y - b.y); "
        f"const padding = {padding}; const topPadding = {top_padding}; "
        "const frameIds = []; const labelIds = []; "
        "for (let i = 0; i < images.length; i++) { "
        "const img = images[i]; "
        f"const frameId = 'shape:frame-{prefix}' + i; "
        f"const labelId = 'shape:label-{prefix}' + i; "
        "frameIds.push(frameId); labelIds.push(labelId); "
        "editor.createShape({ id: frameId, type: 'geo', "
        "x: img.x - padding, y: img.y - topPadding, "
        "props: { w: img.props.w + padding * 2, h: img.props.h + topPadding + padding, "
        "geo: 'rectangle', fill: 'none', color: 'grey', dash: 'solid', size: 's' } }); "
        "editor.createShape({ id: labelId, type: 'text', "
        "x: img.x + img.props.w / 2, y: img.y - topPadding + 8, "
        "props: { color: 'grey', size: 's', textAlign: 'middle', autoSize: true, "
        "richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', "
        f"text: 'Candidate ' + (i + 1) + '{iter_label}' }}] }}] }} }} }}); "
        "editor.sendToBack([frameId]); } "
        "return { frameIds, labelIds, count: images.length }"
    )
    return eval_code(code)


def detect_annotations() -> list:
    """Detect user annotations inside candidate frames. Returns list of candidates with annotation info."""
    code = (
        "editor.zoomToFit(); "
        "const allShapes = Array.from(editor.getCurrentPageShapes()); "
        "const frames = allShapes.filter(s => String(s.id).startsWith('shape:frame-')); "
        "const labels = allShapes.filter(s => String(s.id).startsWith('shape:label-')); "
        "const images = allShapes.filter(s => s.type === 'image').sort((a, b) => a.y - b.y); "
        "const excludeIds = new Set([...frames.map(s => s.id), ...labels.map(s => s.id), "
        "...images.map(s => s.id), "
        "...allShapes.filter(s => String(s.id).startsWith('shape:evolve-arrow-')).map(s => s.id)]); "
        "const results = []; "
        "for (let i = 0; i < frames.length; i++) { "
        "const frame = frames[i]; "
        "const fb = editor.getShapePageBounds(frame.id); "
        "if (!fb) continue; "
        "const annotations = allShapes.filter(s => { "
        "if (excludeIds.has(s.id)) return false; "
        "const sb = editor.getShapePageBounds(s.id); "
        "if (!sb) return false; "
        "return sb.x < fb.x + fb.w && sb.x + sb.w > fb.x && sb.y < fb.y + fb.h && sb.y + sb.h > fb.y; "
        "}); "
        "const textAnnotations = []; "
        "for (const s of annotations) { "
        "if (s.props && s.props.richText && s.props.richText.content) { "
        "for (const block of s.props.richText.content) { "
        "if (block.content) { for (const inline of block.content) { "
        "if (inline.text) textAnnotations.push(inline.text); } } } } } "
        "results.push({ candidateIndex: i, "
        "imageId: images[i] ? String(images[i].id) : null, "
        "frameId: String(frame.id), "
        "hasAnnotations: annotations.length > 0, "
        "annotationCount: annotations.length, "
        "textAnnotations: textAnnotations, "
        "annotationIds: annotations.map(s => String(s.id)) }); } "
        "return results;"
    )
    result = eval_code(code)
    if result.get("success"):
        return result["result"]
    return []


def screenshot_region(frame_id: str, output_path: str) -> bool:
    """Screenshot a frame region and save to file. Returns True on success."""
    code = (
        "editor.zoomToFit(); "
        f"const fb = editor.getShapePageBounds('{frame_id}'); "
        "if (!fb) return null; "
        "const dataUrl = await getScreenshot({ format: 'png', bounds: fb, scale: 1 }); "
        "return dataUrl;"
    )
    result = eval_code(code)
    if not result.get("success") or not result.get("result"):
        print(f"Screenshot failed for {frame_id}: {result.get('error', 'no result')}")
        return False

    data_url = result["result"]
    # Strip data URL prefix
    if "," in data_url:
        b64_data = data_url.split(",", 1)[1]
    else:
        b64_data = data_url
    Path(output_path).write_bytes(base64.b64decode(b64_data))
    print(f"Saved screenshot: {output_path}")
    return True


def export_clean_image(image_shape_id: str, output_path: str) -> bool:
    """Export the original clean image (no annotations) from a canvas image shape."""
    code = (
        "const images = Array.from(editor.getCurrentPageShapes()).filter(s => s.type === 'image'); "
        f"const shape = images.find(s => String(s.id) === '{image_shape_id}'); "
        "if (!shape) return null; "
        "const asset = editor.getAsset(shape.props.assetId); "
        "if (!asset) return null; "
        "return asset.props.src;"
    )
    result = eval_code(code)
    if not result.get("success") or not result.get("result"):
        print(f"Export failed for {image_shape_id}: {result.get('error', 'no result')}")
        return False

    data_url = result["result"]
    if "," in data_url:
        b64_data = data_url.split(",", 1)[1]
    else:
        b64_data = data_url
    Path(output_path).write_bytes(base64.b64decode(b64_data))
    print(f"Exported clean image: {output_path}")
    return True


def place_evolved_image(image_path: str, orig_shape_id: str, iteration: int, candidate_num: int, gap: int = 120) -> dict:
    """
    Place an evolved image to the right of its original, with arrow and frame.
    Queries the original image's actual position from canvas — no hardcoded positions.
    """
    img_b64 = base64.b64encode(Path(image_path).read_bytes()).decode()
    data_url = f"data:image/png;base64,{img_b64}"
    i = candidate_num - 1  # 0-indexed

    code = (
        "const allImages = Array.from(editor.getCurrentPageShapes()).filter(s => s.type === 'image'); "
        f"const orig = allImages.find(s => String(s.id) === '{orig_shape_id}'); "
        f"if (!orig) return 'original not found: {orig_shape_id}'; "
        f"const dataUrl = {json.dumps(data_url)}; "
        "const img = new Image(); "
        "await new Promise((r,e) => { img.onload = r; img.onerror = e; img.src = dataUrl; }); "
        "const displayW = orig.props.w; "
        "const scale = displayW / img.naturalWidth; "
        "const displayH = Math.round(img.naturalHeight * scale); "
        f"const newX = orig.x + orig.props.w + {gap}; "
        "const newY = orig.y; "
        f"const newShapeId = 'shape:evolved-{iteration}-{candidate_num}-' + Math.random().toString(36).substr(2, 6); "
        f"const newAssetId = 'asset:evolved-{iteration}-{candidate_num}-' + Math.random().toString(36).substr(2, 6); "
        "editor.createAssets([{ id: newAssetId, type: 'image', typeName: 'asset', "
        f"props: {{ name: 'evolved-{iteration}-{candidate_num}', src: dataUrl, "
        "w: img.naturalWidth, h: img.naturalHeight, mimeType: 'image/png', isAnimated: false }, meta: {} }]); "
        "editor.createShape({ id: newShapeId, type: 'image', x: newX, y: newY, "
        "props: { assetId: newAssetId, w: displayW, h: displayH } }); "
        "const arrowX = orig.x + orig.props.w; "
        "const arrowY = orig.y + orig.props.h / 2; "
        f"editor.createShape({{ id: 'shape:evolve-arrow-{iteration}-{i}', type: 'arrow', "
        "x: arrowX, y: arrowY, "
        f"props: {{ start: {{ x: 0, y: 0 }}, end: {{ x: {gap - 20}, y: 0 }}, "
        "color: 'grey', arrowheadEnd: 'arrow', "
        f"richText: {{ type: 'doc', content: [{{ type: 'paragraph', content: [{{ type: 'text', text: 'Iter {iteration}' }}] }}] }} }} }}); "
        "const padding = 60; const topPadding = 80; "
        f"const frameId = 'shape:frame-iter{iteration}-{i}'; "
        f"const labelId = 'shape:label-iter{iteration}-{i}'; "
        "editor.createShape({ id: frameId, type: 'geo', "
        "x: newX - padding, y: newY - topPadding, "
        "props: { w: displayW + padding * 2, h: displayH + topPadding + padding, "
        "geo: 'rectangle', fill: 'none', color: 'grey', dash: 'solid', size: 's' } }); "
        "editor.createShape({ id: labelId, type: 'text', "
        "x: newX + displayW / 2, y: newY - topPadding + 8, "
        "props: { color: 'grey', size: 's', textAlign: 'middle', autoSize: true, "
        f"richText: {{ type: 'doc', content: [{{ type: 'paragraph', content: [{{ type: 'text', text: 'Candidate {candidate_num} — Iter {iteration}' }}] }}] }} }} }}); "
        "editor.sendToBack([frameId]); "
        "return { newShapeId, newX, newY, displayW, displayH }"
    )
    return eval_code(code)


def save_snapshot(file_path: str) -> dict:
    """
    Dump the entire current tldraw canvas to a .tldr JSON file on disk.
    The file has the format {store, schema} — ready to be loaded back later
    with load_snapshot. Safe, non-destructive.
    """
    result = eval_code(
        "const snap = editor.store.getStoreSnapshot(); return JSON.stringify(snap);"
    )
    if not result.get("success"):
        return {"error": result.get("error", "eval failed")}
    snap_text = result.get("result") or ""
    if not snap_text:
        return {"error": "empty snapshot"}
    Path(file_path).write_text(snap_text)
    try:
        parsed = json.loads(snap_text)
        records = len(parsed.get("store", parsed))
    except Exception:
        records = -1
    return {"saved": file_path, "bytes": len(snap_text), "records": records}


def load_snapshot(file_path: str) -> dict:
    """
    Load a .tldr JSON file back into the canvas, replacing the entire store.
    DESTRUCTIVE: wipes the current canvas state. Call save_snapshot first
    if you want a rollback.
    """
    path = Path(file_path)
    if not path.exists():
        return {"error": f"file not found: {file_path}"}
    try:
        snap_data = json.loads(path.read_text())
    except Exception as e:
        return {"error": f"failed to parse snapshot: {e}"}
    if "store" not in snap_data or "schema" not in snap_data:
        return {"error": "invalid snapshot — expected top-level 'store' and 'schema' keys"}
    # Embed the parsed JSON inline as a JS object literal (json.dumps produces valid JS)
    code = (
        f"const snapData = {json.dumps(snap_data)}; "
        "editor.store.loadStoreSnapshot(snapData); "
        "editor.zoomToFit(); "
        "return { loaded: true, records: Object.keys(snapData.store).length };"
    )
    return eval_code(code)


def _parse_aspect_ratio(ar: str) -> tuple:
    """Parse '9:16' → (9.0, 16.0). Defaults to (16, 9) on bad input."""
    try:
        w, h = ar.split(":")
        return float(w), float(h)
    except Exception:
        return 16.0, 9.0


def place_placeholders(n: int, display_width: int = 400, aspect_ratio: str = "16:9",
                       start_x: float = 100, start_y: float = 100, gap: int = 160) -> dict:
    """
    Create N placeholder frames + dashed gray 'Generating…' boxes in a column.
    Each placeholder has a stable ID so swap_placeholder can find it later.
    Frames and labels are created upfront — no separate create_frames call needed.
    """
    w_ratio, h_ratio = _parse_aspect_ratio(aspect_ratio)
    display_height = int(round(display_width * h_ratio / w_ratio))

    code = (
        f"const n = {n}; const dw = {display_width}; const dh = {display_height}; "
        f"const gap = {gap}; const startX = {start_x}; const startY = {start_y}; "
        "const padding = 60; const topPadding = 80; "
        "const placeholderIds = []; const frameIds = []; const labelIds = []; const loadingIds = []; "
        "for (let i = 0; i < n; i++) { "
        "const x = startX; "
        "const y = startY + i * (dh + gap + topPadding + padding); "
        "const phId = 'shape:placeholder-' + (i + 1); "
        "const loadingId = 'shape:loading-' + (i + 1); "
        "const frameId = 'shape:frame-' + i; "
        "const labelId = 'shape:label-' + i; "
        "editor.createShape({ id: phId, type: 'geo', x: x, y: y, "
        "props: { w: dw, h: dh, geo: 'rectangle', fill: 'semi', color: 'grey', dash: 'dashed', size: 's' } }); "
        "editor.createShape({ id: loadingId, type: 'text', "
        "x: x + dw / 2 - 60, y: y + dh / 2 - 14, "
        "props: { color: 'grey', size: 'm', textAlign: 'middle', autoSize: true, "
        "richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Generating…' }] }] } } }); "
        "editor.createShape({ id: frameId, type: 'geo', "
        "x: x - padding, y: y - topPadding, "
        "props: { w: dw + padding * 2, h: dh + topPadding + padding, "
        "geo: 'rectangle', fill: 'none', color: 'grey', dash: 'solid', size: 's' } }); "
        "editor.createShape({ id: labelId, type: 'text', "
        "x: x + dw / 2 - 50, y: y - topPadding + 8, "
        "props: { color: 'grey', size: 's', textAlign: 'middle', autoSize: true, "
        "richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Candidate ' + (i + 1) }] }] } } }); "
        "editor.sendToBack([frameId]); "
        "placeholderIds.push(phId); frameIds.push(frameId); labelIds.push(labelId); loadingIds.push(loadingId); "
        "} "
        "editor.zoomToFit(); "
        "return { placeholderIds, frameIds, labelIds, loadingIds, count: n, displayWidth: dw, displayHeight: dh };"
    )
    return eval_code(code)


def swap_placeholder(candidate_num: int, image_path: str, display_width: int = 400, prefix: str = "seed") -> dict:
    """
    Replace placeholder N (1-indexed) with the real generated image.
    Keeps the frame and label; deletes the gray box + 'Generating…' text.
    Creates the real image as shape:{prefix}-img-{N} so downstream commands work.
    Use different prefixes per round to keep old images (additive).
    """
    img_b64 = base64.b64encode(Path(image_path).read_bytes()).decode()
    data_url = f"data:image/png;base64,{img_b64}"

    ph_id = f"shape:placeholder-{candidate_num}"
    loading_id = f"shape:loading-{candidate_num}"
    img_id = f"shape:{prefix}-img-{candidate_num}"
    asset_id = f"asset:{prefix}-img-{candidate_num}-{os.urandom(4).hex()}"

    code = (
        f"const dataUrl = {json.dumps(data_url)}; "
        f"const phId = '{ph_id}'; const loadingId = '{loading_id}'; "
        f"const imgId = '{img_id}'; const assetId = '{asset_id}'; "
        "const ph = editor.getShape(phId); "
        "if (!ph) return { error: 'placeholder not found: ' + phId }; "
        "const x = ph.x; const y = ph.y; "
        "const img = new Image(); "
        "await new Promise((r, e) => { img.onload = r; img.onerror = e; img.src = dataUrl; }); "
        f"const scale = {display_width} / img.naturalWidth; "
        f"const w = {display_width}; const h = Math.round(img.naturalHeight * scale); "
        "editor.createAssets([{ id: assetId, type: 'image', typeName: 'asset', "
        "props: { name: imgId, src: dataUrl, w: img.naturalWidth, h: img.naturalHeight, "
        "mimeType: 'image/png', isAnimated: false }, meta: {} }]); "
        "editor.createShape({ id: imgId, type: 'image', x: x, y: y, "
        "props: { assetId: assetId, w: w, h: h } }); "
        "editor.deleteShapes([phId, loadingId]); "
        "return { imgId, w, h, x, y };"
    )
    return eval_code(code)


def place_evolve_placeholders(orig_shape_ids: list, iteration: int, display_width: int = 400,
                              aspect_ratio: str = "16:9", gap: int = 120) -> dict:
    """
    For each original shape ID, drop a placeholder + frame + arrow to its right,
    ready for the evolve round's image to swap in.
    """
    w_ratio, h_ratio = _parse_aspect_ratio(aspect_ratio)
    display_height = int(round(display_width * h_ratio / w_ratio))
    orig_ids_json = json.dumps(orig_shape_ids)

    code = (
        f"const origIds = {orig_ids_json}; const iter = {iteration}; "
        f"const dw = {display_width}; const dh = {display_height}; const gap = {gap}; "
        "const padding = 60; const topPadding = 80; "
        "const results = []; "
        "for (let i = 0; i < origIds.length; i++) { "
        "const orig = editor.getShape(origIds[i]); "
        "if (!orig) { results.push({ error: 'orig not found', id: origIds[i] }); continue; } "
        "const x = orig.x + orig.props.w + gap; "
        "const y = orig.y; "
        "const phId = 'shape:evolve-ph-' + iter + '-' + (i + 1); "
        "const loadingId = 'shape:evolve-loading-' + iter + '-' + (i + 1); "
        "const frameId = 'shape:frame-iter' + iter + '-' + i; "
        "const labelId = 'shape:label-iter' + iter + '-' + i; "
        "const arrowId = 'shape:evolve-arrow-' + iter + '-' + i; "
        "editor.createShape({ id: phId, type: 'geo', x: x, y: y, "
        "props: { w: dw, h: dh, geo: 'rectangle', fill: 'semi', color: 'grey', dash: 'dashed', size: 's' } }); "
        "editor.createShape({ id: loadingId, type: 'text', "
        "x: x + dw / 2 - 60, y: y + dh / 2 - 14, "
        "props: { color: 'grey', size: 'm', textAlign: 'middle', autoSize: true, "
        "richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Generating…' }] }] } } }); "
        "editor.createShape({ id: frameId, type: 'geo', "
        "x: x - padding, y: y - topPadding, "
        "props: { w: dw + padding * 2, h: dh + topPadding + padding, "
        "geo: 'rectangle', fill: 'none', color: 'grey', dash: 'solid', size: 's' } }); "
        "editor.createShape({ id: labelId, type: 'text', "
        "x: x + dw / 2 - 80, y: y - topPadding + 8, "
        "props: { color: 'grey', size: 's', textAlign: 'middle', autoSize: true, "
        "richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Candidate ' + (i + 1) + ' — Iter ' + iter }] }] } } }); "
        "const arrowX = orig.x + orig.props.w; "
        "const arrowY = orig.y + orig.props.h / 2; "
        "editor.createShape({ id: arrowId, type: 'arrow', x: arrowX, y: arrowY, "
        "props: { start: { x: 0, y: 0 }, end: { x: gap - 20, y: 0 }, "
        "color: 'grey', arrowheadEnd: 'arrow', "
        "richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Iter ' + iter }] }] } } }); "
        "editor.sendToBack([frameId]); "
        "results.push({ placeholderId: phId, frameId: frameId, labelId: labelId, x: x, y: y, w: dw, h: dh }); "
        "} "
        "editor.zoomToFit(); "
        "return { results: results, count: results.length };"
    )
    return eval_code(code)


def swap_evolve_placeholder(iteration: int, candidate_num: int, image_path: str, display_width: int = 400) -> dict:
    """Replace an evolve placeholder with the real generated image."""
    img_b64 = base64.b64encode(Path(image_path).read_bytes()).decode()
    data_url = f"data:image/png;base64,{img_b64}"

    ph_id = f"shape:evolve-ph-{iteration}-{candidate_num}"
    loading_id = f"shape:evolve-loading-{iteration}-{candidate_num}"
    rand = os.urandom(4).hex()
    img_id = f"shape:evolved-{iteration}-{candidate_num}-{rand}"
    asset_id = f"asset:evolved-{iteration}-{candidate_num}-{rand}"

    code = (
        f"const dataUrl = {json.dumps(data_url)}; "
        f"const phId = '{ph_id}'; const loadingId = '{loading_id}'; "
        f"const imgId = '{img_id}'; const assetId = '{asset_id}'; "
        "const ph = editor.getShape(phId); "
        "if (!ph) return { error: 'placeholder not found: ' + phId }; "
        "const x = ph.x; const y = ph.y; "
        "const img = new Image(); "
        "await new Promise((r, e) => { img.onload = r; img.onerror = e; img.src = dataUrl; }); "
        f"const scale = {display_width} / img.naturalWidth; "
        f"const w = {display_width}; const h = Math.round(img.naturalHeight * scale); "
        "editor.createAssets([{ id: assetId, type: 'image', typeName: 'asset', "
        f"props: {{ name: 'evolved-{iteration}-{candidate_num}', src: dataUrl, "
        "w: img.naturalWidth, h: img.naturalHeight, mimeType: 'image/png', isAnimated: false }, meta: {} }]); "
        "editor.createShape({ id: imgId, type: 'image', x: x, y: y, "
        "props: { assetId: assetId, w: w, h: h } }); "
        "editor.deleteShapes([phId, loadingId]); "
        "return { imgId, w, h, x, y };"
    )
    return eval_code(code)


def mark_placeholder_failed(candidate_num: int, iteration: int = 0) -> dict:
    """Update a placeholder's loading label to show failure. iteration=0 for seed round."""
    if iteration == 0:
        loading_id = f"shape:loading-{candidate_num}"
    else:
        loading_id = f"shape:evolve-loading-{iteration}-{candidate_num}"
    code = (
        f"const loadingId = '{loading_id}'; "
        "const shape = editor.getShape(loadingId); "
        "if (!shape) return { error: 'loading label not found: ' + loadingId }; "
        "editor.updateShape({ id: loadingId, type: 'text', "
        "props: { color: 'red', "
        "richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Failed — retry' }] }] } } }); "
        "return { updated: loadingId };"
    )
    return eval_code(code)


def inject_overlay(eval_url: str = None) -> dict:
    """Inject status overlay into the browser.

    Only one element: #de-overlay — top-center status pill, status ONLY,
    no buttons. The 'Send Context' action lives in the canvas right-click
    menu (CustomContextMenu.tsx), so the overlay is purely informational.
    """
    url = eval_url or EVAL_URL
    code = f'''
    // -------------------------------------------------------------
    // NUCLEAR GHOST SWEEP — remove any stale pill/button from prior
    // injections, regardless of how it was tagged. We match on:
    //   1. Our known ids / data attributes
    //   2. Known status phrases the skill has ever POSTed to /status
    //   3. Any fixed-position top/bottom overlay containing "Send Context"
    // Logs what was swept so the source of ghosts becomes visible in
    // the browser console.
    // -------------------------------------------------------------
    const KNOWN_PHRASES = [
      'Send Context',
      'Reading your annotations',
      'Waiting for your brief',
      'Ready for feedback',
      'Session paused',
      'Screenshots placed'
    ];
    const DE_SELECTORS = [
      '#de-overlay', '[data-de-overlay]',
      '#de-status', '[data-de-status]',
      '#de-feedback', '[data-de-feedback]',
      '#de-toast', '[data-de-toast]'
    ];

    function isCandidateGhost(el) {{
      try {{
        if (!el || el.nodeType !== 1) return false;
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed') return false;
        const r = el.getBoundingClientRect();
        // pill-like: short height, at top or bottom of viewport
        const atEdge = r.top < 100 || r.bottom > window.innerHeight - 100;
        if (!atEdge) return false;
        if (r.height > 120 || r.width < 60) return false;
        const t = (el.innerText || '').trim();
        for (const p of KNOWN_PHRASES) {{ if (t.includes(p)) return true; }}
        return false;
      }} catch (e) {{ return false; }}
    }}

    const swept = [];
    DE_SELECTORS.forEach(sel => {{
      document.querySelectorAll(sel).forEach(el => {{ swept.push(el.id || el.tagName); el.remove(); }});
    }});
    // Broader sweep: every element on the page, not just body direct children.
    document.querySelectorAll('body *').forEach(el => {{
      if (isCandidateGhost(el)) {{ swept.push(el.id || el.className || el.tagName); el.remove(); }}
    }});
    if (swept.length) console.log('[de] swept ghosts:', swept);

    if (window.__deStatusPoll) clearInterval(window.__deStatusPoll);

    // -------------------------------------------------------------
    // TOP STATUS PILL — status only, no buttons. Auto-hides when idle.
    // -------------------------------------------------------------
    const overlay = document.createElement('div');
    overlay.id = 'de-overlay';
    overlay.setAttribute('data-de-overlay', '1');
    overlay.innerHTML = `
      <style>
        #de-overlay {{
          position: fixed; top: 12px; left: 0; right: 0; z-index: 2147483646;
          display: flex; justify-content: center; pointer-events: none;
          font-family: system-ui, -apple-system, sans-serif;
        }}
        #de-toast {{
          pointer-events: auto;
          background: rgba(20, 20, 28, 0.94); color: #f2efe7;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px; padding: 6px 14px;
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; font-weight: 500;
          box-shadow: 0 4px 20px rgba(0,0,0,0.25);
          opacity: 0; transform: translateY(-8px);
          transition: opacity 0.25s ease, transform 0.25s ease;
          max-width: 80vw;
        }}
        #de-toast.visible {{ opacity: 1; transform: translateY(0); }}
        #de-spinner {{
          width: 14px; height: 14px; flex-shrink: 0; display: inline-flex;
          align-items: center; justify-content: center; color: #f2efe7;
        }}
        #de-spinner svg {{ width: 100%; height: 100%; }}
        #de-spinner.active svg {{ animation: de-spin 1.4s linear infinite; }}
        #de-spinner.error svg {{ color: #ef5350; }}
        #de-spinner.done svg {{ color: #66bb6a; animation: none; }}
        #de-spinner svg path {{ fill: currentColor; }}
        @keyframes de-spin {{
          from {{ transform: rotate(0deg); }}
          to {{ transform: rotate(360deg); }}
        }}
        #de-icon {{ font-size: 13px; flex-shrink: 0; opacity: 0.9; }}
        #de-icon:empty {{ display: none; }}
        #de-text {{
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 50vw;
        }}
        #de-counter {{
          opacity: 0.55; font-size: 12px; font-variant-numeric: tabular-nums;
        }}
        #de-counter:empty {{ display: none; }}
        #de-progress {{
          height: 3px; background: rgba(255,255,255,0.1);
          border-radius: 2px; width: 60px; overflow: hidden;
        }}
        #de-progress-bar {{
          height: 100%; background: #f2efe7; width: 0%; transition: width 0.3s;
        }}
      </style>
      <div id="de-toast" data-de-toast="1">
        <span id="de-spinner" class="idle">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2 L13.8 10.2 L22 12 L13.8 13.8 L12 22 L10.2 13.8 L2 12 L10.2 10.2 Z" />
          </svg>
        </span>
        <span id="de-icon"></span>
        <span id="de-text">Ready</span>
        <span id="de-counter"></span>
        <div id="de-progress" style="display:none"><div id="de-progress-bar"></div></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const EVAL_URL = {json.dumps(url)};

    // --- Status → icon mapping ---
    // Keys match the `state` sent to POST /status. Drives the emoji shown
    // alongside the Claude spinner in the toast. Extend as new states appear.
    const STATE_ICONS = {{
      idle: '',
      thinking: '',
      reading: '📖',
      scanning: '🔎',
      screenshotting: '📸',
      interpreting: '🔍',
      generating: '✨',
      evolving: '🔄',
      placing: '🎨',
      writing: '✍️',
      waiting: '⏳',
      sending: '📤',
      exporting: '📦',
      working: '',
      done: '✅',
      error: '⚠️',
      question: '❓'
    }};
    const SPINNING_STATES = new Set([
      'thinking','reading','scanning','screenshotting','interpreting',
      'generating','evolving','placing','writing','working','sending','exporting'
    ]);

    // --- Status polling + self-enforced uniqueness ---
    window.__deStatusPoll = setInterval(async () => {{
      // Aggressive ghost sweep on every tick. Same rules as injection-time
      // sweep, but also protects from any element sneaking in later.
      try {{
        document.querySelectorAll('[data-de-overlay], [data-de-feedback]').forEach(el => {{
          if (el !== overlay) el.remove();
        }});
        document.querySelectorAll('body *').forEach(el => {{
          if (el === overlay) return;
          if (overlay.contains(el)) return;
          if (el.hasAttribute && el.hasAttribute('data-de-overlay')) return;
          if (isCandidateGhost(el)) el.remove();
        }});
      }} catch (e) {{}}

      try {{
        const r = await fetch(EVAL_URL + '/status');
        const s = await r.json();
        const toast = document.getElementById('de-toast');
        const spinner = document.getElementById('de-spinner');
        const iconEl = document.getElementById('de-icon');
        const text = document.getElementById('de-text');
        const counter = document.getElementById('de-counter');
        const progress = document.getElementById('de-progress');
        const bar = document.getElementById('de-progress-bar');
        if (!toast || !spinner || !text) return;

        const state = s.state || 'idle';
        const message = s.message || '';

        // Visibility: hide when idle AND no message
        const shouldShow = state !== 'idle' || message.length > 0;
        toast.classList.toggle('visible', shouldShow);

        // Spinner animation state
        spinner.className = '';
        if (SPINNING_STATES.has(state)) spinner.classList.add('active');
        else if (state === 'done') spinner.classList.add('done');
        else if (state === 'error') spinner.classList.add('error');
        else spinner.classList.add('idle');

        // Icon (per-state emoji)
        const icon = STATE_ICONS[state] || '';
        iconEl.textContent = icon;
        iconEl.style.display = icon ? 'inline' : 'none';

        // Text
        text.textContent = message || (state === 'idle' ? 'Ready' : state);

        // Counter "3/6"
        if (s.total && s.total > 0) {{
          counter.textContent = (s.current || 0) + '/' + s.total;
          progress.style.display = 'block';
          bar.style.width = Math.round((s.current || 0) / s.total * 100) + '%';
        }} else {{
          counter.textContent = '';
          progress.style.display = 'none';
        }}

        // Auto-clear 'done'/'error' after a short beat
        if (state === 'done' || state === 'error') {{
          clearTimeout(window.__deClearTimeout);
          window.__deClearTimeout = setTimeout(() => {{
            fetch(EVAL_URL + '/status', {{
              method: 'POST',
              headers: {{'Content-Type': 'application/json'}},
              body: JSON.stringify({{ state: 'idle', message: '' }})
            }}).catch(() => {{}});
          }}, state === 'done' ? 2500 : 4000);
        }}
      }} catch {{}}
    }}, 400);

    // Send Context lives in the canvas right-click menu (CustomContextMenu.tsx),
    // which handles the POST /capture itself. No button wiring needed here.

    return {{ overlayInjected: true }};
    '''
    return eval_code(code)


def connect_session(sessions_dir: str = None) -> dict:
    """Bootstrap: health check, auto-save previous session, inject overlay."""
    import time

    if sessions_dir is None:
        sessions_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sessions")
    os.makedirs(sessions_dir, exist_ok=True)

    # 1. Health check
    health = health_check()
    if health.get("status") != "ok":
        return {"error": f"Eval server not reachable: {health}"}
    if not health.get("browserConnected"):
        return {"error": "No browser connected. Open tldraw in Chrome first."}

    # 2. Auto-save previous session if canvas has content
    result = eval_code("return editor.getCurrentPageShapes().length;")
    shape_count = result.get("result", 0) if result.get("success") else 0

    prev_saved = None
    if shape_count > 0:
        ts = time.strftime("%Y%m%d-%H%M%S")
        snap_path = os.path.join(sessions_dir, f"session-{ts}.tldr")
        save_result = save_snapshot(snap_path)
        if "error" not in save_result:
            prev_saved = snap_path

    # 3. Inject overlay
    overlay_result = inject_overlay()

    return {
        "connected": True,
        "browserConnected": True,
        "shapesOnCanvas": shape_count,
        "previousSessionSaved": prev_saved,
        "sessionsDir": sessions_dir,
        "overlay": overlay_result.get("success", False),
    }


def extract_user_assets(output_dir: str, exclude_prefixes: list = None) -> dict:
    """
    Extract user-pasted/dropped images from canvas (not skill-generated ones).
    Saves each as a PNG in output_dir. Returns list of {shapeId, path, w, h}.
    """
    if exclude_prefixes is None:
        exclude_prefixes = [
            "seed-img-", "evolved-", "placeholder-", "loading-",
            "evolve-ph-", "evolve-loading-", "demo1", "demo2",
        ]
    os.makedirs(output_dir, exist_ok=True)

    images = get_images()
    if not images:
        return {"extracted": [], "count": 0}

    extracted = []
    prefix_list = exclude_prefixes
    for img in images:
        shape_id = img["id"]
        # Strip "shape:" prefix for matching
        bare_id = shape_id.replace("shape:", "")
        # Skip skill-generated images
        skip = False
        for pfx in prefix_list:
            if bare_id.startswith(pfx):
                skip = True
                break
        if skip:
            continue

        # Export this image
        out_path = os.path.join(output_dir, f"{bare_id}.png")
        # Use resolveAssetUrl for pasted assets that might not have data URLs
        code = (
            f"const shape = editor.getShape('{shape_id}'); "
            "if (!shape) return null; "
            "const asset = editor.getAsset(shape.props.assetId); "
            "if (!asset) return null; "
            "const src = asset.props.src; "
            "if (src && src.startsWith('data:')) return src; "
            # For blob/asset URLs, resolve and fetch
            "const resolved = await editor.resolveAssetUrl(shape.props.assetId, { w: asset.props.w }); "
            "if (!resolved) return null; "
            "const resp = await fetch(resolved); "
            "const blob = await resp.blob(); "
            "return await new Promise((resolve) => { "
            "  const reader = new FileReader(); "
            "  reader.onloadend = () => resolve(reader.result); "
            "  reader.readAsDataURL(blob); "
            "});"
        )
        result = eval_code(code)
        if not result.get("success") or not result.get("result"):
            continue
        data_url = result["result"]
        if "," in data_url:
            b64_data = data_url.split(",", 1)[1]
        else:
            b64_data = data_url
        try:
            Path(out_path).write_bytes(base64.b64decode(b64_data))
            extracted.append({
                "shapeId": shape_id,
                "path": out_path,
                "w": img.get("w"),
                "h": img.get("h"),
            })
        except Exception:
            continue

    return {"extracted": extracted, "count": len(extracted)}


def extract_feedback(output_dir: str) -> dict:
    """
    Detect annotations, extract text feedback, and screenshot annotated regions.
    Returns structured feedback ready for prompt assembly.
    """
    os.makedirs(output_dir, exist_ok=True)

    annotations = detect_annotations()
    if not annotations:
        return {"candidates": [], "hasAnnotations": False}

    feedback = []
    for ann in annotations:
        if not ann.get("hasAnnotations"):
            continue
        candidate = {
            "candidateIndex": ann["candidateIndex"],
            "imageId": ann.get("imageId"),
            "frameId": ann["frameId"],
            "annotationCount": ann["annotationCount"],
            "textFeedback": ann.get("textAnnotations", []),
        }
        # Screenshot the annotated region
        screenshot_path = os.path.join(output_dir, f"feedback-candidate-{ann['candidateIndex']}.png")
        if screenshot_region(ann["frameId"], screenshot_path):
            candidate["screenshotPath"] = screenshot_path
        # Export the clean underlying image
        if ann.get("imageId"):
            clean_path = os.path.join(output_dir, f"clean-candidate-{ann['candidateIndex']}.png")
            if export_clean_image(ann["imageId"], clean_path):
                candidate["cleanImagePath"] = clean_path
        feedback.append(candidate)

    return {
        "candidates": feedback,
        "hasAnnotations": len(feedback) > 0,
        "annotatedCount": len(feedback),
        "totalCandidates": len(annotations),
    }


def list_sessions(sessions_dir: str = None) -> list:
    """List saved session snapshots."""
    if sessions_dir is None:
        sessions_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sessions")
    if not os.path.isdir(sessions_dir):
        return []
    files = sorted(globmod.glob(os.path.join(sessions_dir, "*.tldr")), reverse=True)
    result = []
    for f in files:
        stat = os.stat(f)
        result.append({
            "path": f,
            "name": os.path.basename(f),
            "bytes": stat.st_size,
        })
    return result


def get_latest_images() -> list:
    """Find the most recent (rightmost) image in each candidate row."""
    code = (
        "const images = Array.from(editor.getCurrentPageShapes()).filter(s => s.type === 'image'); "
        "const rows = {}; "
        "for (const img of images) { "
        "const rowKey = Math.round(img.y / 50) * 50; "
        "if (!rows[rowKey]) rows[rowKey] = []; "
        "rows[rowKey].push(img); } "
        "const latest = Object.values(rows).map(row => { "
        "row.sort((a, b) => b.x - a.x); "
        "return { id: String(row[0].id), x: row[0].x, y: row[0].y, "
        "w: row[0].props.w, h: row[0].props.h, assetId: String(row[0].props.assetId) }; }); "
        "latest.sort((a, b) => a.y - b.y); "
        "return latest;"
    )
    result = eval_code(code)
    if result.get("success"):
        return result["result"]
    return []


def place_trace_arrow(src_id: str, dst_id: str, arrow_id: str = None) -> dict:
    """Dotted grey arrow from src shape's right/bottom edge to dst shape's left/top edge.
    Used to show derivation: "I placed <dst> because of <src>".
    """
    aid = arrow_id or f"shape:trace-arrow-{os.urandom(4).hex()}"
    code = f'''
    const src = editor.getShape({json.dumps(src_id)});
    const dst = editor.getShape({json.dumps(dst_id)});
    if (!src || !dst) return {{ error: "shape not found", src: !!src, dst: !!dst }};
    const sb = editor.getShapePageBounds(src);
    const db = editor.getShapePageBounds(dst);
    if (!sb || !db) return {{ error: "bounds unavailable" }};
    // Start at the center of src, end at center of dst. tldraw routes the arrow.
    const startX = sb.x + sb.w / 2;
    const startY = sb.y + sb.h / 2;
    const endX = db.x + db.w / 2;
    const endY = db.y + db.h / 2;
    const ax = Math.min(startX, endX);
    const ay = Math.min(startY, endY);
    editor.createShape({{
      id: {json.dumps(aid)},
      type: "arrow",
      x: ax, y: ay,
      props: {{
        dash: "dotted",
        color: "grey",
        size: "s",
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        start: {{ x: startX - ax, y: startY - ay }},
        end:   {{ x: endX   - ax, y: endY   - ay }}
      }}
    }});
    return {{ arrowId: {json.dumps(aid)} }};
    '''
    return eval_code(code)


def place_agent_note(
    text: str,
    anchor_id: str = None,
    direction: str = "below",
    width: int = 320,
    note_id: str = None,
    kind: str = "trace",
) -> dict:
    """
    Drop an agent note (colored rectangle + text) near an anchor shape.

    kind: "trace" (orange, default) — records what the agent did.
          "question" (blue) — the agent is asking for clarification.
    direction: "below" | "right" — where to place relative to the anchor.
    """
    import time as _time
    if note_id is None:
        note_id = f"agent-note-{int(_time.time() * 1000)}"
    bg_id = f"shape:{note_id}-bg"
    tx_id = f"shape:{note_id}-tx"

    color = "blue" if kind == "question" else "orange"
    display_text = text
    if kind == "question" and not display_text.rstrip().endswith("?"):
        display_text = display_text.rstrip() + "?"

    line_count = max(2, min(12, display_text.count("\n") + 1 + len(display_text) // 40))
    height = 36 + line_count * 22

    safe_text = json.dumps(display_text)

    if anchor_id:
        positioning = (
            f"const ab = editor.getShapePageBounds('{anchor_id}'); "
            "if (!ab) return { error: 'anchor shape has no bounds' }; "
            f"const dir = '{direction}'; "
            f"const w = {width}; const h = {height}; "
            "let x, y; "
            "if (dir === 'right') { x = ab.maxX + 24; y = ab.minY; } "
            "else { x = ab.minX; y = ab.maxY + 20; } "
        )
    else:
        positioning = (
            "const vp = editor.getViewportPageBounds(); "
            f"const w = {width}; const h = {height}; "
            "const x = vp.minX + 40; const y = vp.minY + 40; "
        )

    code = (
        "editor.zoomToFit(); "
        + positioning +
        "editor.createShape({ "
        f"id: '{bg_id}', type: 'geo', x, y, "
        "props: { w, h, geo: 'rectangle', fill: 'semi', "
        f"color: '{color}', dash: 'solid', size: 's' }} }}); "
        "editor.createShape({ "
        f"id: '{tx_id}', type: 'text', "
        "x: x + 12, y: y + 10, "
        f"props: {{ w: w - 24, color: '{color}', size: 's', "
        "textAlign: 'start', autoSize: false, "
        "richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', "
        f"text: {safe_text} " "}] }] } } }); "
        f"return {{ bgId: '{bg_id}', textId: '{tx_id}', x, y, w, h }};"
    )
    result = eval_code(code)
    if result.get("success"):
        return result["result"]
    return {"error": result.get("error", "eval failed")}


# ── CLI interface ──

def main():
    if len(sys.argv) < 2:
        print("Usage: python eval_helper.py <command> [args...]")
        print("Commands: eval, place-images, create-frames, screenshot, clear, zoom-to-fit, health,")
        print("          detect-annotations, export-clean, get-images, get-latest, place-evolved,")
        print("          place-placeholders, swap-placeholder, place-evolve-placeholders,")
        print("          swap-evolve-placeholder, mark-placeholder-failed, wait-for-capture,")
        print("          connect-session, extract-user-assets, extract-feedback, list-sessions,")
        print("          set-status, clear-status, save-snapshot, load-snapshot, place-group,")
        print("          place-agent-note, place-trace-arrow")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "health":
        print(json.dumps(health_check(), indent=2))

    elif cmd == "eval":
        if len(sys.argv) < 3:
            print("Usage: python eval_helper.py eval '<js code>'")
            sys.exit(1)
        result = eval_code(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "clear":
        print(json.dumps(clear_canvas(), indent=2))

    elif cmd == "zoom-to-fit":
        print(json.dumps(zoom_to_fit(), indent=2))

    elif cmd == "get-images":
        print(json.dumps(get_images(), indent=2))

    elif cmd == "get-latest":
        print(json.dumps(get_latest_images(), indent=2))

    elif cmd == "place-images":
        if len(sys.argv) < 3:
            print("Usage: python eval_helper.py place-images <src_dir> [--display-width 400]")
            sys.exit(1)
        src_dir = sys.argv[2]
        dw = 400
        if "--display-width" in sys.argv:
            idx = sys.argv.index("--display-width")
            dw = int(sys.argv[idx + 1])
        results = place_images(src_dir, display_width=dw)
        print(f"\nPlaced {len(results)} images.")

    elif cmd == "create-frames":
        prefix = ""
        iter_label = ""
        if "--prefix" in sys.argv:
            idx = sys.argv.index("--prefix")
            prefix = sys.argv[idx + 1]
        if "--iter-label" in sys.argv:
            idx = sys.argv.index("--iter-label")
            iter_label = sys.argv[idx + 1]
        result = create_frames(prefix=prefix, iter_label=iter_label)
        print(json.dumps(result, indent=2))

    elif cmd == "detect-annotations":
        annotations = detect_annotations()
        print(json.dumps(annotations, indent=2))

    elif cmd == "screenshot":
        if len(sys.argv) < 4:
            print("Usage: python eval_helper.py screenshot <frame_id> <output_path>")
            sys.exit(1)
        screenshot_region(sys.argv[2], sys.argv[3])

    elif cmd == "export-clean":
        if len(sys.argv) < 4:
            print("Usage: python eval_helper.py export-clean <image_shape_id> <output_path>")
            sys.exit(1)
        export_clean_image(sys.argv[2], sys.argv[3])

    elif cmd == "place-evolved":
        # python eval_helper.py place-evolved <image_path> <orig_shape_id> <iteration> <candidate_num>
        if len(sys.argv) < 6:
            print("Usage: python eval_helper.py place-evolved <image_path> <orig_shape_id> <iteration> <candidate_num>")
            sys.exit(1)
        result = place_evolved_image(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
        print(json.dumps(result, indent=2))

    elif cmd == "place-placeholders":
        # python eval_helper.py place-placeholders <n> [--display-width 400] [--aspect-ratio 9:16]
        if len(sys.argv) < 3:
            print("Usage: python eval_helper.py place-placeholders <n> [--display-width 400] [--aspect-ratio 9:16]")
            sys.exit(1)
        n = int(sys.argv[2])
        dw = 400
        ar = "16:9"
        if "--display-width" in sys.argv:
            dw = int(sys.argv[sys.argv.index("--display-width") + 1])
        if "--aspect-ratio" in sys.argv:
            ar = sys.argv[sys.argv.index("--aspect-ratio") + 1]
        result = place_placeholders(n, display_width=dw, aspect_ratio=ar)
        print(json.dumps(result, indent=2))

    elif cmd == "swap-placeholder":
        # python eval_helper.py swap-placeholder <candidate_num> <image_path> [--display-width 400] [--prefix seed]
        if len(sys.argv) < 4:
            print("Usage: python eval_helper.py swap-placeholder <candidate_num> <image_path> [--display-width 400] [--prefix seed]")
            sys.exit(1)
        cn = int(sys.argv[2])
        path = sys.argv[3]
        dw = 400
        pfx = "seed"
        if "--display-width" in sys.argv:
            dw = int(sys.argv[sys.argv.index("--display-width") + 1])
        if "--prefix" in sys.argv:
            pfx = sys.argv[sys.argv.index("--prefix") + 1]
        result = swap_placeholder(cn, path, display_width=dw, prefix=pfx)
        print(json.dumps(result, indent=2))

    elif cmd == "place-evolve-placeholders":
        # python eval_helper.py place-evolve-placeholders <iteration> <orig_id_1> [<orig_id_2> ...] [--display-width 400] [--aspect-ratio 9:16]
        if len(sys.argv) < 4:
            print("Usage: python eval_helper.py place-evolve-placeholders <iteration> <orig_id_1> [<orig_id_2> ...] [--display-width 400] [--aspect-ratio 9:16]")
            sys.exit(1)
        iteration = int(sys.argv[2])
        # Collect positional orig IDs until we hit a flag
        orig_ids = []
        i = 3
        while i < len(sys.argv) and not sys.argv[i].startswith("--"):
            orig_ids.append(sys.argv[i])
            i += 1
        dw = 400
        ar = "16:9"
        if "--display-width" in sys.argv:
            dw = int(sys.argv[sys.argv.index("--display-width") + 1])
        if "--aspect-ratio" in sys.argv:
            ar = sys.argv[sys.argv.index("--aspect-ratio") + 1]
        result = place_evolve_placeholders(orig_ids, iteration, display_width=dw, aspect_ratio=ar)
        print(json.dumps(result, indent=2))

    elif cmd == "swap-evolve-placeholder":
        # python eval_helper.py swap-evolve-placeholder <iteration> <candidate_num> <image_path> [--display-width 400]
        if len(sys.argv) < 5:
            print("Usage: python eval_helper.py swap-evolve-placeholder <iteration> <candidate_num> <image_path> [--display-width 400]")
            sys.exit(1)
        iteration = int(sys.argv[2])
        cn = int(sys.argv[3])
        path = sys.argv[4]
        dw = 400
        if "--display-width" in sys.argv:
            dw = int(sys.argv[sys.argv.index("--display-width") + 1])
        result = swap_evolve_placeholder(iteration, cn, path, display_width=dw)
        print(json.dumps(result, indent=2))

    elif cmd == "save-snapshot":
        # python eval_helper.py save-snapshot <file_path>
        if len(sys.argv) < 3:
            print("Usage: python eval_helper.py save-snapshot <file_path>")
            sys.exit(1)
        result = save_snapshot(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "load-snapshot":
        # python eval_helper.py load-snapshot <file_path>
        if len(sys.argv) < 3:
            print("Usage: python eval_helper.py load-snapshot <file_path>")
            sys.exit(1)
        result = load_snapshot(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "mark-placeholder-failed":
        # python eval_helper.py mark-placeholder-failed <candidate_num> [<iteration>]
        if len(sys.argv) < 3:
            print("Usage: python eval_helper.py mark-placeholder-failed <candidate_num> [<iteration>]")
            sys.exit(1)
        cn = int(sys.argv[2])
        it = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        result = mark_placeholder_failed(cn, iteration=it)
        print(json.dumps(result, indent=2))

    elif cmd == "place-group":
        # python eval_helper.py place-group --source SHAPE_ID --count N --item-w 180 --item-h 320
        #   [--gap 20] [--padding 40] [--prefix loading] [--label "Generating"] [--color violet]
        # Finds empty space (right of source first, then below — whichever has more room),
        # drops N dashed placeholder geos, draws ONE dotted line from source to group center.
        # Prints JSON: { positions: [{id, x, y}, ...], direction: "right"|"below" }
        def arg(name, default=None, cast=str):
            if name in sys.argv:
                return cast(sys.argv[sys.argv.index(name) + 1])
            return default
        source = arg("--source")
        if not source:
            print(json.dumps({"error": "--source is required"})); sys.exit(1)
        count = arg("--count", 1, int)
        item_w = arg("--item-w", 180, int)
        item_h = arg("--item-h", 320, int)
        gap = arg("--gap", 20, int)
        padding = arg("--padding", 40, int)
        prefix = arg("--prefix", "loading")
        label = arg("--label", "Generating")
        color = arg("--color", "violet")

        js = f'''
        const sourceId = "{source}";
        const count = {count};
        const itemW = {item_w};
        const itemH = {item_h};
        const gap = {gap};
        const padding = {padding};
        const prefix = "{prefix}";
        const label = {json.dumps(label)};
        const color = "{color}";

        const groupW = count * itemW + (count - 1) * gap;
        const groupH = itemH;

        const srcBounds = editor.getShapePageBounds(sourceId);
        if (!srcBounds) return {{ error: "source shape has no bounds: " + sourceId }};

        const allShapes = Array.from(editor.getCurrentPageShapes());
        const obstacles = [];
        for (const s of allShapes) {{
          if (String(s.id) === sourceId) continue;
          const b = editor.getShapePageBounds(s.id);
          if (b) obstacles.push(b);
        }}

        function rectClear(x, y, w, h) {{
          for (const o of obstacles) {{
            if (x < o.maxX && x + w > o.minX && y < o.maxY && y + h > o.minY) return false;
          }}
          return true;
        }}

        function scanFrom(startX, startY, dx, dy, maxSteps) {{
          let x = startX, y = startY;
          for (let i = 0; i < maxSteps; i++) {{
            if (rectClear(x, y, groupW, groupH)) return {{ x, y, found: true }};
            x += dx; y += dy;
          }}
          return {{ x, y, found: false }};
        }}

        // Try RIGHT of source: align top with source, scan right
        const right = scanFrom(srcBounds.maxX + padding, srcBounds.minY, itemW + gap, 0, 60);
        // Try BELOW source: align left with source, scan down
        const below = scanFrom(srcBounds.minX, srcBounds.maxY + padding, 0, itemH + gap, 60);

        // Pick whichever found a clean spot first; if both found, prefer the one with more clearance
        let chosen, direction;
        if (right.found && below.found) {{
          // Prefer the one closer to source (smaller travel)
          const rightDist = right.x - srcBounds.maxX;
          const belowDist = below.y - srcBounds.maxY;
          if (rightDist <= belowDist) {{ chosen = right; direction = "right"; }}
          else {{ chosen = below; direction = "below"; }}
        }} else if (right.found) {{ chosen = right; direction = "right"; }}
        else if (below.found) {{ chosen = below; direction = "below"; }}
        else {{ chosen = right; direction = "right-overflow"; }}

        const positions = [];
        for (let i = 0; i < count; i++) {{
          const id = "shape:" + prefix + "-loading-" + (i + 1);
          const x = chosen.x + i * (itemW + gap);
          const y = chosen.y;
          editor.createShape({{
            id, type: "geo", x, y,
            props: {{
              geo: "rectangle", w: itemW, h: itemH,
              color, dash: "dashed", fill: "semi", size: "s",
              font: "draw", align: "middle", verticalAlign: "middle",
              richText: {{ type: "doc", content: [{{ type: "paragraph", content: [{{ type: "text", text: label + " " + (i + 1) + " of " + count + "..." }}] }}] }}
            }}
          }});
          positions.push({{ id, x, y }});
        }}

        // Draw ONE dotted connection line from source edge → group's nearest edge
        const groupCenterX = chosen.x + groupW / 2;
        const groupCenterY = chosen.y + groupH / 2;
        const srcCenterX = (srcBounds.minX + srcBounds.maxX) / 2;
        const srcCenterY = (srcBounds.minY + srcBounds.maxY) / 2;

        let startX, startY, endX, endY;
        if (direction === "right" || direction === "right-overflow") {{
          startX = srcBounds.maxX; startY = srcCenterY;
          endX = chosen.x; endY = groupCenterY;
        }} else {{
          startX = srcCenterX; startY = srcBounds.maxY;
          endX = groupCenterX; endY = chosen.y;
        }}

        const arrowId = "shape:" + prefix + "-link";
        const ax = Math.min(startX, endX);
        const ay = Math.min(startY, endY);
        editor.createShape({{
          id: arrowId, type: "arrow",
          x: ax, y: ay,
          props: {{
            dash: "dotted",
            color: "grey",
            size: "s",
            arrowheadStart: "none",
            arrowheadEnd: "none",
            start: {{ x: startX - ax, y: startY - ay }},
            end: {{ x: endX - ax, y: endY - ay }}
          }}
        }});

        editor.zoomToFit();

        return {{ positions, direction, link: arrowId, group: {{ x: chosen.x, y: chosen.y, w: groupW, h: groupH }} }};
        '''

        result = eval_code(js)
        if not result.get("success"):
            print(json.dumps({"error": result.get("error", "eval failed")})); sys.exit(1)
        print(json.dumps(result["result"], indent=2))

    elif cmd == "connect-session":
        # python eval_helper.py connect-session [--sessions-dir DIR]
        sd = None
        if "--sessions-dir" in sys.argv:
            sd = sys.argv[sys.argv.index("--sessions-dir") + 1]
        result = connect_session(sessions_dir=sd)
        print(json.dumps(result, indent=2))

    elif cmd == "extract-user-assets":
        # python eval_helper.py extract-user-assets <output_dir> [--exclude-prefix pfx1 pfx2 ...]
        if len(sys.argv) < 3:
            print("Usage: extract-user-assets <output_dir> [--exclude-prefix pfx1 pfx2 ...]")
            sys.exit(1)
        out_dir = sys.argv[2]
        excl = None
        if "--exclude-prefix" in sys.argv:
            idx = sys.argv.index("--exclude-prefix") + 1
            excl = []
            while idx < len(sys.argv) and not sys.argv[idx].startswith("--"):
                excl.append(sys.argv[idx])
                idx += 1
        result = extract_user_assets(out_dir, exclude_prefixes=excl)
        print(json.dumps(result, indent=2))

    elif cmd == "extract-feedback":
        # python eval_helper.py extract-feedback <output_dir>
        if len(sys.argv) < 3:
            print("Usage: extract-feedback <output_dir>")
            sys.exit(1)
        result = extract_feedback(sys.argv[2])
        print(json.dumps(result, indent=2))

    elif cmd == "list-sessions":
        # python eval_helper.py list-sessions [--sessions-dir DIR]
        sd = None
        if "--sessions-dir" in sys.argv:
            sd = sys.argv[sys.argv.index("--sessions-dir") + 1]
        sessions = list_sessions(sessions_dir=sd)
        print(json.dumps(sessions, indent=2))

    elif cmd == "set-status":
        # python eval_helper.py set-status <state> <message> [--current N --total N]
        # states: idle | sending | reading | working | done | error
        if len(sys.argv) < 4:
            print("Usage: set-status <state> <message> [--current N --total N]")
            sys.exit(1)
        body = {"state": sys.argv[2], "message": sys.argv[3]}
        if "--current" in sys.argv:
            body["current"] = int(sys.argv[sys.argv.index("--current") + 1])
        if "--total" in sys.argv:
            body["total"] = int(sys.argv[sys.argv.index("--total") + 1])
        req = Request(
            f"{EVAL_URL}/status",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urlopen(req, timeout=5).read()
            print(json.dumps({"ok": True, **body}))
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
            sys.exit(1)

    elif cmd == "clear-status":
        req = Request(
            f"{EVAL_URL}/status",
            data=json.dumps({"state": "idle", "message": ""}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urlopen(req, timeout=5).read()
            print(json.dumps({"ok": True}))
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
            sys.exit(1)

    elif cmd == "place-agent-note":
        # place-agent-note "<text>" [--anchor SHAPE_ID] [--direction below|right]
        #   [--width 320] [--id note-id] [--kind trace|question]
        # trace   → orange note, records what the agent did (default)
        # question → blue note, agent asking for user clarification
        if len(sys.argv) < 3:
            print("Usage: place-agent-note <text> [--anchor SHAPE_ID] [--direction below|right] [--width 320] [--id note-id] [--kind trace|question]")
            sys.exit(1)
        text = sys.argv[2]
        anchor = None
        direction = "below"
        width = 320
        note_id = None
        kind = "trace"
        if "--anchor" in sys.argv:
            anchor = sys.argv[sys.argv.index("--anchor") + 1]
        if "--direction" in sys.argv:
            direction = sys.argv[sys.argv.index("--direction") + 1]
        if "--width" in sys.argv:
            width = int(sys.argv[sys.argv.index("--width") + 1])
        if "--id" in sys.argv:
            note_id = sys.argv[sys.argv.index("--id") + 1]
        if "--kind" in sys.argv:
            kind = sys.argv[sys.argv.index("--kind") + 1]
        result = place_agent_note(
            text, anchor_id=anchor, direction=direction,
            width=width, note_id=note_id, kind=kind,
        )
        print(json.dumps(result, indent=2))

    elif cmd == "place-trace-arrow":
        # place-trace-arrow <src_shape_id> <dst_shape_id> [--id arrow-id]
        if len(sys.argv) < 4:
            print("Usage: place-trace-arrow <src_shape_id> <dst_shape_id> [--id arrow-id]")
            sys.exit(1)
        src_id = sys.argv[2]
        dst_id = sys.argv[3]
        arrow_id = None
        if "--id" in sys.argv:
            arrow_id = sys.argv[sys.argv.index("--id") + 1]
        result = place_trace_arrow(src_id, dst_id, arrow_id=arrow_id)
        print(json.dumps(result, indent=2))

    elif cmd == "wait-for-capture":
        # python eval_helper.py wait-for-capture [--timeout 120]
        import time
        timeout = 120
        if "--timeout" in sys.argv:
            timeout = int(sys.argv[sys.argv.index("--timeout") + 1])
        print(f"Waiting for capture (timeout {timeout}s)...", file=sys.stderr)
        start = time.time()
        while time.time() - start < timeout:
            try:
                req = Request(f"{EVAL_URL}/capture", method="GET")
                resp = json.loads(urlopen(req).read().decode())
                if resp.get("captured"):
                    print(json.dumps(resp, indent=2))
                    sys.exit(0)
            except Exception:
                pass
            time.sleep(2)
        print(json.dumps({"error": "timeout", "seconds": timeout}))
        sys.exit(1)

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
