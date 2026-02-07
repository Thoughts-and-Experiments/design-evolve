---
name: tldraw
description: |
  Design partner for tldraw canvas. Use when the user invokes /tldraw to:
  (1) Create UI designs, wireframes, or mockups on the canvas
  (2) Generate visual layouts based on reference images and text prompts
  (3) Manipulate shapes, create diagrams, or build visual artifacts
  (4) Work with selected shapes as context for design tasks
  (5) Generate images with Gemini and place them on canvas
  This skill operates the tldraw canvas via an eval API. Manually invoked only.
---

# tldraw Design Partner

You are a design partner helping the user create visual artifacts on a tldraw canvas. You have direct access to manipulate the canvas via an eval API.

## Quick Start

```bash
cd /Users/slee2/projects/Possibilities/paper
source .env  # Load GEMINI_API_KEY

# Check connection
curl -s http://localhost:3031/health | jq .

# Get canvas state
curl -s -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "return getCanvasState()"}' | jq .
```

**Assumptions:**
- Eval server running at `http://localhost:3031`
- Browser connected to eval server
- `GEMINI_API_KEY` set in `.env`
- Working directory: `/Users/slee2/projects/Possibilities/paper`

---

## Eval API Reference

The eval server lets you execute JavaScript in the browser context where tldraw is running.

### Endpoint

```
POST http://localhost:3031/eval
Content-Type: application/json

{"code": "/* your JavaScript code */"}
```

### Response Format

```json
{
  "id": "req_xxx",
  "success": true,
  "result": /* whatever your code returned */
}
```

On error:
```json
{
  "id": "req_xxx",
  "success": false,
  "error": "Error message"
}
```

### How to Call from Command Line

```bash
# Get canvas state
curl -s -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "return getCanvasState()"}' | jq .

# Create a shape
curl -s -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "editor.createShape({ id: \"shape:my-rect\", type: \"geo\", x: 100, y: 100, props: { w: 200, h: 100, geo: \"rectangle\", fill: \"solid\", color: \"blue\" } }); return getCanvasState()"}' | jq .
```

### Available Context in Eval

When your code executes, these are available:

- `editor` - The tldraw Editor instance (low-level API)
- `getCanvasState()` - Returns shapes, bindings, viewport, selectedIds
- `getScreenshot(options?)` - Returns canvas screenshot as data URL
- `executeAction(action)` - Execute a single high-level agent action
- `executeActions(actions)` - Execute multiple agent actions

---

## Coordinate System

- The coordinate space is the same as on a website: 0,0 is the top left corner
- The x-axis increases as you scroll to the right
- The y-axis increases as you scroll down the canvas
- For most shapes, `x` and `y` define the top left corner of the shape
- **Exception**: Text shapes use anchor-based positioning where `x` and `y` refer to the point specified by the `anchor` property

---

## Shape Types & Properties

### Geometry Shapes

These shapes have `x`, `y`, `w`, `h` properties:

- `rectangle`, `ellipse`, `triangle`, `diamond`
- `pentagon`, `hexagon`, `octagon`, `star`
- `cloud`, `heart`, `x-box`, `check-box`
- `pill`, `parallelogram-right`, `parallelogram-left`, `trapezoid`
- `fat-arrow-right`, `fat-arrow-left`, `fat-arrow-up`, `fat-arrow-down`

**Common properties:**
- `_type` - Shape type (e.g., `"rectangle"`)
- `shapeId` - Unique identifier for the shape (string without "shape:" prefix)
- `x`, `y` - Position (top-left corner)
- `w`, `h` - Width and height in pixels
- `color` - One of: `red`, `light-red`, `green`, `light-green`, `blue`, `light-blue`, `orange`, `yellow`, `black`, `violet`, `light-violet`, `grey`, `white`
- `fill` - One of: `none`, `tint`, `background`, `solid`, `pattern`
- `text` - Optional label text
- `textAlign` - Label alignment: `start`, `middle`, `end`
- `note` - Internal description (invisible to user)

### Text Shape

Text shapes are special - they use anchor-based positioning:

- `_type`: `"text"`
- `shapeId`: Unique identifier
- `x`, `y`: Position of the anchor point (NOT top-left!)
- `anchor`: Controls both position reference and alignment
- `text`: The text content
- `color`: Text color
- `fontSize`: Optional, default is 26px tall
- `maxWidth`: If set, text wraps at this width

**Anchor values:**
- `top-left`, `top-center`, `top-right`
- `center-left`, `center`, `center-right`
- `bottom-left`, `bottom-center`, `bottom-right`

**How anchors work:**
- `top-left`: x,y is top-left corner, text is left-aligned
- `top-center`: x,y is top-center, text is center-aligned
- `center`: x,y is exact center, text is center-aligned
- `bottom-right`: x,y is bottom-right corner, text is right-aligned

**Example: Place text centered below a rectangle at y=300:**
```javascript
{
  _type: "text",
  shapeId: "my-label",
  x: 200,  // center x of the label
  y: 320,  // just below the rectangle
  anchor: "top-center",
  text: "My Label",
  color: "black"
}
```

### Note Shape

- `_type`: `"note"`
- `shapeId`, `x`, `y`, `color`, `text`
- Notes are 200x200 sticky notes, only suitable for tiny sentences

### Line Shape

- `_type`: `"line"`
- `shapeId`, `color`, `note`
- `x1`, `y1`: Start point
- `x2`, `y2`: End point

### Arrow Shape

Arrows can connect shapes and have special binding properties:

- `_type`: `"arrow"`
- `shapeId`, `color`, `note`
- `x1`, `y1`: Start point
- `x2`, `y2`: End point
- `fromId`: Optional shape ID to bind start to
- `toId`: Optional shape ID to bind end to
- `text`: Optional label on the arrow
- `bend`: Curve amount in pixels (see below)

**Arrow Bend Calculation:**

The `bend` value determines how far the arrow's midpoint is displaced perpendicular to the straight line between endpoints.

To determine the correct sign:
1. Calculate direction vector: `(dx = x2 - x1, dy = y2 - y1)`
2. Positive bend displaces left of the arrow direction
3. Negative bend displaces right of the arrow direction

**Quick reference:**
- Arrow going RIGHT (dx > 0, dy = 0): positive = curves UP, negative = curves DOWN
- Arrow going LEFT (dx < 0, dy = 0): positive = curves DOWN, negative = curves UP
- Arrow going DOWN (dx = 0, dy > 0): positive = curves RIGHT, negative = curves LEFT
- Arrow going UP (dx = 0, dy < 0): positive = curves LEFT, negative = curves RIGHT

---

## Editor API Reference

The `editor` object provides low-level canvas manipulation.

### Creating Shapes

```javascript
// Create a single shape
editor.createShape({
  id: "shape:my-id",  // Must have "shape:" prefix for editor API
  type: "geo",
  x: 100,
  y: 100,
  props: {
    w: 200,
    h: 100,
    geo: "rectangle",
    color: "blue",
    fill: "solid",
    text: "Hello"
  }
})

// Create multiple shapes
editor.createShapes([shape1, shape2, ...])
```

### Updating Shapes

```javascript
// Update specific properties
editor.updateShape({
  id: "shape:my-id",
  x: 200,  // new position
  props: {
    color: "red"  // new color
  }
})

// Update multiple shapes
editor.updateShapes([update1, update2, ...])
```

### Deleting Shapes

```javascript
editor.deleteShape("shape:my-id")
editor.deleteShapes(["shape:id1", "shape:id2"])
```

### Reading Shapes

```javascript
// Get all shapes on current page
const shapes = editor.getCurrentPageShapes()

// Get specific shape
const shape = editor.getShape("shape:my-id")

// Get shape bounds
const bounds = editor.getShapePageBounds("shape:my-id")
```

### Selection

```javascript
editor.setSelectedShapes(["shape:id1", "shape:id2"])
editor.selectAll()
editor.selectNone()
```

### Viewport/Camera

```javascript
editor.zoomToFit()
editor.zoomToBounds({ x: 0, y: 0, w: 500, h: 500 })
editor.setCamera({ x: -100, y: -100, z: 1 })
```

---

## Agent Actions (executeAction)

The `executeAction()` function provides high-level operations that handle common tasks.

### create

Create a new shape:

```javascript
executeAction({
  _type: "create",
  intent: "Create a blue rectangle",
  shape: {
    _type: "rectangle",
    shapeId: "my-rect",
    x: 100,
    y: 100,
    w: 200,
    h: 100,
    color: "blue",
    fill: "solid",
    note: "Main container"
  }
})
```

### move

Move a shape to a new position:

```javascript
executeAction({
  _type: "move",
  intent: "Move rectangle to the right",
  shapeId: "my-rect",
  x: 300,
  y: 100,
  anchor: "top-left"  // Which point of the shape goes to x,y
})
```

### delete

Delete a shape:

```javascript
executeAction({
  _type: "delete",
  intent: "Remove the old label",
  shapeId: "old-label"
})
```

### label

Change a shape's text label:

```javascript
executeAction({
  _type: "label",
  intent: "Update the title",
  shapeId: "my-rect",
  text: "New Title"
})
```

### update

Update shape properties:

```javascript
executeAction({
  _type: "update",
  intent: "Change color to red",
  update: {
    shapeId: "my-rect",
    color: "red",
    fill: "pattern"
  }
})
```

### align

Align multiple shapes:

```javascript
executeAction({
  _type: "align",
  intent: "Align boxes to the left",
  shapeIds: ["box1", "box2", "box3"],
  alignment: "left",  // top, bottom, left, right, center-horizontal, center-vertical
  gap: 0
})
```

### distribute

Distribute shapes evenly:

```javascript
executeAction({
  _type: "distribute",
  intent: "Space out the boxes",
  shapeIds: ["box1", "box2", "box3"],
  direction: "horizontal"  // or "vertical"
})
```

### stack

Stack shapes with consistent gaps:

```javascript
executeAction({
  _type: "stack",
  intent: "Stack boxes vertically",
  shapeIds: ["box1", "box2", "box3"],
  direction: "vertical",
  gap: 20
})
```

### place

Place a shape relative to another:

```javascript
executeAction({
  _type: "place",
  intent: "Put label below the box",
  shapeId: "label",
  referenceShapeId: "box",
  side: "bottom",
  sideOffset: 10,
  align: "center",
  alignOffset: 0
})
```

### bringToFront / sendToBack

Change z-order:

```javascript
executeAction({
  _type: "bringToFront",
  intent: "Bring selection to front",
  shapeIds: ["my-shape"]
})
```

---

## Labels & Sizing Guidelines

### Text Sizing
- Default font size is 26 pixels tall
- Each character is approximately 18 pixels wide
- Label text has 32 pixels of padding on each side

### When to Use Labels
- Only add labels if the user asks for them or if the format requires them
- "Drawing of a cat" → no labels
- "Diagram of a cat" → labels appropriate

### Shape Sizing for Labels
- When shapes have labels, minimum height is 100px
- Flow chart shapes should be at least 200px on any side
- Note shapes are 200x200 and only fit tiny sentences
- Shapes will grow taller to accommodate text

### Background Color Trick
When making white shapes (or black in dark mode):
- Use `fill: "background"` instead of `color: "white"`
- Set `color: "grey"` for a visible border
- This ensures shapes are distinguishable from the background

---

## CLI Tools

### generate.ts - Image Generation

The `generate.ts` CLI is a fully parallel image generation pipeline using Gemini:

1. **Positions below selection** by default (or viewport center if nothing selected)
2. **Runs ALL generations in parallel** (not sequential)
3. **Scales images to display width** while preserving actual aspect ratio
4. **Auto-saves all images** to `/tmp/generate-{timestamp}/` (or custom dir with `-o`)

#### Basic Usage

```bash
cd /Users/slee2/projects/Possibilities/paper
source .env

# Single image
bun scripts/generate.ts "A modern login form UI with blue accents"

# With resolution and aspect ratio
bun scripts/generate.ts "Mobile app splash screen" --resolution 2K --aspect-ratio 9:16

# Square image (icons, avatars)
bun scripts/generate.ts "App icon, friendly firefly" --resolution 1K --aspect-ratio 1:1
```

#### Grounding Images for Style Consistency

Use `--input-image` (repeatable) to provide reference images:

```bash
# Single grounding image
bun scripts/generate.ts "Another screen in the same style" \
  --input-image /tmp/reference.png

# Multiple grounding images
bun scripts/generate.ts "New screen matching these designs" \
  -i /tmp/screen1.png \
  -i /tmp/screen2.png
```

#### Batch Generation (Parallel)

```bash
# Multiple prompts - all run in parallel
bun scripts/generate.ts \
  "Screen 1: Welcome" \
  "Screen 2: Onboarding" \
  "Screen 3: Dashboard" \
  --resolution 2K --aspect-ratio 9:16 --layout row --gap 50
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-r, --resolution` | 1K, 2K, or 4K (image file resolution) | 2K |
| `-a, --aspect-ratio` | 1:1, 9:16, 16:9, 4:3, 3:4, 2:3, 3:2, 4:5, 5:4, 21:9 | 9:16 |
| `-w, --display-width` | Canvas display width in pixels | 400 |
| `-i, --input-image` | Grounding image(s) (repeatable) | - |
| `-l, --layout` | row or column | row |
| `-g, --gap` | Pixels between images | 40 |
| `--x, --y` | Starting position | below selection or viewport center |
| `-o, --output-dir` | Save directory | /tmp/generate-{timestamp} |

**Note:** Images are scaled to `--display-width` (default 400px) while preserving aspect ratio. The `--aspect-ratio` parameter controls the generated image proportions.

### upload.ts - Image Upload

Upload existing images to canvas:

```bash
# Single image at viewport center
bun scripts/upload.ts /path/to/image.png

# Multiple images in a row
bun scripts/upload.ts img1.png img2.png img3.png

# At specific position
bun scripts/upload.ts image.png --x 100 --y 200

# Column layout
bun scripts/upload.ts *.png --layout column --gap 100
```

### export-selected-images.ts - Export Selection

Export selected images to disk for use as grounding:

```bash
# Export selected images
bun scripts/export-selected-images.ts generated/refs

# Then use them as grounding
bun scripts/generate.ts "New screen in same style" \
  -i generated/refs/ref1.png \
  -i generated/refs/ref2.png
```

---

## Workflow Patterns

### Image Generation with Selection Context

**IMPORTANT**: Capture selection bounds FIRST before any operations that might change selection state.

```bash
cd /Users/slee2/projects/Possibilities/paper

# 1. Capture selection bounds BEFORE anything else
BOUNDS=$(curl -s -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "const b = editor.getSelectionPageBounds(); return b ? {x: b.x, y: b.y + b.h + 50} : null"}' | jq -r '.result')
X=$(echo $BOUNDS | jq -r '.x')
Y=$(echo $BOUNDS | jq -r '.y')

# 2. Export selected images (this may change selection)
bun scripts/export-selected-images.ts generated/refs

# 3. Generate with explicit position from saved bounds
source .env && bun scripts/generate.ts \
  "Screen 1" "Screen 2" "Screen 3" \
  -i generated/refs/ref1.png \
  --resolution 2K --aspect-ratio 9:16 --layout row \
  --x $X --y $Y
```

### Get Text from Selection

```bash
curl -s -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "return editor.getSelectedShapes().filter(s => s.props.text).map(s => s.props.text)"}' | jq -r '.result[]'
```

### Creating a Simple Flowchart

```bash
# Create Start box
curl -s -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "executeAction({ _type: \"create\", intent: \"Start box\", shape: { _type: \"rectangle\", shapeId: \"start\", x: 200, y: 100, w: 150, h: 60, color: \"green\", fill: \"solid\", text: \"Start\" } }); return \"ok\""}' | jq .

# Create Process box
curl -s -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "executeAction({ _type: \"create\", intent: \"Process box\", shape: { _type: \"rectangle\", shapeId: \"process\", x: 200, y: 220, w: 150, h: 60, color: \"blue\", fill: \"solid\", text: \"Process\" } }); return \"ok\""}' | jq .

# Create arrow connecting them
curl -s -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "executeAction({ _type: \"create\", intent: \"Arrow\", shape: { _type: \"arrow\", shapeId: \"arrow1\", x1: 275, y1: 160, x2: 275, y2: 220, fromId: \"start\", toId: \"process\", color: \"black\" } }); return \"ok\""}' | jq .
```

---

## Quality Checklist

Before considering your work done, verify:

### Connections
- [ ] Arrows are properly connected to their target shapes (use `fromId`/`toId`)
- [ ] Arrow labels fit within the arrow length
- [ ] No duplicate arrows connecting the same shapes

### Labels & Text
- [ ] Labels fit inside their containing shapes
- [ ] Words are not cut off due to text wrapping (adjust width, not height)
- [ ] Text is properly aligned and spaced

### Layout
- [ ] No unintended overlaps between shapes
- [ ] Shapes that should touch are actually touching
- [ ] Proper spacing between elements
- [ ] Overall composition is balanced

### Arrows
- [ ] Bend direction is correct (verify visually)
- [ ] Arrows don't overlap with other shapes

---

## Important Reminders

1. **Always use curl** to execute commands - don't try to import modules or call APIs directly

2. **Shape IDs in executeAction** use plain strings like `"my-rect"`, but the editor API needs the `"shape:"` prefix: `"shape:my-rect"`

3. **Verify your work** by calling `getCanvasState()` after making changes

4. **Text shapes are special** - remember they use anchor-based positioning, not top-left

5. **When connecting arrows**, use `fromId` and `toId` to bind them to shapes

6. **JSON escaping** - when using curl with JSON, escape inner quotes: `\"text\": \"Hello\"`

7. **Selection gets lost** - always capture bounds BEFORE operations that might change selection

---

## File Locations

- **`generated/`** - Default output for exported images
- **`/tmp/generate-{timestamp}/`** - Auto-saved generated images
- **`scripts/`** - CLI tools (generate.ts, upload.ts, export-selected-images.ts)
