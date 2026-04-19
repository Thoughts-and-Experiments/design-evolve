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

# Prefer the installed canonical eval_helper (always current), fall back to repo copy.
# The repo copy can lag behind the installed one; the installed one is the source of truth.
if [ -f "$HOME/.claude/skills/design-evolve/scripts/eval_helper.py" ]; then
  EH="python3 $HOME/.claude/skills/design-evolve/scripts/eval_helper.py"
else
  EH="python3 $REPO_ROOT/skills/design-evolve/scripts/eval_helper.py"
fi
```

**Sanity check the helper version** before proceeding. The helper must support `connect-session`, `wait-for-capture`, and `set-status` — the skill hard-depends on these. Run:
```bash
$EH 2>&1 | grep -q "connect-session" && echo "helper: ok" || echo "helper: STALE — sync from ~/.claude/skills/design-evolve/scripts/eval_helper.py"
```

If stale, copy the installed canonical version over the repo's copy and re-source:
```bash
cp "$HOME/.claude/skills/design-evolve/scripts/eval_helper.py" "$REPO_ROOT/skills/design-evolve/scripts/eval_helper.py"
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

**Auto-fix reversible/non-destructive issues without asking** — just tell the user what you're doing and do it. Only stop to ask for things that actually need user input (e.g., API keys). Actions:

- **Eval server not running**: AUTO-START. Tell the user "Starting dev servers in the background…" and run:
  ```bash
  cd $PAPER && npm start > /tmp/design-evolve-npm.log 2>&1 &
  # then poll until both are up (up to ~15s)
  until curl -s http://localhost:5173 > /dev/null && curl -s http://localhost:3031/health > /dev/null; do sleep 1; done
  ```
  Run `npm start` in the background (via Bash `run_in_background: true`) so the skill keeps moving.
- **Browser not connected**: AUTO-OPEN the Chrome tab yourself via the claude-in-chrome MCP (navigate to `http://localhost:5173`), then re-poll `$EH health` until `browserConnected: true` (up to ~10s).
- **Missing deps** (`node_modules`): AUTO-RUN `cd $PAPER && npm install`. Tell the user it's running.
- **Missing bun**: AUTO-RUN `npm install -g bun`.
- **Missing .env**: STOP AND ASK — this needs the user's Gemini API key (get one at https://aistudio.google.com/apikey). Can't auto-fix.

Rule of thumb: **if the fix is a canonical "start the thing" or "install the thing" inside this repo, just do it and narrate.** Don't ask permission for idempotent, reversible local actions.

### Health check

After auto-fixes, verify the full pipeline:
```bash
cd $PAPER && source .env && $EH health
```

Expect `{"status": "ok", "browserConnected": true}`.

---

## Python eval helper

**All canvas operations use the bundled `eval_helper.py`** instead of raw curl commands. This reduces the number of Bash calls (each needs user approval) and avoids shell escaping issues with curl/JSON.

Key commands (always use the `$EH` variable set during prerequisites):
```
# Session & connection
$EH connect-session                     # Bootstrap: health check, auto-save, inject overlay
$EH health                              # Check connection
$EH list-sessions                       # List saved session snapshots
$EH save-snapshot <file.tldr>           # Save canvas state to file
$EH load-snapshot <file.tldr>           # Restore canvas state from file

# Canvas basics
$EH clear                               # Delete all shapes
$EH zoom-to-fit                         # Zoom to fit
$EH get-images                          # List all images
$EH get-latest                          # Latest image per row
$EH eval "editor.zoomToFit()"           # Run arbitrary JS

# Context capture & feedback
$EH wait-for-capture [--timeout 120]    # Poll until user clicks Send Context
$EH extract-user-assets <output_dir>    # Extract user-pasted reference images
$EH extract-feedback <output_dir>       # Annotations → text + screenshots + clean images
$EH detect-annotations                  # Raw annotation detection

# Status indicators
$EH set-status <state> <msg> [--current N --total N]  # Update status bar
$EH clear-status                        # Reset status to idle

# Image operations
$EH screenshot <frame_id> <output.png>  # Screenshot a frame region
$EH export-clean <image_id> <output.png>  # Export clean original
$EH place-images <dir> [--display-width 400]  # Place PNGs from dir (legacy)
$EH place-evolved <img.png> <orig_shape_id> <iter> <candidate_num>  # (legacy)

# Loading-placeholder flow (preferred — images pop in as each finishes)
$EH place-placeholders <n> [--display-width 400] [--aspect-ratio 9:16]
$EH swap-placeholder <candidate_num> <image.png> [--display-width 400]
$EH place-evolve-placeholders <iter> <orig_id_1> <orig_id_2> … [--display-width 400] [--aspect-ratio 9:16]
$EH swap-evolve-placeholder <iter> <candidate_num> <image.png> [--display-width 400]
$EH mark-placeholder-failed <candidate_num> [<iteration>]   # turn a stuck placeholder red

# Smart layout
$EH place-group --source SHAPE_ID --count N --item-w W --item-h H [--gap 20] [--padding 40] [--prefix STR] [--label STR] [--color violet]

# Agent trace notes (orange post-it near the work)
$EH place-agent-note "<succinct summary of what you just did>" [--anchor SHAPE_ID] [--direction below|right] [--width 320] [--id note-id] [--kind trace|question]

# Derivation arrow (dotted grey, center → center)
$EH place-trace-arrow <src_shape_id> <dst_shape_id>
```

**Combine multiple commands in a single Bash call** using `&&` or `;` to minimize approvals.

---

## Canvas-mutation discipline (MANDATORY — applies to every round, every ad-hoc action)

Whenever the skill writes anything to the canvas, it MUST also leave a visible trace. This is what makes the canvas self-documenting — the user can audit what the skill did without reading chat.

**After every canvas mutation:**

1. **Drop one orange trace note** (`$EH place-agent-note "<≤20-word summary>" --anchor <newest-shape-id> --direction below`) describing what you just placed/changed and why. Anchor to the newest or most-representative new shape.
   - One sentence, ≤20 words, present tense ("Placed mobile + desktop screenshots of the live app." not "Here are the…"). 
   - One note per *action*, not per shape. Don't spam — e.g. one note for "Placed 6 seed candidates", not six notes.

2. **If the new content is derivative** of an existing shape on the canvas (a user sticky note asking for it, an annotation, a reference image the user provided, a prior iteration), **also** draw a dotted grey trace arrow from source → destination:
   ```bash
   $EH place-trace-arrow <source_shape_id> <newest_shape_id>
   ```
   Multiple sources → one arrow per source. Skip if the new content is not derived from any existing shape (fresh seed round with no user input is not derivative).

**Canvas-mutating commands that require this follow-up:**
- `clear`, `place-images`, `place-evolved`, `place-placeholders`, `swap-placeholder`, `place-evolve-placeholders`, `swap-evolve-placeholder`, `mark-placeholder-failed`, `place-group`, any raw `eval` that adds/removes shapes, any Read-tool-driven placement of user-provided assets.
- Exceptions: `zoom-to-fit`, `screenshot`, `export-clean`, `get-images`, `get-latest`, `detect-annotations`, `extract-*`, `set-status` — these are read-only or metadata operations and do not need a trace.

**How to identify sources for the arrow:** before mutating, inspect the canvas with `$EH detect-annotations` or `editor.getCurrentPageShapes()`. Any user-authored sticky note, drawing, or pasted image that prompted your action is a candidate source — capture its shape ID and pass it to `place-trace-arrow` after your mutation lands.

**Example — user drops a sticky note asking for mobile/desktop reference screenshots:**

```bash
# 1. You detect the user's sticky note at shape:abc123
# 2. You place two screenshots via place-images → returns ids shape:img-mobile, shape:img-desktop
# 3. IMMEDIATELY after:
$EH place-agent-note "Placed mobile + desktop reference screenshots of live infinite-remix app." --anchor shape:img-mobile --direction below
$EH place-trace-arrow shape:abc123 shape:img-mobile
$EH place-trace-arrow shape:abc123 shape:img-desktop
```

Failure to leave a trace is a skill-level bug — if you wrote to the canvas without a trace, go back and add it before ending the turn.

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
cd $PAPER && $EH clear && $EH connect-session
```

---

## Step 0.1: ANNOUNCE + OPEN WAIT (two-channel onboarding)

**Before asking the user anything**, surface the canvas link and enter a blocking `wait-for-capture`. This way the user has two equivalent channels from the very first second: **terminal input** *or* **Send Context in the browser**.

Tell the user (exact wording — include the URL as a clickable link):

> **Canvas is live at http://localhost:5173** — a Chrome tab should already be open. You can drop reference screenshots, sketch, or add sticky notes there at any time.
>
> Tell me what you want to design (one line is fine), then either:
> - **Type your answer here**, or
> - **Drop refs/notes on the canvas**, then **right-click → Send Context**.
>
> Either way wakes me up.

Then immediately enter the wait:

```bash
$EH set-status waiting "Waiting for your brief — type in terminal or right-click → Send Context"
$EH wait-for-capture --timeout 300
```

- **On click**: parse the capture payload, pull any pasted reference images with `$EH extract-user-assets /tmp/evolve-refs`, and proceed with whatever context is on the canvas plus whatever the user typed before clicking.
- **On terminal input (Ctrl-C cancels wait)**: the user's typed message becomes the next turn — re-enter the wait only if you still need more info.
- **On timeout**: `$EH set-status idle "Session paused — type in terminal to resume"` and end the turn.

**General rule for the whole skill**: every time you ask the user a clarifying question, wrap it in `wait-for-capture` so Send Context remains a live channel. Never end a turn on a plain chat question unless the user has indicated they're done.

---

## Step 0.5: MODE SELECTION

Before seeding, decide which mode the user wants:

- **Greenfield mode** — they described an app/feature from scratch. No existing codebase or screenshots. Skip straight to Step 1.
- **Codebase-aligned mode** — they want to explore a new feature, layout, or redesign of a page that already exists in a repo. Seeds should inherit the project's design system (colors, typography, spacing, component shapes) and optionally remix an existing page layout.

Ask the user once if unclear:
> Is this a fresh exploration, or are we iterating on an existing page/feature in a repo? If existing, point me at the repo path and tell me what page you want to explore.

### Codebase-aligned mode — preparation

If codebase-aligned, do the following BEFORE Step 1.

**1. Extract design tokens from the repo.** Read the user's project files to build a token summary. Prioritize in this order:
- `tailwind.config.js` / `tailwind.config.ts` — look for `theme.extend.colors`, fonts, spacing
- Global CSS file (`index.css`, `globals.css`, `app.css`) — look for CSS custom properties (`--color-*`, `--font-*`)
- A representative component file the user names (or infer from `src/pages/` or `src/components/`) — read it to understand typography scale, border-radius conventions, button/card shapes, layout density
- Any `CLAUDE.md` in the repo that documents design decisions

Produce a compact tokens blob you'll inject into every prompt, e.g.:
```
Design system: cream bg #fffaf3, dark-brown text #302108, mustard accent #f69c07,
cream-dark borders #f5edd8. Typography: serif headers, sans body, text-base
minimum for elderly audience. Components: rounded-xl cards (~12px), dark-brown
CTA buttons with cream text, no mustard CTAs.
```

**2. (Optional) Anchor on a screenshot of the existing page.** If the user wants to iterate on an existing layout rather than freely explore:
- Ask them to screenshot the live page (via Chrome MCP if connected, or manually drag a screenshot into the tldraw canvas, or paste from clipboard).
- Run `$EH extract-user-assets /tmp/evolve-refs` to pull the screenshot out as a PNG file.
- You now have a reference image path to pass as `--input-image` to `generate.ts`.

**3. Craft seed prompts that EDIT the screenshot (image-to-image) OR re-imagine the feature freshly (text-to-image with tokens).** Mix both across the 6 candidates — some preserve the original layout and restyle, others propose new layouts from scratch. This gives the user both "polish what exists" and "what if we did it differently" in one board.

**4. Drop an agent note on the canvas** describing the mode and tokens you picked, anchored to the current session. This is the trace for the user to audit your interpretation before generation kicks off:

```bash
cd $PAPER && $EH place-agent-note "Mode: codebase-aligned. Repo: <path>. Tokens: <2-line summary>. Anchoring 3/6 candidates on screenshot, 3/6 free explorations." --width 420
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

**If in codebase-aligned mode:**
- Prepend the tokens blob (from Step 0.5) to every prompt so Gemini adheres to the project's design system.
- Mix strategies across the 6: e.g. 3 that remix the reference screenshot (`--input-image /tmp/evolve-refs/*.png`) at varying degrees of layout divergence, and 3 text-only free explorations of the same feature grounded in the tokens. You decide the split based on how much the user wants to diverge — ask if unclear.
- When using `--input-image`, frame the prompt as editing instructions rather than "Flat UI screenshot of…".

**CRITICAL prompt rules — these prevent bad generations:**
- ALWAYS start with: "Flat UI design of a [app type] interface, full-bleed, interface content only — no status bar, no top phone chrome, no notch, no battery icon, no time display, no home indicator. The image should be entirely the app's workspace and controls."
- Think of the image as a **Figma frame** containing the app UI — no OS chrome, no device bezels, no system indicators. The entire canvas is app content.
- NEVER mention the physical device (no "iPad", "iPhone", "laptop") — this causes Gemini to generate a PHOTO of the device from a weird angle instead of a flat UI
- NEVER use words like "mockup", "render", "3D", "perspective", "device", "screen" — these trigger photos or nudge Gemini toward adding a status bar
- Always describe the UI CONTENT directly: buttons, panels, colors, layout regions
- Think of it as describing what appears INSIDE an app's workspace, not what a phone screen looks like

Example for "a drawing app for iPad":
1. "Flat UI screenshot of a drawing app screen, clean minimalist white canvas, slim floating toolbar on left with pencil brush eraser icons, subtle pastel color palette at bottom, thin top bar with layers and undo redo, large open canvas area, light grey workspace"
2. "Flat UI screenshot of a drawing app screen, dark mode professional interface, deep charcoal background, glowing neon accent toolbar icons on left rail, circular color wheel overlay, brush size slider, layer panel on right side"
3. "Flat UI screenshot of a drawing app screen, playful colorful design, rounded bubbly toolbar buttons, rainbow color strip at bottom, friendly icons with soft shadows, stamp and sticker tools visible, bright white canvas with dotted grid"
4. "Flat UI screenshot of a drawing app screen, skeuomorphic wooden desk aesthetic, textured paper canvas, realistic pencil paintbrush tool icons in wooden tray at bottom, torn edge paper layers panel, warm natural tones"
5. "Flat UI screenshot of a drawing app screen, glassmorphism UI, translucent frosted toolbar panels floating over canvas, vibrant gradient accent colors, compact icon-only left toolbar, properties panel on right with sliders, futuristic design"
6. "Flat UI screenshot of a drawing app screen, split view layout, reference image panel on left third, main drawing canvas on right two thirds, compact top toolbar with symmetry and grid toggles, muted blue grey color scheme"

### 1c. Drop placeholders, then generate with live swap (PREFERRED FLOW)

This is the demo-friendly flow: 6 dashed gray boxes labeled "Generating…" appear immediately, then each is replaced by its real image as generation finishes. Images pop in one by one — no silent staring at a blank canvas.

**Step 1** — drop placeholders and frames (instant, before any generation):

```bash
cd $PAPER && $EH place-placeholders 6 --display-width 400 --aspect-ratio CHOSEN_RATIO
```

**Step 2** — fire 6 parallel generations, each swapping its placeholder as it finishes:

```bash
cd $PAPER && source .env

PROMPTS=(
  "prompt 1"
  "prompt 2"
  "prompt 3"
  "prompt 4"
  "prompt 5"
  "prompt 6"
)

for N in 0 1 2 3 4 5; do
  (bun scripts/generate.ts "${PROMPTS[$N]}" \
    --resolution 2K --aspect-ratio CHOSEN_RATIO --no-upload \
    -o /tmp/evolve-seed-$((N + 1)) \
    && $EH swap-placeholder $((N + 1)) /tmp/evolve-seed-$((N + 1))/01.png \
    || $EH mark-placeholder-failed $((N + 1))) &
done
wait

$EH zoom-to-fit
```

Each candidate writes to its own `/tmp/evolve-seed-N` directory so there are no file-name collisions. The `&&` guarantees `swap-placeholder` only runs if `generate.ts` succeeded; the `||` marks a failed candidate in red so you don't stare at a stuck placeholder.

After this completes:
- `shape:placeholder-1..6` and `shape:loading-1..6` are gone (deleted during swap)
- `shape:seed-img-1..6` now hold the real images (same IDs as the legacy flow — downstream commands are unchanged)
- `shape:frame-0..5` and `shape:label-0..5` are the frames and "Candidate N" labels

### 1c-legacy. Batch-then-place flow (fallback)

If the placeholder flow misbehaves, you can fall back to generating all 6 first, then placing them in one shot:

```bash
cd $PAPER && source .env && bun scripts/generate.ts \
  "prompt 1" "prompt 2" "prompt 3" "prompt 4" "prompt 5" "prompt 6" \
  --resolution 2K --aspect-ratio CHOSEN_RATIO --no-upload

cd $PAPER && \
  $EH place-images /tmp/generate-TIMESTAMP --display-width 400 && \
  $EH create-frames && \
  $EH zoom-to-fit
```

Canvas will be blank while generation runs, then all 6 appear at once.

### 1d. Drop a trace note on the canvas

Leave an orange agent-note anchored to Candidate 1's frame summarizing the seed strategy (modes mix, tokens used, anything notable about your prompt choices). This gives the user a visible audit trail of your reasoning without having to read chat.

```bash
cd $PAPER && $EH place-agent-note "Seed round: 6 candidates. Strategy: <1-2 lines, e.g. '3 minimalist, 2 playful, 1 dark-mode'. Tokens: <key tokens if codebase-aligned>." --anchor shape:frame-0 --direction below --width 420
```

Keep the note succinct — 1–3 lines max. If in codebase-aligned mode, include the repo path and which candidates used `--input-image` vs. text-only.

### 1e. Tell the user, then block on Send Context

After seed generation, tell the user:
> I've generated 6 candidate designs on the canvas. Each one is framed and labeled (Candidate 1–6).
>
> **To give feedback:** Draw directly on any candidate — circle areas you like, cross out parts you don't, add sticky notes or text with specific instructions. Your annotations on any candidate will be applied as feedback to ALL candidates in the next evolution round.
>
> **When you're ready**, right-click the canvas → **Send Context**. I'll pick up the canvas state and evolve the designs.

Then immediately enter the blocking wait (see Step 2). **Do not end the turn.**

---

## Step 2: REVIEW — block on Send Context

**This is the mandatory end-of-round pattern. Every round ends here.** Set status to waiting, then block until the user clicks Send Context on the overlay pill:

```bash
$EH set-status waiting "Ready for feedback — right-click canvas → Send Context"
$EH wait-for-capture --timeout 300
```

- **On click**: `wait-for-capture` returns with the captured payload (selected shape ids, all shape ids, any metadata). Parse it, then proceed to Step 3 (EVOLVE) — or Step 5 (CONVERGE) if the payload indicates the user is done.
- **On timeout** (5 min, no click): the command exits non-zero. When this happens, post `$EH set-status idle "Session paused — type in terminal to resume"` and end the turn. The user can come back and type "continue" or similar to reopen the loop.

If the user types something in the terminal while the skill is blocked, Ctrl-C cancels the wait and their message becomes the next turn.

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

**Also drop an orange agent-note on the canvas** summarizing the interpreted change list, anchored to the first annotated candidate's frame. This preserves your interpretation in-canvas so it stays visible through the evolve round:

```bash
cd $PAPER && $EH place-agent-note "Iter N feedback read: • rounded buttons • warmer palette • drop bottom nav • 'My Workouts' header" --anchor shape:frame-0 --direction below --width 420
```

Keep it to bullets, one per change-list item. Use the iteration number and the lowest annotated frame ID as anchor.

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

#### B3. Drop evolve placeholders next to originals

For each original image, drop a dashed gray placeholder + frame + arrow to its right — so the user immediately sees where the evolved images are about to appear.

```bash
cd $PAPER && \
  $EH place-evolve-placeholders 1 \
    shape:seed-img-1 shape:seed-img-2 shape:seed-img-3 \
    shape:seed-img-4 shape:seed-img-5 shape:seed-img-6 \
    --display-width 400 --aspect-ratio CHOSEN_RATIO
```

For iteration 2+, use `$EH get-latest` to find the rightmost image shape IDs in each row, then pass those as the original shape IDs.

#### B4. Fire parallel generation + live swap

Same orchestration pattern as the seed round. Each candidate writes to its own temp directory, and each placeholder is swapped as soon as its image finishes:

```bash
cd $PAPER && source .env

ITER=1
PROMPTS=(
  "editing prompt for candidate 1"
  "editing prompt for candidate 2"
  "editing prompt for candidate 3"
  "editing prompt for candidate 4"
  "editing prompt for candidate 5"
  "editing prompt for candidate 6"
)

for N in 0 1 2 3 4 5; do
  (bun scripts/generate.ts "${PROMPTS[$N]}" \
    --input-image /tmp/evolve-clean-$((N + 1)).png \
    --resolution 2K --aspect-ratio CHOSEN_RATIO --no-upload \
    -o /tmp/evolve-iter${ITER}-candidate$((N + 1)) \
    && $EH swap-evolve-placeholder $ITER $((N + 1)) /tmp/evolve-iter${ITER}-candidate$((N + 1))/01.png \
    || $EH mark-placeholder-failed $((N + 1)) $ITER) &
done
wait

$EH zoom-to-fit
```

Evolved images pop in one by one, each replacing its placeholder at the exact position the frame and arrow already occupy. Arguments: `swap-evolve-placeholder <iteration> <candidate_num> <image_path>`.

#### B4-legacy. place-evolved fallback

If the placeholder flow misbehaves, fall back to the legacy `place-evolved` command which generates everything first, then places each image individually:

```bash
cd $PAPER && \
  $EH place-evolved /tmp/evolve-iter1-candidate1/01.png shape:seed-img-1 1 1 && \
  $EH place-evolved /tmp/evolve-iter1-candidate2/01.png shape:seed-img-2 1 2 && \
  … && $EH zoom-to-fit
```

#### B5. Drop a trace note beside the new column

After all 6 evolved candidates land, drop an orange agent-note anchored to the rightmost new image (or its frame) summarizing what changed this round. This gives the user a per-iteration ledger on-canvas.

```bash
cd $PAPER && $EH place-agent-note "Iter N applied: • rounded buttons (12px) • warmer orange/brown palette • removed bottom nav • header → 'My Workouts'. Kept each candidate's original style." --anchor shape:frame-iter1-0 --direction below --width 420
```

Use the actual iteration frame ID prefix (`shape:frame-iterM-0`). One note per evolve round — don't re-summarize on each candidate individually.

### After evolving, tell the user:

> I've evolved all 6 candidates based on your feedback. The new versions are to the right of the originals, connected by arrows.
>
> **Changes applied:**
> [list the unified change list]
>
> You can annotate the new versions the same way — draw on them, add notes, circle what works. When ready, right-click the canvas → **Send Context** for another evolution round, or tell me "done" if you're happy with a design.

Then immediately enter the blocking wait (Step 2 REVIEW's `wait-for-capture`). **Do not end the turn** until either the capture fires or the 300s timeout elapses.

---

## Step 4: REPEAT

- Go back to Step 2 (REVIEW) — which means **re-entering `$EH wait-for-capture --timeout 300`** at the end of each round. Never let a round's turn end without the blocking wait; that's how the session resumes on the next Send Context click.
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

   - **HTML/CSS or React:** First, check if the `frontend-design` skill is available (look for it in the available skills list). If it is, use it in conjunction — invoke the `frontend-design` skill with the design requirements and the final screenshot as reference. It produces significantly better frontend code with distinctive typography, color systems, motion, and spatial composition. If `frontend-design` is not available, suggest the user install it with `/install frontend-design` for better results, then proceed with writing the code yourself — use semantic HTML, CSS custom properties for the color system, and responsive units. Read the final screenshot with the Read tool and faithfully reproduce the design.

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

### Session management

The skill auto-saves canvas state when starting a new session. Snapshots are stored in `$REPO_ROOT/sessions/` as `.tldr` files with timestamps.

**Start a session** (recommended first step):
```bash
$EH connect-session
```
This does three things:
1. Health check (eval server + browser connected)
2. Auto-saves the current canvas if it has content (prevents accidental loss)
3. Injects the overlay UI into the browser (top-center status pill, status only — Send Context lives in the canvas right-click menu)

**List saved sessions:**
```bash
$EH list-sessions
```

**Restore a session:**
```bash
$EH load-snapshot sessions/session-20260417-143022.tldr
```

### Send Context (mandatory end-of-round wait)

The overlay (injected by `connect-session`) renders a top-center status pill — status only, no buttons. **Send Context** lives in the canvas right-click menu (CustomContextMenu.tsx). When the user right-clicks → Send Context, `POST /capture` fires with the current canvas state (selectedIds, shapeCount, shapeIds) and the skill's blocking `wait-for-capture` unblocks.

**Every round MUST end inside `wait-for-capture`.** This is how the same Claude Code session resumes on the Send Context click — the turn never ends between rounds; it parks in a blocking Bash poll that returns when the user clicks (or when the 300s timeout hits).

Typical orchestration pattern:
```bash
# Mandatory end-of-round block
$EH set-status waiting "Ready for feedback — right-click canvas → Send Context"
$EH wait-for-capture --timeout 300

# → user clicks Send Context in the browser → Bash returns → skill continues in the same session
# → on timeout: set-status idle "Session paused — type in terminal to resume" and end turn
```

Claude Code's own voice mode works naturally in parallel: dictation becomes terminal input, which flows through normally.

### Extract user assets (reference images)

When users paste or drag reference images onto the canvas, extract them for use as Gemini input:

```bash
$EH extract-user-assets /tmp/user-refs
```

This finds all image shapes NOT generated by the skill (filters by ID prefix) and saves each as a PNG. Returns `{extracted: [{shapeId, path, w, h}], count}`.

### Extract structured feedback

Instead of manually running detect-annotations + screenshot + export-clean, use:

```bash
$EH extract-feedback /tmp/feedback
```

This bundles everything for each annotated candidate:
- Text annotations (extracted from drawn text shapes)
- Screenshot of the annotated region (annotations visible)
- Clean underlying image (no annotations)

Returns structured JSON ready for prompt assembly.

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
