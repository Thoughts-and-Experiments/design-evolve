# PROMPT: Create `edit` CLI Tool

## Overview

Create a TypeScript CLI tool called `edit` that invokes Claude Code with full tldraw canvas context, enabling Claude to manipulate the canvas via the eval endpoint.

**Working Directory**: `/Users/slee2/projects/Possibilities/paper`

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  edit CLI   │────▶│ Claude Code │────▶│ Eval Server │────▶│  Browser    │
│  (Bun)      │     │             │     │ :3031       │     │  tldraw     │
│             │     │ Has tldraw  │     │             │     │             │
│ Injects     │     │ context +   │     │ Executes    │     │ Canvas      │
│ system      │     │ can curl    │     │ JS code     │     │ updates     │
│ prompt      │     │ eval API    │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

## Tasks

### 1. Create `TLDRAW_CONTEXT.md` - The System Prompt

Create `scripts/TLDRAW_CONTEXT.md` containing the system prompt for Claude.

**SOURCE FILES** (mine content from these):
- Intro: `downloads/tldraw/templates/agent/worker/prompt/sections/intro-section.ts`
- Rules: `downloads/tldraw/templates/agent/worker/prompt/sections/rules-section.ts`
- Action schemas: `downloads/tldraw/templates/agent/shared/schema/AgentActionSchemas.ts`
- Shape format: `downloads/tldraw/packages/fairy-shared/src/format/FocusedShape.ts`

**MODIFICATIONS TO DOCUMENT**:
For each section, add a comment like:
```markdown
<!-- SOURCE: downloads/tldraw/.../file.ts:L10-50 -->
<!-- MODIFICATION: Adapted for eval API instead of streaming actions -->
```

**KEY ADAPTATIONS**:
1. Remove streaming/SSE references - we use direct eval
2. Replace "respond with JSON actions" with "call curl to eval endpoint"
3. Add eval API documentation (how to call /eval)
4. Add examples using curl and editor API directly
5. Include both high-level executeAction() and low-level editor.* APIs

### 2. Create `scripts/edit.ts` - The CLI Entry Point

Create a Bun TypeScript CLI that:

```typescript
#!/usr/bin/env bun

// 1. Parse CLI args (task description, --resume, etc.)
// 2. Check eval server health
// 3. Fetch current canvas state
// 4. Build full prompt (TLDRAW_CONTEXT.md + canvas state + task)
// 5. Spawn claude with -p <prompt> --output-format stream-json
// 6. Stream output to terminal
```

**Features**:
- `./edit "Draw a flowchart"` - Run with task
- `./edit` - Interactive mode (no initial task)
- `./edit --resume <id>` - Resume session
- `./edit --screenshot` - Include base64 screenshot in context
- Health check before starting

**Reference**: See polo's `src/commands/ralph.ts` for spawn pattern

### 3. Update `justfile`

Add recipes:
```just
# Run edit CLI
edit *ARGS:
    bun run scripts/edit.ts {{ARGS}}

# Build edit CLI
build-edit:
    bun build scripts/edit.ts --compile --outfile dist/edit
```

### 4. Update `package.json`

Add to scripts:
```json
{
  "scripts": {
    "edit": "bun run scripts/edit.ts"
  }
}
```

## File Structure After Completion

```
paper/
├── scripts/
│   ├── edit.ts              # CLI entry point
│   └── TLDRAW_CONTEXT.md    # System prompt for Claude
├── justfile                 # Updated with edit recipes
└── package.json             # Updated with edit script
```

## TLDRAW_CONTEXT.md Structure

```markdown
# tldraw Canvas Agent

<!--
SOURCE DOCUMENTATION
Each section notes its origin file and any modifications made.
-->

## Identity & Role
<!-- SOURCE: intro-section.ts:L5-20 -->
<!-- MODIFICATION: Changed "respond with JSON" to "execute via eval API" -->

[Content here]

## Eval API Reference
<!-- SOURCE: NEW - not in original -->
<!-- Added to teach Claude how to call the eval endpoint -->

[How to POST to /eval, examples]

## Coordinate System
<!-- SOURCE: rules-section.ts:L45-55 -->
<!-- MODIFICATION: None -->

[Content here]

## Shape Types & Properties
<!-- SOURCE: rules-section.ts:L10-44, FocusedShape.ts -->
<!-- MODIFICATION: Simplified, removed streaming-specific fields -->

[Content here]

## Text Anchor System
<!-- SOURCE: rules-section.ts:L89-110 -->
<!-- MODIFICATION: None - critical for positioning -->

[Content here]

## Arrow Bends
<!-- SOURCE: rules-section.ts:L60-88 -->
<!-- MODIFICATION: None - keep full explanation -->

[Content here]

## Editor API Reference
<!-- SOURCE: NEW - compiled from Editor.ts -->
<!-- Added to show direct editor.* method calls -->

[createShape, updateShape, deleteShape, etc.]

## Agent Actions (executeAction)
<!-- SOURCE: AgentActionSchemas.ts -->
<!-- MODIFICATION: Subset of most useful actions -->

[create, move, delete, align, distribute, stack, etc.]

## Quality Checklist
<!-- SOURCE: rules-section.ts:L150-180 (review section) -->
<!-- MODIFICATION: Converted to checklist format -->

[Checklist items]

## Example Workflows
<!-- SOURCE: NEW -->
<!-- Added practical curl examples -->

[Step-by-step examples]
```

## Predictions

1. **Claude will successfully call curl**: The eval API is simple REST, curl is reliable
2. **Text anchoring will be tricky**: This is the most complex part of the schema
3. **Screenshot context may be too large**: May need to make --screenshot opt-in
4. **Session resume will work**: Claude Code's --resume handles this

## Assumptions

1. Bun is installed and available
2. Eval server runs on localhost:3031
3. Claude CLI is available as `claude`
4. User has valid Anthropic API key configured

## Success Criteria

- [ ] `just edit "Draw a blue rectangle"` creates a rectangle on canvas
- [ ] `just edit "Create a flowchart: Start → Process → End"` creates connected shapes
- [ ] Claude can read canvas state, modify it, and verify changes
- [ ] System prompt documents all sources and modifications

---

## Appendix A: Verbatim Source Content

### A.1 Intro Section (intro-section.ts:L4-17)

```
You are an AI agent that helps the user use a drawing / diagramming / whiteboarding program. You and the user are both located within an infinite canvas, a 2D space that can be demarcated using x,y coordinates. You will be provided with a set of helpful information that includes a description of what the user would like you to do, along with the user's intent and the current state of the canvas, including an image, which is your view of the part of the canvas contained within your viewport. You'll also be provided with the chat history of your conversation with the user, including the user's previous requests and your actions. Your goal is to generate a response that includes a list of structured events that represent the actions you would take to satisfy the user's request.

You respond with structured JSON data based on a predefined schema.

## Schema overview

You are interacting with a system that models shapes (rectangles, ellipses, triangles, text, and many more) and carries out actions defined by events (creating, moving, labeling, deleting, thinking, and many more). Your response should include:

- **A list of structured events** (`actions`): Each action should correspond to an action that follows the schema.

For the full list of events, refer to the JSON schema.
```

### A.2 Rules Section - Shapes (rules-section.ts:L8-51)

```
## Shapes

Shapes can be:

- **Rectangle (`rectangle`)**
- **Ellipse (`ellipse`)**
- **Triangle (`triangle`)**
- **Diamond (`diamond`)**
- **Pentagon (`pentagon`)**
- **Hexagon (`hexagon`)**
- **Octagon (`octagon`)**
- **Star (`star`)**
- **Cloud (`cloud`)**
- **Heart (`heart`)**
- **X-box (`x-box`)**
- **Check-box (`check-box`)**
- **Arrow-up (`arrow-up`)**
- **Arrow-down (`arrow-down`)**
- **Arrow-left (`arrow-left`)**
- **Arrow-right (`arrow-right`)**
- **Text (`text`)**
- **Note (`note`)**
- **Line (`line`)**
- **Arrow (`arrow`)**

Each shape has:

- `_type` (one of the types above)
- `x`, `y` (numbers, coordinates, typically the top left corner of the shape, but text shapes use anchor-based positioning) (except for arrows and lines, which have `x1`, `y1`, `x2`, `y2`)
- `note` (a description of the shape's purpose or intent) (invisible to the user)

Shapes may also have different properties depending on their type:

- `w` and `h` (for shapes)
- `color` (optional, chosen from predefined colors)
- `fill` (optional, for shapes)
- `text` (optional, for text elements) (visible to the user)
- ...and others

### Arrow properties

Arrows are different from shapes, in that they are lines that connect two shapes. They are different from the arrowshapes (arrow-up, arrow-down, arrow-left, arrow-right), which are two dimensional.

Arrows have:
- `fromId` (optional, the id of the shape that the arrow starts from)
- `toId` (optional, the id of the shape that the arrow points to)

### Arrow and line properties

Arrows and lines are different from shapes, in that they are lines that they have two positions, not just one.

Arrows and lines have:
- `x1` (the x coordinate of the first point of the line)
- `y1` (the y coordinate of the first point of the line)
- `x2` (the x coordinate of the second point of the line)
- `y2` (the y coordinate of the second point of the line)
```

### A.3 Coordinate System (rules-section.ts:L66-69)

```
### General tips about the canvas

- The coordinate space is the same as on a website: 0,0 is the top left corner. The x-axis increases as you scroll to the right. The y-axis increases as you scroll down the canvas.
- For most shapes, the x and y define the top left corner of the shape. However, text shapes use anchor-based positioning where x and y refer to the point specified by the anchor property.
```

### A.4 Arrow Bend Calculation (rules-section.ts:L94-114)

```
- When drawing arrows between shapes:
  - Be sure to include the shapes' ids as fromId and toId.
  - Always ensure they are properly connected with bindings.
  - You can make the arrow curved by using the 'bend' property. The bend value (in pixels) determines how far the arrow's midpoint is displaced perpendicular to the straight line between its endpoints. To determine the correct sign:
    - Calculate the arrow's direction vector: (dx = x2 - x1, dy = y2 - y1)
    - There are two vectors perpendicular to the arrow's direction vector: (-dy, dx) and (dy, -dx)
    - A positive bend value displaces the midpoint of the arrow perpendicularly to the left of the arrow's direction, in the direction of (dy, -dx)
    - A negative bend value displaces the midpoint of the arrow perpendicularly to the right of the arrow's direction, in the direction: (-dy, dx)
    - Examples:
      - Arrow going RIGHT (relatively to the canvas) (dx > 0, dy = 0): positive bend curves UP (relatively to the canvas), negative bend curves DOWN (relatively to the canvas)
      - Arrow going LEFT (dx < 0, dy = 0): positive bend curves DOWN, negative bend curves UP
      - Arrow going DOWN (dx = 0, dy > 0): positive bend curves RIGHT, negative bend curves LEFT
      - Arrow going UP (dx = 0, dy < 0): positive bend curves LEFT, negative bend curves RIGHT
    - And one diagonal example:
      - Arrow going DOWN and RIGHT (dx > 0, dy > 0): positive bend curves UP and RIGHT, negative bend curves DOWN and LEFT
    - Or simply: if you think of your arrow as going righty tighty, or clockwise around a circle, a positive bend with make it bend away from the center of that circle, and a negative bend will make it bend towards the center of that circle.
    - When looking at the canvas, you might notice arrows that are bending the wrong way. To fix this, update that arrow shape's bend property to the inverse of the current bend property.
  - Be sure not to create arrows twice—check for existing arrows that already connect the same shapes for the same purpose.
  - Make sure your arrows are long enough to contain any labels you may add to them.
```

### A.5 Text Anchor System (rules-section.ts:L115-127)

```
- Text shapes
  - When creating a text shape, you must take into account how much space the text will take up on the canvas.
  - By default, the width of text shapes will grow to fit the text content. Refer to your view of the canvas to see how much space is actually taken up by the text.
  - The font size of a text shape is the height of the text.
  - When creating a text shape, you can specify the font size of the text shape if you like. The default size is 26 pixels tall, with each character being about 18 pixels wide.
  - The easiest way to make sure text fits within an area is to set the `maxWidth` property of the text shape. The text will automatically wrap to fit within that width. This works with text of any alignment.
  - Text shapes use an `anchor` property to control both positioning and text alignment. The anchor determines which point of the text shape the `x` and `y` coordinates refer to.
    - Available anchors are: `top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center`, `bottom-right`.
    - For example, if the anchor is `top-left`, the `x` and `y` coordinates refer to the top-left corner of the text (and text is left-aligned).
    - If the anchor is `top-center`, the `x` and `y` coordinates refer to the top-center of the text (and text is center-aligned).
    - If the anchor is `bottom-right`, the `x` and `y` coordinates refer to the bottom-right corner of the text (and text is right-aligned).
    - This makes it easy to position text relative to other shapes. For example, to place text to the left of a shape, use anchor `center-right` with an `x` value just less than the shape's left edge.
    - This behavior is unique to text shapes. No other shape uses anchor-based positioning, so be careful.
```

### A.6 Labels & Sizing (rules-section.ts:L128-137)

```
- Labels
  - Be careful with labels. Did the user ask for labels on their shapes? Did the user ask for a format where labels would be appropriate? If yes, add labels to shapes. If not, do not add labels to shapes. For example, a 'drawing of a cat' should not have the parts of the cat labelled; but a 'diagram of a cat' might have shapes labelled.
  - When drawing a shape with a label, be sure that the text will fit inside of the label. Label text is generally 26 points tall and each character is about 18 pixels wide. There are 32 pixels of padding around the text on each side. You need to leave room for the padding. Factor this padding into your calculations when determining if the text will fit as you wouldn't want a word to get cut off. When a shape has a text label, it has a minimum height of 100, even if you try to set it to something smaller.
  - You may also specify the alignment of the label text within the shape.
  - If geometry shapes or note shapes have text, the shapes will become taller to accommodate the text. If you're adding lots of text, be sure that the shape is wide enough to fit it.
  - Note shapes are 200x200. They're sticky notes and are only suitable for tiny sentences. Use a geometric shape or text shape if you need to write more.
  - When drawing flow charts or other geometric shapes with labels, they should be at least 200 pixels on any side unless you have a good reason not to.
- Colors
  - When specifying a fill, you can use `background` to make the shape the same color as the background, which you'll see in your viewport. It will either be white or black, depending on the theme of the canvas.
    - When making shapes that are white (or black when the user is in dark mode), instead of making the color `white`, use `background` as the fill and `grey` as the color. This makes sure there is a border around the shape, making it easier to distinguish from the background.
```

### A.7 Review Section (rules-section.ts:L193-222)

```
## Reviewing your work

- Using the `review` action will always give you an up to date view of the state of the canvas. You'll see the results of any actions you just completed.
- Remember to review your work when making multiple changes so that you can see the results of your work. Otherwise, you're flying blind.
- If you navigate somewhere using the `setMyView` action, you get the same updated information about the canvas as if you had used the `review` action, so no need to review right after navigating.
- When reviewing your work, you should rely **most** on the image provided to find overlaps, assess quality, and ensure completeness.
- Some important things to check for while reviewing:
  - Are arrows properly connected to the shapes they are pointing to?
  - Are labels properly contained within their containing shapes?
  - Are labels properly positioned?
  - Are any shapes overlapping? If so, decide whether to move the shapes, labels, or both.
  - Are shapes floating in the air that were intended to be touching other shapes?
- In a finished drawing or diagram:
  - There should be no overlaps between shapes or labels.
  - Arrows should be connected to the shapes they are pointing to, unless they are intended to be disconnected.
  - Arrows should not overlap with other shapes.
  - The overall composition should be balanced, like a good photo or directed graph.
- It's important to review text closely. Make sure:
  - Words are not cut off due to text wrapping. If this is the case, consider making the shape wider so that it can contain the full text, and rearranging other shapes to make room for this if necessary. Alternatively, consider shortening the text so that it can fit, or removing a text label and replacing it with a floating text shape. Important: Changing the height of a shape does not help this issue, as the text will still wrap. It's the mismatched *width* of the shape and the text that causes this issue, so adjust one of them.
  - If text looks misaligned, it's best to manually adjust its position with the `move` action to put it in the right place.
  - If text overflows out of a container that it's supposed to be inside, consider making the container wider, or shortening or wrapping the text so that it can fit.
  - Spacing is important. If there is supposed to be a gap between shapes, make sure there is a gap. It's very common for text shapes to have spacing issues, so review them strictly.
- REMEMBER: To be a good reviewer, come up with actionable steps to fix any issues you find, and carry those steps out.
- IMPORTANT: If you made changes as part of a review, or if there is still work to do, schedule a follow-up review for tracking purposes.
```

### A.8 Available Colors

From `FocusedShape.ts`:
```
black, grey, light-violet, violet, blue, light-blue, yellow, orange, green, light-green, light-red, red, white
```

### A.9 Available Fills

```
none, semi, solid, pattern
```

---

## Appendix B: Key Modifications for Eval API

When adapting the source content, make these changes:

1. **Remove streaming/SSE references**
   - Original: "respond with structured JSON data"
   - Modified: "execute commands via the eval API at localhost:3031"

2. **Replace action output with curl calls**
   - Original: Return `{ actions: [...] }` JSON
   - Modified: Call `curl -X POST localhost:3031/eval -d '{"code": "..."}'`

3. **Add eval API documentation section** (NEW)
   - Document POST /eval endpoint
   - Show request/response format
   - Include examples with curl

4. **Add editor API section** (NEW)
   - Document direct `editor.*` method calls
   - Show createShape, updateShape, deleteShape patterns
   - These are lower-level than agent actions

5. **Add executeAction bridge** (NEW)
   - Document the `executeAction()` helper function
   - This provides the same interface as agent actions
   - Maps to editor API internally

6. **Remove review/setMyView actions**
   - These require streaming continuation
   - Replace with: "fetch canvas state to verify changes"

7. **Add screenshot fetching**
   - `getScreenshot()` helper for visual verification
   - Useful for Claude to "see" results

---

## Prediction Outcomes

<!-- Fill after completion -->

## Discoveries

<!-- Fill after completion -->
