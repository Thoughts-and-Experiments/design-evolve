---
name: design-evolve
description: |
  Iterative visual design workflow on tldraw canvas. Use when the user invokes /design-evolve to:
  (1) Generate seed UI candidates from a description
  (2) Let the user annotate candidates with feedback
  (3) Evolve candidates via image-to-image generation incorporating feedback
  (4) Repeat annotation/evolution cycles until the user is satisfied
  (5) Converge to a final output (HTML/CSS, React, design specs, polished image, etc.)
  This skill orchestrates generate.ts and the eval API for a multi-round design exploration loop. Manually invoked only.
---

# Design Evolve — Iterative Visual Design Workflow

You are running an iterative design evolution loop on a tldraw canvas. The user describes what they want, you generate seed candidates, the user annotates them with feedback, and you evolve the designs — repeating until convergence.

## Prerequisites — Environment Setup

Before starting the workflow, you MUST discover paths and verify the environment. Run these checks and fix any issues before proceeding.

### Discover the repo root

Find the design-evolve repo on this machine. Try these in order:
1. Check current working directory: `git rev-parse --show-toplevel 2>/dev/null`
2. Check common locations: `ls ~/Documents/design-evolve/paper 2>/dev/null`
3. If not found, ask the user where they cloned it, or offer to clone it:
   `git clone https://github.com/Thoughts-and-Experiments/design-evolve.git ~/Documents/design-evolve`

Once found, set these variables for all subsequent commands:
```bash
REPO_ROOT="<path to design-evolve repo>"
PAPER="$REPO_ROOT/paper"
EH="python3 $REPO_ROOT/skills/design-evolve/scripts/eval_helper.py"
```

### Check dependencies

Run all checks in a single Bash call:
```bash
REPO_ROOT="<discovered path>"
PAPER="$REPO_ROOT/paper"

# Check node_modules
[ -d "$PAPER/node_modules" ] && echo "deps: ok" || echo "deps: MISSING — run: cd $PAPER && npm install"

# Check .env
[ -f "$PAPER/.env" ] && echo "env: ok" || echo "env: MISSING — need GEMINI_API_KEY"

# Check bun
which bun > /dev/null 2>&1 && echo "bun: ok" || echo "bun: MISSING — run: npm install -g bun"

# Check python3
which python3 > /dev/null 2>&1 && echo "python3: ok" || echo "python3: MISSING"

# Check eval server
curl -s http://localhost:3031/health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('eval server: ok, browser:', 'connected' if d.get('browserConnected') else 'NOT connected')" 2>/dev/null || echo "eval server: NOT running — run: cd $PAPER && npm start"
```

**If any check fails**, ask the user for permission to fix it before proceeding. Key fixes:
- Missing deps: `cd $PAPER && npm install`
- Missing .env: Ask user for their Gemini API key (get one at https://aistudio.google.com/apikey), then create `$PAPER/.env` with `GEMINI_API_KEY=<key>`
- Missing bun: `npm install -g bun`
- Eval server not running: `cd $PAPER && npm start` (runs in background — starts both Vite and eval server)
- Browser not connected: Open `http://localhost:5173` in Chrome

### Health check

Once everything is set up, verify the full pipeline:
```bash
cd $PAPER && source .env && $EH health
```

This should return `{"status": "ok", "browserConnected": true}`. If `browserConnected` is false, tell the user to open `http://localhost:5173` in Chrome.

---

## Python eval helper

**All canvas operations use the bundled `eval_helper.py`** instead of raw curl commands. This reduces the number of Bash calls (each needs user approval) and avoids shell escaping issues with curl/JSON.

Key commands (always use the `$EH` variable set during prerequisites):
```
$EH health                              # Check connection
$EH clear                               # Delete all shapes
$EH zoom-to-fit                         # Zoom to fit
$EH get-images                          # List all images
$EH get-latest                          # Latest image per row
$EH place-images <dir> [--display-width 400]  # Place PNGs from dir
$EH create-frames [--prefix "iter1-"] [--iter-label " — Iter 1"]
$EH detect-annotations                  # Find user annotations
$EH screenshot <frame_id> <output.png>  # Screenshot a frame region
$EH export-clean <image_id> <output.png>  # Export clean original
$EH place-evolved <img.png> <orig_shape_id> <iter> <candidate_num>
$EH eval "editor.zoomToFit(); return 'ok'"  # Run arbitrary JS
```

**Combine multiple commands in a single Bash call** using `&&` or `;` to minimize approvals.

---

## Workflow Overview

```
SEED → REVIEW → EVOLVE → REVIEW → EVOLVE → ... → CONVERGE
```

Track the current iteration number starting at 0 (seed). Increment on each EVOLVE.

---

## Step 0: CANVAS SETUP

Clear the current page for a fresh start. **Do NOT create new pages** — tldraw's localStorage persistence fights against page creation/switching via eval.

**CRITICAL: Do NOT use `editor.store.mergeRemoteChanges()`** — it marks changes as `source: 'remote'`, and the IndexedDB persistence listener only persists `source: 'user'` changes. Use direct editor API calls instead.

```bash
cd $PAPER && $EH clear
```

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
cd $PAPER && source .env && bun scripts/generate.ts \
  "prompt 1" \
  "prompt 2" \
  "prompt 3" \
  "prompt 4" \
  "prompt 5" \
  "prompt 6" \
  --resolution 2K --aspect-ratio CHOSEN_RATIO --no-upload
```

Note the output directory (e.g., `/tmp/generate-TIMESTAMP/`). Images are saved as `01.png` through `06.png`.

### 1d. Place images on canvas, create frames, and zoom to fit

**Single Bash call** — places all images, creates frames, and zooms to fit:

```bash
cd $PAPER && \
  $EH place-images /tmp/generate-TIMESTAMP --display-width 400 && \
  $EH create-frames && \
  $EH zoom-to-fit
```

Replace `/tmp/generate-TIMESTAMP` with the actual directory from step 1c. The `place-images` command auto-detects how many PNGs are in the directory and places them in a column with dynamic spacing.

### 1e. Tell the user

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

#### A1. Detect annotations and screenshot annotated candidates

**Single Bash call** — detect annotations on all candidates, then screenshot the annotated ones:

```bash
cd $PAPER && \
  $EH detect-annotations | tee /tmp/evolve-annotations.json
```

Parse the JSON output to find which candidates have annotations (`hasAnnotations: true`). Then screenshot each annotated candidate:

```bash
cd $PAPER && \
  $EH screenshot shape:frame-0 /tmp/evolve-annotated-candidate-0.png && \
  $EH screenshot shape:frame-2 /tmp/evolve-annotated-candidate-2.png
```

(Only include the frame IDs that had annotations.)

#### A2. Read annotated screenshots

Use the Read tool to view each saved annotated screenshot file. This lets you visually interpret all drawn annotations, circles, arrows, crossed-out areas, sticky notes, etc.

#### A3. Synthesize unified change list

After viewing ALL annotated screenshots and reading any text annotations from A1, produce a unified change list. This is a bulleted summary of everything the user wants changed, e.g.:
- "Make buttons rounded with larger tap targets"
- "Change the header title to 'My Workouts'"
- "Use the card layout style from Candidate 3"
- "Remove the bottom navigation bar"
- "Use warmer color palette"

Print this change list for the user to confirm it's correct before proceeding.

### Phase B: Evolve each candidate

For each candidate (ALL of them, not just annotated ones — feedback is global):

#### B1. Export all clean original images

**Single Bash call** — export clean originals for all candidates. Get the image IDs first, then export each:

```bash
cd $PAPER && $EH get-images
```

Then for each image shape ID returned:

```bash
cd $PAPER && \
  $EH export-clean shape:seed-img-1 /tmp/evolve-clean-1.png && \
  $EH export-clean shape:seed-img-2 /tmp/evolve-clean-2.png && \
  $EH export-clean shape:seed-img-3 /tmp/evolve-clean-3.png && \
  $EH export-clean shape:seed-img-4 /tmp/evolve-clean-4.png && \
  $EH export-clean shape:seed-img-5 /tmp/evolve-clean-5.png && \
  $EH export-clean shape:seed-img-6 /tmp/evolve-clean-6.png
```

Use the actual shape IDs from `get-images`. For iteration 2+, use `get-latest` to find the most recent images.

#### B2. Craft per-candidate prompt

For each candidate, create an image-editing prompt that:
- Applies ALL items from the unified change list
- Preserves the candidate's specific visual style, color scheme, and overall aesthetic
- Is phrased as editing instructions for the existing image

Example: "Edit this mobile app UI: make all buttons rounded with 12px radius, change header to 'My Workouts', use warmer orange/brown palette. Keep the existing minimalist layout and thin typography style."

#### B3. Generate evolved images (disk only)

Generate all evolved images to disk. Run in parallel with `&` and `wait`:

```bash
cd $PAPER && source .env
for N in 1 2 3 4 5 6; do
  bun scripts/generate.ts \
    "editing prompt for candidate $N" \
    --input-image /tmp/evolve-clean-${N}.png \
    --resolution 2K --aspect-ratio CHOSEN_RATIO \
    --no-upload \
    -o /tmp/evolve-iter1-candidate${N} &
done
wait
echo "All evolutions complete"
```

#### B4. Place evolved images on canvas

**CRITICAL: Do NOT hardcode positions.** The `place-evolved` command queries each original image's actual position from the canvas and places the new image + arrow + frame relative to it.

```bash
cd $PAPER && \
  $EH place-evolved /tmp/evolve-iter1-candidate1/01.png shape:seed-img-1 1 1 && \
  $EH place-evolved /tmp/evolve-iter1-candidate2/01.png shape:seed-img-2 1 2 && \
  $EH place-evolved /tmp/evolve-iter1-candidate3/01.png shape:seed-img-3 1 3 && \
  $EH place-evolved /tmp/evolve-iter1-candidate4/01.png shape:seed-img-4 1 4 && \
  $EH place-evolved /tmp/evolve-iter1-candidate5/01.png shape:seed-img-5 1 5 && \
  $EH place-evolved /tmp/evolve-iter1-candidate6/01.png shape:seed-img-6 1 6 && \
  $EH zoom-to-fit
```

Arguments: `place-evolved <evolved_image_path> <original_shape_id> <iteration_number> <candidate_number>`

For iteration 2+, use `get-latest` to find the original shape IDs (the rightmost images from the previous iteration).

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
- Detect annotations only on the most recent iteration's frames

To find the latest images for each candidate row:

```bash
cd $PAPER && $EH get-latest
```

This returns the rightmost image in each row sorted by Y position. Use these shape IDs as the `original_shape_id` argument to `place-evolved`.

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

2. **Export the chosen design:**

```bash
cd $PAPER && \
  $EH export-clean FINAL_IMAGE_ID /tmp/evolve-final.png
```

3. **Produce the requested output:**

   - **HTML/CSS or React:** Read the final screenshot with the Read tool, then write code that faithfully reproduces the design. Use semantic HTML, CSS custom properties for the color system, and responsive units.

   - **Design specs:** Read the screenshot and document: color palette (hex values), typography (font families, sizes, weights), spacing system, component inventory, and layout grid.

   - **Polished 4K image:** Re-generate with `--resolution 4K` using the final design as `--input-image`:
     ```bash
     cd $PAPER && source .env && bun scripts/generate.ts \
       "High fidelity polished version of this UI design, pixel-perfect, production quality" \
       --input-image /tmp/evolve-final.png \
       --resolution 4K --aspect-ratio CHOSEN_RATIO --no-upload
     ```

---

## Important Notes

### Shape ID conventions
- `shape:seed-img-N` — seed image for candidate N (1-indexed)
- `shape:frame-N` — seed frame for candidate N (0-indexed)
- `shape:label-N` — seed label for candidate N (0-indexed)
- `shape:frame-iterM-N` — frame for candidate N at iteration M (0-indexed)
- `shape:label-iterM-N` — label for candidate N at iteration M (0-indexed)
- `shape:evolve-arrow-M-N` — arrow from iteration M-1 to M for candidate N
- Evolved image shape IDs are generated dynamically — use `get-images` or `get-latest` to query them

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
- During evolve, run multiple `generate.ts` calls in parallel with `&` and `wait`
- Chain eval_helper commands with `&&` to minimize Bash approvals

### Temp file paths
- Annotated screenshots: `/tmp/evolve-annotated-candidate-N.png`
- Clean originals: `/tmp/evolve-clean-N.png`
- Evolved outputs: `/tmp/evolve-iterM-candidateN/01.png`
- Final output: `/tmp/evolve-final.png`

### tldraw eval API gotchas (CRITICAL)

These apply when using `eval_helper.py eval` for custom JS code:

0. **Do NOT use `editor.store.mergeRemoteChanges()`**: Marks changes as `source: 'remote'` — persistence ignores them. Use direct editor API calls.

1. **Use `Array.from()` not spread**: `[...editor.getCurrentPageShapes()]` is unreliable. Always use `Array.from(editor.getCurrentPageShapes())`.

2. **Use `richText` not `text`**: This tldraw version uses ProseMirror `richText` for ALL text-bearing shapes. The `text` prop will crash.
   ```
   richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Your text" }] }] }
   ```

3. **`textAlign` values**: Use `"start"`, `"middle"`, or `"end"`. NOT `"center"` or `"left"`.

4. **Call `zoomToFit()` before `getShapePageBounds()`**: Bounds are not computed until a layout pass. Call `editor.zoomToFit()` in the SAME eval call before accessing bounds.

5. **Use `getScreenshot()` for region screenshots**: Use the `getScreenshot()` helper (from EvalBridge): `await getScreenshot({ format: "png", bounds: fb, scale: 1 })`.

6. **Use `editor.createShape()` for arrows**: `start: {x, y}`, `end: {x, y}` relative to the arrow's own `x, y` position.

7. **Use `for` loops not `forEach`**: `.forEach()` on iterable results can be unreliable in eval context.

8. **Stringify shape IDs**: Use `String(s.id)` when comparing or returning IDs.

9. **Canvas cleanup**: Delete shapes on current page using direct `editor.deleteShapes()`. Do NOT create new pages.

10. **Prompt engineering for flat UI**: NEVER mention device names (iPad, iPhone, laptop) in Gemini prompts — this causes Gemini to generate a photo of the physical device instead of a flat UI screenshot.
