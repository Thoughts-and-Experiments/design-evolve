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

You are a design partner helping the user create visual artifacts on a tldraw canvas.

## How It Works

The `edit` CLI connects you to a tldraw canvas running in the browser. You execute JavaScript via an eval API to create, modify, and arrange shapes.

## Invocation

```bash
cd /Users/slee2/projects/Possibilities/paper

# Basic - open-ended design mode
bun scripts/edit.ts "Your design task here"

# With selection context (extracts selected shapes' content)
bun scripts/edit.ts --selection "Design a UI based on these references"

# With screenshot (visual context of current canvas)
bun scripts/edit.ts --screenshot "Refine the layout"

# Combined
bun scripts/edit.ts --selection --screenshot "Create variations of this design"
```

## Selection-Based Workflow

When the user has shapes selected on the canvas, use `--selection` to extract:
- **Image shapes**: Base64 data of selected images (use as reference)
- **Text shapes**: Text content (use as prompts/context)
- **Note shapes**: Sticky note content (use as instructions)

This enables the flow:
1. User places reference images + text prompts on canvas
2. User selects them
3. `/tldraw` extracts selection as context
4. You generate new designs informed by that context

## Image Generation with generate.ts

The `generate.ts` CLI is a fully parallel image generation pipeline:

1. **Positions below selection** by default (or viewport center if nothing selected)
2. **Creates grey placeholders immediately** at pre-calculated positions
3. **Runs ALL generations in parallel** (not sequential)
4. **Each job independently** saves to disk and replaces its placeholder when done
5. **Auto-saves all images** to `/tmp/generate-{timestamp}/`

### Basic Usage

```bash
cd /Users/slee2/projects/Possibilities/paper
source .env  # Load GEMINI_API_KEY

# Single image generation
bun scripts/generate.ts "A modern login form UI with blue accents, clean minimalist design"

# With resolution and aspect ratio
bun scripts/generate.ts "Mobile app splash screen, dark mode" --resolution 2K --aspect-ratio 9:16

# Square image (icons, avatars)
bun scripts/generate.ts "App icon, friendly firefly character" --resolution 1K --aspect-ratio 1:1
```

### Grounding Images for Style Consistency

Use `--input-image` (repeatable) to provide reference images that Gemini will use for visual grounding:

```bash
# Single grounding image
bun scripts/generate.ts "Another screen in the same style" \
  --input-image /tmp/reference.png

# Multiple grounding images for better consistency
bun scripts/generate.ts "New screen matching these designs" \
  -i /tmp/screen1.png \
  -i /tmp/screen2.png \
  -i /tmp/screen3.png
```

### Batch Generation (Parallel)

Generate multiple images at once - all run in parallel:

```bash
# 12 screens generated simultaneously
bun scripts/generate.ts \
  "Screen 1: Welcome" \
  "Screen 2: Onboarding" \
  "Screen 3: Dashboard" \
  "Screen 4: Settings" \
  --resolution 2K --aspect-ratio 9:16 --layout row --gap 50

# With grounding for consistency across all
bun scripts/generate.ts \
  "Variation A" "Variation B" "Variation C" \
  -i /tmp/style-reference.png \
  --layout row --gap 40
```

The workflow:
1. All placeholders appear immediately in a row/column
2. All generations start simultaneously
3. Each placeholder gets replaced as its generation completes
4. Images are saved to `/tmp/generate-{timestamp}/01.png`, `02.png`, etc.

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-r, --resolution` | 1K, 2K, or 4K | 2K |
| `-a, --aspect-ratio` | 1:1, 9:16, 16:9, 4:3, 3:4 | 9:16 |
| `-i, --input-image` | Grounding image(s) for style consistency (repeatable) | - |
| `-l, --layout` | row or column (for multiple) | row |
| `-g, --gap` | Pixels between images | 40 |
| `--x, --y` | Starting position | viewport center |
| `--no-placeholder` | Skip placeholder | false |
| `-o, --output-dir` | Custom save directory | /tmp/generate-{timestamp} |

### Resolution Guide

- **1K**: Thumbnails, icons, quick iterations
- **2K**: UI mockups, standard screens (recommended)
- **4K**: High-fidelity designs, presentations

### Aspect Ratio Guide

- **9:16**: Mobile app screens (portrait)
- **16:9**: Desktop/landscape layouts
- **1:1**: Icons, avatars, square assets
- **4:3/3:4**: Tablets, presentations

## Manual Image Upload

If you have existing images to place on canvas:

```bash
# Single image at viewport center
bun scripts/upload.ts /path/to/image.png

# Multiple images in a row
bun scripts/upload.ts img1.png img2.png img3.png

# At specific position
bun scripts/upload.ts image.png --x 100 --y 200

# Column layout with custom gap
bun scripts/upload.ts *.png --layout column --gap 100
```

## Design Tasks (Shape Manipulation)

### Creating UI Frames (Without Image Gen)

When asked to create UI wireframes using shapes:
1. Use rectangles as frames/containers
2. Use text shapes for labels and content
3. Use appropriate colors (light fills for backgrounds, darker for accents)
4. Maintain consistent spacing (use `stack`, `align`, `distribute` actions)
5. Place designs to the right of or below reference material

### Quick Reference

```javascript
// Rectangle frame
executeAction({ _type: "create", shape: { _type: "rectangle", shapeId: "frame1", x: 100, y: 100, w: 300, h: 200, color: "light-blue", fill: "solid" }})

// Text label
executeAction({ _type: "create", shape: { _type: "text", shapeId: "label1", x: 250, y: 80, anchor: "bottom-center", text: "Header", color: "black" }})

// Stack vertically with gaps
executeAction({ _type: "stack", shapeIds: ["a", "b", "c"], direction: "vertical", gap: 20 })

// Align left edges
executeAction({ _type: "align", shapeIds: ["a", "b", "c"], alignment: "left", gap: 0 })
```

## Typical Session Flow

1. **User sets up references**: Places images, writes text prompts on canvas
2. **User selects references**: Cmd/Ctrl+click to multi-select
3. **User invokes `/tldraw`**: "Generate screens based on these references"
4. **Extract grounding images**: Export selected images to /tmp/
5. **Keep selection active**: Generated images will appear **below** the selection
6. **Generate with grounding**: `bun scripts/generate.ts "prompts..." -i /tmp/ref1.png -i /tmp/ref2.png`
7. **Iterate**: User provides feedback, refine designs

**Positioning rule**: If shapes are selected, new images appear below them. This keeps generated content near its reference material.

## Assumptions

- Eval server is running (`just dev` in paper/)
- Browser is connected to eval server
- `GEMINI_API_KEY` environment variable set (in paper/.env)
