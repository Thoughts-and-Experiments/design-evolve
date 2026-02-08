---
name: design-evolve
description: |
  Iterative visual design workflow on tldraw canvas. Use when the user invokes /design-evolve to:
  (1) Generate seed UI candidates from a description
  (2) Let the user annotate candidates with feedback
  (3) Evolve candidates via image-to-image generation incorporating feedback
  (4) Repeat annotation/evolution cycles until the user is satisfied
  (5) Converge to a final output (HTML/CSS, React, design specs, polished image, etc.)
  This skill orchestrates generate.ts, the eval API, and nano-banana-pro for a multi-round design exploration loop. Manually invoked only.
---

# Design Evolve — Iterative Visual Design Workflow

You are running an iterative design evolution loop on a tldraw canvas. The user describes what they want, you generate seed candidates, the user annotates them with feedback, and you evolve the designs — repeating until convergence.

## Prerequisites

```bash
cd /Users/cameronfranz/Downloads/Possibilities/paper
source .env  # GEMINI_API_KEY

# Verify canvas connection
curl -s http://localhost:3031/health | jq .
```

**Assumptions:**
- Eval server running at `http://localhost:3031`
- Browser connected with tldraw open
- `GEMINI_API_KEY` set in `.env`
- Working directory for generate.ts: `/Users/cameronfranz/Downloads/Possibilities/paper`

---

## Workflow Overview

```
SEED → REVIEW → EVOLVE → REVIEW → EVOLVE → ... → CONVERGE
```

Track the current iteration number starting at 0 (seed). Increment on each EVOLVE.

---

## Step 0: CANVAS SETUP

Clear the current page for a fresh start. **Do NOT create new pages** — tldraw's localStorage persistence fights against page creation/switching via eval, causing shapes to appear on wrong pages and page IDs to become inconsistent.

**CRITICAL: Do NOT use `editor.store.mergeRemoteChanges()`** — it marks changes as `source: 'remote'`, and the IndexedDB persistence listener only persists `source: 'user'` changes. This means shapes created inside `mergeRemoteChanges` exist in memory but are NEVER saved to IndexedDB and disappear on any persistence cycle. Use direct editor API calls (`editor.createShape()`, `editor.deleteShapes()`, etc.) — these are automatically `source: 'user'` and persist correctly.

**IMPORTANT:** All eval `curl` commands MUST be written as a single line (no `\` line continuations in the `-d` argument). Multi-line curl breaks with "blank argument" errors.

```bash
# Save existing canvas info for recovery, then clear all shapes
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d '{"code": "const shapes = Array.from(editor.getCurrentPageShapes()); const info = { pageId: String(editor.getCurrentPageId()), shapeCount: shapes.length, shapeTypes: shapes.map(s => s.type) }; if (shapes.length > 0) { editor.deleteShapes(shapes.map(s => s.id)); } return info"}' | jq .
```

Verify the page is empty:

```bash
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d '{"code": "return { shapeCount: Array.from(editor.getCurrentPageShapes()).length }"}' | jq .
```

The shape count must be `0` before proceeding. If it's not, wait 2 seconds and delete again.

---

## Step 1: SEED

When the user provides a design description, generate 6 varied candidates.

### 1a. Choose aspect ratio

Pick the aspect ratio based on the target device/context:
- **Mobile phone app**: `--aspect-ratio 9:16` (portrait)
- **Tablet/iPad app**: `--aspect-ratio 4:3` (landscape) or `--aspect-ratio 3:4` (portrait)
- **Desktop/web app**: `--aspect-ratio 16:9` (landscape)
- **Square/flexible**: `--aspect-ratio 1:1`

### 1b. Craft 6 diverse prompts

From the user's description, create 6 prompts that explore different visual styles, layouts, or interpretations.

**CRITICAL prompt rules — these prevent bad generations:**
- ALWAYS start with: "Flat UI screenshot of a [device] app screen showing..."
- NEVER mention the physical device (no "iPad", "iPhone", "laptop") — this causes Gemini to generate a PHOTO of the device from a weird angle instead of a flat UI
- NEVER use words like "mockup", "render", "3D", "perspective", "device" — these trigger photos
- Always describe the UI CONTENT directly: buttons, panels, colors, layout regions
- Think of it as describing what appears ON the screen, not the screen itself

Example for "a drawing app for iPad":
1. "Flat UI screenshot of a drawing app screen, clean minimalist white canvas, slim floating toolbar on left with pencil brush eraser icons, subtle pastel color palette at bottom, thin top bar with layers and undo redo, large open canvas area, light grey workspace"
2. "Flat UI screenshot of a drawing app screen, dark mode professional interface, deep charcoal background, glowing neon accent toolbar icons on left rail, circular color wheel overlay, brush size slider, layer panel on right side"
3. "Flat UI screenshot of a drawing app screen, playful colorful design, rounded bubbly toolbar buttons, rainbow color strip at bottom, friendly icons with soft shadows, stamp and sticker tools visible, bright white canvas with dotted grid"
4. "Flat UI screenshot of a drawing app screen, skeuomorphic wooden desk aesthetic, textured paper canvas, realistic pencil paintbrush tool icons in wooden tray at bottom, torn edge paper layers panel, warm natural tones"
5. "Flat UI screenshot of a drawing app screen, glassmorphism UI, translucent frosted toolbar panels floating over canvas, vibrant gradient accent colors, compact icon-only left toolbar, properties panel on right with sliders, futuristic design"
6. "Flat UI screenshot of a drawing app screen, split view layout, reference image panel on left third, main drawing canvas on right two thirds, compact top toolbar with symmetry and grid toggles, muted blue grey color scheme"

### 1c. Generate all 6 images (disk only)

Use `--no-upload` to save images to disk WITHOUT placing on canvas. This avoids all tldraw sync issues during generation.

```bash
cd /Users/cameronfranz/Downloads/Possibilities/paper && source .env && bun scripts/generate.ts \
  "prompt 1" \
  "prompt 2" \
  "prompt 3" \
  "prompt 4" \
  "prompt 5" \
  "prompt 6" \
  --resolution 2K --aspect-ratio CHOSEN_RATIO --no-upload
```

Note the output directory (e.g., `/tmp/generate-TIMESTAMP/`). Images are saved as `01.png` through `06.png`.

### 1d. Place images on canvas via eval

Place the 6 generated images on the canvas in a column layout using eval. Write a shell script to do this:

```bash
#!/bin/bash
SRC_DIR="/tmp/generate-TIMESTAMP"  # Replace with actual dir from step 1c
DISPLAY_W=400

for i in 0 1 2 3 4 5; do
  N=$((i + 1))
  IMG_FILE="$SRC_DIR/$(printf '%02d' $N).png"
  Y_POS=$((100 + i * 380))

  echo "Placing image $N at y=$Y_POS..."
  IMG_B64=$(base64 < "$IMG_FILE")

  cat > /tmp/evolve-place-${N}.json << EVALEOF
{"code": "const dataUrl = 'data:image/png;base64,${IMG_B64}'; const img = new Image(); await new Promise((r,e) => { img.onload = r; img.onerror = e; img.src = dataUrl; }); const scale = ${DISPLAY_W} / img.naturalWidth; const w = ${DISPLAY_W}; const h = Math.round(img.naturalHeight * scale); const assetId = 'asset:seed-${N}-' + Math.random().toString(36).substr(2, 9); const shapeId = 'shape:seed-img-${N}'; editor.createAssets([{ id: assetId, type: 'image', typeName: 'asset', props: { name: 'seed-${N}', src: dataUrl, w: img.naturalWidth, h: img.naturalHeight, mimeType: 'image/png', isAnimated: false }, meta: {} }]); editor.createShape({ id: shapeId, type: 'image', x: 100, y: ${Y_POS}, props: { assetId: assetId, w: w, h: h } }); return { shapeId, w, h }"}
EVALEOF

  curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d @/tmp/evolve-place-${N}.json | jq -r '.result'
  sleep 0.5
done
echo "Done placing all 6 images."
```

Save this script to a temp file and run it. Verify all 6 placed:

```bash
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d '{"code": "return Array.from(editor.getCurrentPageShapes()).filter(s => s.type === \"image\").length"}' | jq .
```

### 1e. Get image positions and create labeled frames

Query the canvas to find the placed images and create frames around each one.

```bash
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d '{"code": "const shapes = Array.from(editor.getCurrentPageShapes()).filter(s => s.type === \"image\"); return shapes.map(s => ({ id: String(s.id), x: s.x, y: s.y, w: s.props.w, h: s.props.h, assetId: String(s.props.assetId) }))"}' | jq .
```

For each image, create a frame rectangle and label. Use the image positions from the query:

For longer eval code, write the JSON to a temp file first to avoid shell escaping issues:

```bash
# Write the eval code to a temp file
cat > /tmp/evolve-frames.json << 'EVALEOF'
{"code": "const images = Array.from(editor.getCurrentPageShapes()).filter(s => s.type === 'image').sort((a, b) => a.y - b.y); const padding = 30; const topPadding = 50; const frameIds = []; const labelIds = []; for (let i = 0; i < images.length; i++) { const img = images[i]; const frameId = 'shape:frame-' + i; const labelId = 'shape:label-' + i; frameIds.push(frameId); labelIds.push(labelId); editor.createShape({ id: frameId, type: 'geo', x: img.x - padding, y: img.y - topPadding, props: { w: img.props.w + padding * 2, h: img.props.h + topPadding + padding, geo: 'rectangle', fill: 'none', color: 'grey', dash: 'solid', size: 's' } }); editor.createShape({ id: labelId, type: 'text', x: img.x + img.props.w / 2, y: img.y - topPadding + 8, props: { color: 'grey', size: 's', textAlign: 'middle', autoSize: true, richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Candidate ' + (i + 1) }] }] } } }); editor.sendToBack([frameId]); } return { frameIds, labelIds, count: images.length };"}
EVALEOF

# Send it
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d @/tmp/evolve-frames.json | jq .
```

**The `@file` pattern** (`-d @/tmp/file.json`) is the safest way to pass complex eval code to curl. It avoids all shell escaping and newline issues. The JSON file uses single quotes inside the JS code string (no escaping needed inside heredoc).

### 1f. Zoom to fit

```bash
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d '{"code": "editor.zoomToFit(); return \"ok\""}' | jq .
```

### 1g. Tell the user

After seed generation, tell the user:
> I've generated 6 candidate designs on the canvas. Each one is framed and labeled (Candidate 1–6).
>
> **To give feedback:** Draw directly on any candidate — circle areas you like, cross out parts you don't, add sticky notes or text with specific instructions. Your annotations on any candidate will be applied as feedback to ALL candidates in the next evolution round.
>
> **When you're ready**, just say "ready" and I'll evolve the designs based on your annotations.

---

## Step 2: REVIEW

Wait for the user to say "ready" (or similar: "evolve", "go", "next", "iterate").

If the user asks questions about the candidates or wants to discuss them, engage in conversation while staying in the review phase.

---

## Step 3: EVOLVE

This is the core loop. Annotations are **global feedback** — changes requested on any candidate apply to ALL candidates.

### Phase A: Gather all feedback

#### A1. Detect annotations on all candidates

Find shapes that are inside candidate frame bounds but are NOT the frame, label, or image themselves:

```bash
cat > /tmp/evolve-detect.json << 'EVALEOF'
{"code": "editor.zoomToFit(); const allShapes = Array.from(editor.getCurrentPageShapes()); const frames = allShapes.filter(s => String(s.id).startsWith('shape:frame-')); const labels = allShapes.filter(s => String(s.id).startsWith('shape:label-')); const images = allShapes.filter(s => s.type === 'image').sort((a, b) => a.y - b.y); const excludeIds = new Set([...frames.map(s => s.id), ...labels.map(s => s.id), ...images.map(s => s.id), ...allShapes.filter(s => String(s.id).startsWith('shape:evolve-arrow-')).map(s => s.id)]); const results = []; for (let i = 0; i < frames.length; i++) { const frame = frames[i]; const fb = editor.getShapePageBounds(frame.id); if (!fb) continue; const annotations = allShapes.filter(s => { if (excludeIds.has(s.id)) return false; const sb = editor.getShapePageBounds(s.id); if (!sb) return false; return sb.x < fb.x + fb.w && sb.x + sb.w > fb.x && sb.y < fb.y + fb.h && sb.y + sb.h > fb.y; }); const textAnnotations = []; for (const s of annotations) { if (s.props && s.props.richText && s.props.richText.content) { s.props.richText.content.forEach(block => { if (block.content) block.content.forEach(inline => { if (inline.text) textAnnotations.push(inline.text); }); }); } } results.push({ candidateIndex: i, imageId: images[i] ? String(images[i].id) : null, frameId: String(frame.id), hasAnnotations: annotations.length > 0, annotationCount: annotations.length, textAnnotations: textAnnotations, annotationIds: annotations.map(s => String(s.id)) }); } return results;"}
EVALEOF
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d @/tmp/evolve-detect.json | jq .
```

#### A2. Screenshot annotated regions (for Claude to interpret)

For each candidate that has annotations, screenshot the region showing the image + annotations together. This captures drawn marks, circles, arrows, and any visual feedback.

```bash
# Screenshot a candidate region (image + annotations)
# Replace FRAME_ID with the actual frame shape ID (e.g., shape:frame-0)
cat > /tmp/eval-screenshot.json << 'EVALEOF'
{"code": "editor.zoomToFit(); const fb = editor.getShapePageBounds('FRAME_ID'); if (!fb) return null; const dataUrl = await getScreenshot({ format: 'png', bounds: fb, scale: 1 }); return dataUrl;"}
EVALEOF
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d @/tmp/eval-screenshot.json | jq -r '.result' | sed 's/^data:image\/png;base64,//' | base64 -d > /tmp/evolve-annotated-candidate-N.png
```

**Note:** `getScreenshot()` is a helper available in the eval context (from EvalBridge). The `bounds` parameter accepts the Box object returned directly by `getShapePageBounds()`. Always call `editor.zoomToFit()` in the same eval call before `getShapePageBounds()` to ensure bounds are computed.

Run this for each annotated candidate (replace `N` with the candidate index and `FRAME_ID` accordingly).

#### A3. Read annotated screenshots

Use the Read tool to view each saved annotated screenshot file. This lets you visually interpret all drawn annotations, circles, arrows, crossed-out areas, sticky notes, etc.

#### A4. Synthesize unified change list

After viewing ALL annotated screenshots and reading any text annotations from A1, produce a unified change list. This is a bulleted summary of everything the user wants changed, e.g.:
- "Make buttons rounded with larger tap targets"
- "Change the header title to 'My Workouts'"
- "Use the card layout style from Candidate 3"
- "Remove the bottom navigation bar"
- "Use warmer color palette"

Print this change list for the user to confirm it's correct before proceeding.

### Phase B: Evolve each candidate

For each candidate (ALL of them, not just annotated ones — feedback is global):

#### B1. Export the clean original image

Extract the original image data (without annotations) from the canvas asset:

```bash
# Get the clean image data for candidate N
# Replace IMAGE_ID with the actual image shape ID (e.g., shape:abc123)
cat > /tmp/eval-clean-img.json << 'EVALEOF'
{"code": "const images = Array.from(editor.getCurrentPageShapes()).filter(s => s.type === 'image'); const shape = images.find(s => String(s.id) === 'IMAGE_ID'); if (!shape) return null; const asset = editor.getAsset(shape.props.assetId); if (!asset) return null; return asset.props.src;"}
EVALEOF
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d @/tmp/eval-clean-img.json | jq -r '.result' | sed 's/^data:image\/[a-z]*;base64,//' | base64 -d > /tmp/evolve-clean-N.png
```

#### B2. Craft per-candidate prompt

For each candidate, create an image-editing prompt that:
- Applies ALL items from the unified change list
- Preserves the candidate's specific visual style, color scheme, and overall aesthetic
- Is phrased as editing instructions for the existing image

Example: "Edit this mobile app UI: make all buttons rounded with 12px radius, change header to 'My Workouts', use warmer orange/brown palette. Keep the existing minimalist layout and thin typography style."

#### B3. Generate evolved images (disk only)

Generate all evolved images to disk first, then place them all on canvas. Use `generate.ts` with `--input-image` pointing to each clean original:

```bash
# Run all 6 evolutions in parallel
for N in 1 2 3 4 5 6; do
  cd /Users/cameronfranz/Downloads/Possibilities/paper && source .env && bun scripts/generate.ts \
    "editing prompt for candidate $N" \
    --input-image /tmp/evolve-clean-${N}.png \
    --resolution 2K --aspect-ratio CHOSEN_RATIO \
    --no-upload \
    -o /tmp/evolve-iterM-candidate${N} &
done
wait
echo "All evolutions complete"
```

#### B4. Place each evolved image + arrow + frame (single eval per candidate)

**CRITICAL: Do NOT hardcode positions.** Each candidate's placement must query the original image's actual position from the canvas. Use this shell loop that writes a single eval call per candidate — the eval code itself looks up the original image and positions everything relative to it:

```bash
#!/bin/bash
ITER=1  # Current iteration number
GAP=120  # Horizontal gap between original and evolved image

for i in 0 1 2 3 4 5; do
  N=$((i + 1))
  IMG_FILE="/tmp/evolve-iter${ITER}-candidate${N}/01.png"
  if [ ! -f "$IMG_FILE" ]; then
    echo "Skipping candidate $N — no evolved image found"
    continue
  fi

  echo "Placing evolved candidate $N..."
  IMG_B64=$(base64 < "$IMG_FILE")

  # ORIG_ID is the shape ID of the original image for this candidate.
  # For iter 1, this is the seed image (e.g., shape:seed-img-N).
  # For iter 2+, query the latest images first (see Step 4).
  ORIG_ID="shape:seed-img-${N}"

  cat > /tmp/evolve-place-iter${ITER}-${N}.json << EVALEOF
{"code": "const allImages = Array.from(editor.getCurrentPageShapes()).filter(s => s.type === 'image'); const orig = allImages.find(s => String(s.id) === '${ORIG_ID}'); if (!orig) return 'original not found: ${ORIG_ID}'; const dataUrl = 'data:image/png;base64,${IMG_B64}'; const img = new Image(); await new Promise((r,e) => { img.onload = r; img.onerror = e; img.src = dataUrl; }); const displayW = orig.props.w; const scale = displayW / img.naturalWidth; const displayH = Math.round(img.naturalHeight * scale); const newX = orig.x + orig.props.w + ${GAP}; const newY = orig.y; const newShapeId = 'shape:evolved-${ITER}-${N}-' + Math.random().toString(36).substr(2, 6); const newAssetId = 'asset:evolved-${ITER}-${N}-' + Math.random().toString(36).substr(2, 6); editor.createAssets([{ id: newAssetId, type: 'image', typeName: 'asset', props: { name: 'evolved-${ITER}-${N}', src: dataUrl, w: img.naturalWidth, h: img.naturalHeight, mimeType: 'image/png', isAnimated: false }, meta: {} }]); editor.createShape({ id: newShapeId, type: 'image', x: newX, y: newY, props: { assetId: newAssetId, w: displayW, h: displayH } }); const arrowX = orig.x + orig.props.w; const arrowY = orig.y + orig.props.h / 2; editor.createShape({ id: 'shape:evolve-arrow-${ITER}-${i}', type: 'arrow', x: arrowX, y: arrowY, props: { start: { x: 0, y: 0 }, end: { x: ${GAP} - 20, y: 0 }, color: 'grey', arrowheadEnd: 'arrow', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Iter ${ITER}' }] }] } } }); const padding = 30; const topPadding = 50; const frameId = 'shape:frame-iter${ITER}-${i}'; const labelId = 'shape:label-iter${ITER}-${i}'; editor.createShape({ id: frameId, type: 'geo', x: newX - padding, y: newY - topPadding, props: { w: displayW + padding * 2, h: displayH + topPadding + padding, geo: 'rectangle', fill: 'none', color: 'grey', dash: 'solid', size: 's' } }); editor.createShape({ id: labelId, type: 'text', x: newX + displayW / 2, y: newY - topPadding + 8, props: { color: 'grey', size: 's', textAlign: 'middle', autoSize: true, richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Candidate ${N} — Iter ${ITER}' }] }] } } }); editor.sendToBack([frameId]); return { newShapeId, newX, newY, displayW, displayH }"}
EVALEOF

  curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d @/tmp/evolve-place-iter${ITER}-${N}.json | jq -r '.result'
  sleep 0.5
done
echo "All evolved images placed with arrows and frames."
```

**Why this works:** The eval code looks up `${ORIG_ID}` on the canvas and reads its actual `x, y, w, h` — then positions the new image, arrow, and frame relative to those real values. No hardcoded positions.

For iteration 2+, replace `ORIG_ID` with the evolved image ID from the previous iteration (query them using the "find latest images" eval from Step 4).

#### B5. Zoom to fit after all evolutions

```bash
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d '{"code": "editor.zoomToFit(); return \"ok\""}' | jq .
```

### After evolving, tell the user:

> I've evolved all 6 candidates based on your feedback. The new versions are to the right of the originals, connected by arrows.
>
> **Changes applied:**
> [list the unified change list]
>
> You can annotate the new versions the same way — draw on them, add notes, circle what works. Say "ready" when you want another evolution round, or "done" if you're happy with a design.

---

## Step 4: REPEAT

- Go back to Step 2 (REVIEW)
- Increment the iteration counter
- On subsequent evolve rounds, the "original" for each candidate is now the **most recent evolved version** (the rightmost image in each candidate's row)
- Update frame IDs to use the new iteration number: `frame-iter2-N`, `label-iter2-N`, etc.
- Detect annotations only on the most recent iteration's frames

To find the latest images for each candidate row, query by iteration:

```bash
# Find the most recent images (rightmost in each candidate row)
cat > /tmp/eval-latest-imgs.json << 'EVALEOF'
{"code": "const images = Array.from(editor.getCurrentPageShapes()).filter(s => s.type === 'image'); const rows = {}; for (const img of images) { const rowKey = Math.round(img.y / 50) * 50; if (!rows[rowKey]) rows[rowKey] = []; rows[rowKey].push(img); } const latest = Object.values(rows).map(row => { row.sort((a, b) => b.x - a.x); return { id: String(row[0].id), x: row[0].x, y: row[0].y, w: row[0].props.w, h: row[0].props.h, assetId: String(row[0].props.assetId) }; }); latest.sort((a, b) => a.y - b.y); return latest;"}
EVALEOF
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d @/tmp/eval-latest-imgs.json | jq .
```

---

## Step 5: CONVERGE

When the user says "done" (or "finished", "that's good", "ship it", etc.):

1. **Ask which candidate(s)** they want as the final output, and what format:
   > Which candidate(s) do you want as the final output? And what format would you like?
   > - **HTML/CSS** — responsive code
   > - **React component** — JSX + styled
   > - **Design specs** — colors, fonts, spacing documented
   > - **Polished 4K image** — high-res final render
   > - **Something else?**

2. **Screenshot the chosen design(s)** at high resolution:

```bash
# Export the final chosen candidate's clean image
cat > /tmp/eval-final-img.json << 'EVALEOF'
{"code": "const images = Array.from(editor.getCurrentPageShapes()).filter(s => s.type === 'image'); const shape = images.find(s => String(s.id) === 'FINAL_IMAGE_ID'); if (!shape) return null; const asset = editor.getAsset(shape.props.assetId); if (!asset) return null; return asset.props.src;"}
EVALEOF
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d @/tmp/eval-final-img.json | jq -r '.result' | sed 's/^data:image\/[a-z]*;base64,//' | base64 -d > /tmp/evolve-final.png
```

3. **Produce the requested output:**

   - **HTML/CSS or React:** Read the final screenshot with the Read tool, then write code that faithfully reproduces the design. Use semantic HTML, CSS custom properties for the color system, and responsive units.

   - **Design specs:** Read the screenshot and document: color palette (hex values), typography (font families, sizes, weights), spacing system, component inventory, and layout grid.

   - **Polished 4K image:** Re-generate with `--resolution 4K` using the final design as `--input-image`:
     ```bash
     cd /Users/cameronfranz/Downloads/Possibilities/paper && source .env && bun scripts/generate.ts \
       "High fidelity polished version of this UI design, pixel-perfect, production quality" \
       --input-image /tmp/evolve-final.png \
       --resolution 4K --aspect-ratio CHOSEN_RATIO --no-upload
     ```

---

## Important Notes

### Shape ID conventions
- `shape:frame-N` — seed frame for candidate N (0-indexed)
- `shape:label-N` — seed label for candidate N
- `shape:frame-iterM-N` — frame for candidate N at iteration M
- `shape:label-iterM-N` — label for candidate N at iteration M
- `shape:evolve-arrow-M-N` — arrow from iteration M-1 to M for candidate N
- Image shape IDs are generated dynamically by the canvas — query them, don't hardcode

### Annotation detection reliability
The frame rectangles are the detection boundary. Anything drawn inside the frame that isn't the frame, label, or image is an annotation. This works because:
- Users naturally draw inside the framed region
- The frame provides clear visual boundaries
- Shape overlap with frame bounds is a reliable geometric test

### Error handling
- If `generate.ts` fails for a candidate, skip it and continue with others
- If the eval server is not responding, tell the user to check that tldraw is open
- If no annotations are detected, ask the user if they meant to annotate or if they want to provide text-only feedback

### Performance
- Generate all seed candidates in a single `generate.ts` call (parallel internally)
- During evolve, you can run multiple `generate.ts` calls sequentially (each is a single image with `--input-image`)
- Screenshots and eval calls are fast — no need to batch them

### Temp file paths
- Annotated screenshots: `/tmp/evolve-annotated-candidate-N.png`
- Clean originals: `/tmp/evolve-clean-N.png`
- Evolved outputs: `/tmp/evolve-iterM-candidateN/01.png`
- Final output: `/tmp/evolve-final.png`

### tldraw eval API gotchas (CRITICAL)

These were all discovered through testing and MUST be followed:

0. **Do NOT use `editor.store.mergeRemoteChanges()`**: This marks changes as `source: 'remote'`. The IndexedDB persistence listener (`TLLocalSyncClient`) only watches for `source: 'user'` changes. Shapes created inside `mergeRemoteChanges` exist in memory but are NEVER saved to IndexedDB — they vanish on the next persistence cycle. Use direct editor API calls (`editor.createShape()`, `editor.deleteShapes()`, `editor.createAssets()`) — these are automatically `source: 'user'` and persist correctly. Also avoid `createPage()`/`setCurrentPage()` — they are unreliable via eval.

1. **Use `Array.from()` not spread**: `[...editor.getCurrentPageShapes()]` is unreliable — `.map()` on the spread result returns empty. Always use `Array.from(editor.getCurrentPageShapes())`.

2. **Use `richText` not `text`**: This tldraw version uses ProseMirror `richText` for ALL text-bearing shapes (text, note, geo, arrow). The `text` prop will crash. Always use:
   ```
   richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Your text" }] }] }
   ```

3. **`textAlign` values**: Use `"start"`, `"middle"`, or `"end"`. NOT `"center"` or `"left"`.

4. **Call `zoomToFit()` before `getShapePageBounds()`**: Bounds are not computed until a layout pass. Call `editor.zoomToFit()` in the SAME eval call before accessing bounds. Otherwise you get `null`.

5. **Use `getScreenshot()` for region screenshots**: The `editor.toImage()` API requires a Box object with `.clone()`. Instead, use the `getScreenshot()` helper (from EvalBridge, available in eval context): `await getScreenshot({ format: "png", bounds: fb, scale: 1 })`. Pass the Box from `getShapePageBounds()` directly.

6. **Use `editor.createShape()` for arrows, not `executeAction()`**: The `agent` object on `window` may not be available. Use `editor.createShape()` directly with `type: "arrow"`, `start: {x, y}`, `end: {x, y}` props.

7. **Arrow props are `start/end` not `x1/y1/x2/y2`**: Arrow shapes take `start: {x, y}` and `end: {x, y}` relative to the arrow's own `x, y` position.

8. **Use `for` loops not `forEach`**: `.forEach()` on iterable results can be unreliable in eval context. Use `for` loops.

9. **Stringify shape IDs**: Shape IDs are special tldraw objects. Use `String(s.id)` when comparing or returning IDs.

10. **Avoid `editor.getShape("string-id")`**: This sometimes returns null for existing shapes. Instead, get all shapes with `Array.from(editor.getCurrentPageShapes())` and filter with `.find(s => String(s.id) === "shape:...")`.

11. **Avoid `try/catch` in eval**: The async eval wrapper doesn't properly serialize caught errors. Let errors propagate naturally.

12. **Text extraction from shapes**: To read text from annotations, access `s.props.richText.content[].content[].text` (nested ProseMirror structure), not `s.props.text`.

13. **JSON encoding in eval calls**: Two critical rules:
    - Code MUST be on a single line — literal newlines cause "Bad control character" errors
    - **ALWAYS use the `@file` pattern** for eval calls: write JSON to a temp file with `cat > /tmp/file.json << 'EVALEOF'`, then `curl -d @/tmp/file.json`. This avoids shell escaping issues. In particular, zsh expands exclamation marks to backslash-escaped versions even inside single quotes, which creates invalid JSON escapes. The `@file` pattern with a single-quote-delimited heredoc avoids this entirely.

14. **Canvas cleanup**: Delete shapes on current page using direct `editor.deleteShapes()`. Do NOT create new pages — `createPage`/`setCurrentPage` are unreliable via eval (IndexedDB persistence fights them, causing shapes to appear on wrong pages). Stay on the current page.

15. **Prompt engineering for flat UI**: NEVER mention device names (iPad, iPhone, laptop) in Gemini prompts — this causes Gemini to generate a photo of the physical device from a weird angle instead of a flat UI screenshot. Always say "Flat UI screenshot of a [type] app screen showing..." and describe the UI content directly.
