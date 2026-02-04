---
name: tldraw
description: |
  Design partner for tldraw canvas. Use when the user invokes /tldraw to:
  (1) Create UI designs, wireframes, or mockups on the canvas
  (2) Generate visual layouts based on reference images and text prompts
  (3) Manipulate shapes, create diagrams, or build visual artifacts
  (4) Work with selected shapes as context for design tasks
  (5) Generate images with nano-banana-pro and place them on canvas
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

## Image Generation with nano-banana-pro

Generate images and place them on canvas using the nano-banana-pro skill.

### Workflow: Generate and Place Image

```bash
# 1. Generate the image
uv run ~/.claude/skills/nano-banana-pro/scripts/generate_image.py \
  --prompt "A modern login form UI with blue accents, clean minimalist design" \
  --filename "/tmp/generated-ui.png" \
  --resolution 2K

# 2. Place on canvas via eval API
curl -s -X POST http://localhost:3031/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "
    (async () => {
      const asset = await editor.uploadAssetFromUrl(\"file:///tmp/generated-ui.png\");
      editor.createShape({
        type: \"image\",
        x: 500,
        y: 100,
        props: {
          assetId: asset.id,
          w: 400,
          h: 300
        }
      });
      return \"Image placed on canvas\";
    })()
  "}'
```

### Workflow: Edit Selection and Replace

When user wants to transform selected images:

```bash
# 1. Selection extracted via --selection flag contains image data
# 2. Save reference image to disk if needed
# 3. Edit with nano-banana-pro
uv run ~/.claude/skills/nano-banana-pro/scripts/generate_image.py \
  --prompt "Transform this into a cartoon style illustration" \
  --input-image "/tmp/reference.png" \
  --filename "/tmp/edited-output.png" \
  --resolution 2K

# 4. Place result on canvas next to original
```

### Resolution Mapping

- **Thumbnails/icons**: `1K` (default)
- **UI mockups**: `2K`
- **High-fidelity designs**: `4K`

## Design Tasks

### Creating UI Frames (Without Image Gen)

When asked to create UI wireframes using shapes:
1. Use rectangles as frames/containers
2. Use text shapes for labels and content
3. Use appropriate colors (light fills for backgrounds, darker for accents)
4. Maintain consistent spacing (use `stack`, `align`, `distribute` actions)
5. Place designs to the right of or below reference material

### Batch Generation

For multiple variations:
```bash
# Generate 3 variations
for i in 1 2 3; do
  uv run ~/.claude/skills/nano-banana-pro/scripts/generate_image.py \
    --prompt "Modern dashboard UI, variation $i, different color scheme" \
    --filename "/tmp/dashboard-v$i.png" \
    --resolution 2K
done

# Place them in a row on canvas
curl -s -X POST http://localhost:3031/eval -H "Content-Type: application/json" -d '{
  "code": "
    (async () => {
      const files = [\"/tmp/dashboard-v1.png\", \"/tmp/dashboard-v2.png\", \"/tmp/dashboard-v3.png\"];
      let x = 100;
      for (const file of files) {
        const asset = await editor.uploadAssetFromUrl(\"file://\" + file);
        editor.createShape({ type: \"image\", x, y: 100, props: { assetId: asset.id, w: 300, h: 200 } });
        x += 350;
      }
      return \"Placed 3 variations\";
    })()
  "
}'
```

## Quick Reference

### Shape Creation
```javascript
// Rectangle frame
executeAction({ _type: "create", shape: { _type: "rectangle", shapeId: "frame1", x: 100, y: 100, w: 300, h: 200, color: "light-blue", fill: "solid" }})

// Text label
executeAction({ _type: "create", shape: { _type: "text", shapeId: "label1", x: 250, y: 80, anchor: "bottom-center", text: "Header", color: "black" }})
```

### Layout Actions
```javascript
// Stack vertically with gaps
executeAction({ _type: "stack", shapeIds: ["a", "b", "c"], direction: "vertical", gap: 20 })

// Align left edges
executeAction({ _type: "align", shapeIds: ["a", "b", "c"], alignment: "left", gap: 0 })
```

### Image Placement
```javascript
// Place image from file
(async () => {
  const asset = await editor.uploadAssetFromUrl("file:///path/to/image.png");
  editor.createShape({
    type: "image",
    x: 100, y: 100,
    props: { assetId: asset.id, w: 400, h: 300 }
  });
})()
```

### Reading Selection
```javascript
// Get selected shape IDs
const selectedIds = editor.getSelectedShapeIds()

// Get shape details
const shapes = selectedIds.map(id => editor.getShape(id))
```

## Typical Session Flow

1. **User sets up references**: Places images, writes text prompts on canvas
2. **User selects references**: Cmd/Ctrl+click to multi-select
3. **User invokes `/tldraw`**: "Generate a UI based on these references"
4. **Skill extracts selection**: Images and text become context
5. **Generate with nano-banana-pro**: Create new images based on context
6. **Place on canvas**: Position results near/below references
7. **Iterate**: User provides feedback, refine designs

## Assumptions

- Eval server is running (`just dev` in paper/)
- Browser is connected to eval server
- `GEMINI_API_KEY` environment variable set (for nano-banana-pro)
