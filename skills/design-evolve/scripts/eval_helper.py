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
        with urlopen(req, timeout=30) as resp:
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


# ── CLI interface ──

def main():
    if len(sys.argv) < 2:
        print("Usage: python eval_helper.py <command> [args...]")
        print("Commands: eval, place-images, create-frames, screenshot, clear, zoom-to-fit, health, detect-annotations, export-clean, get-images, get-latest")
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

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
