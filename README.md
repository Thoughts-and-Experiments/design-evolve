# Design Evolve

An experimental skill for iterative visual design exploration using AI. This is the companion tool to [Learning to Draw Again With AI](https://thoughts-and-experiments.github.io/Possibilities-Article/) — an essay on divergence, taste, and visual exploration in AI-native design workflows.

## What is this?

Design Evolve is a Claude Code skill that runs an iterative design loop on a [tldraw](https://github.com/tldraw/tldraw) canvas. Instead of prompting for a single output and refining it line by line, you explore a broad space of visual possibilities and converge through curation.

The workflow:

```
SEED → REVIEW → EVOLVE → REVIEW → EVOLVE → ... → CONVERGE
```

1. **Seed** — Describe what you want. The skill generates multiple diverse UI candidates using image generation.
2. **Review** — Annotate directly on the canvas. Circle what you like, cross out what you don't, add sticky notes with feedback.
3. **Evolve** — The skill reads your annotations and evolves all candidates, applying your feedback globally.
4. **Converge** — Repeat until you're happy, then export as code, design specs, or a polished image.

## Examples

### Exploring candidates with annotations

The skill generates seed candidates, and you annotate them with visual feedback directly on the tldraw canvas. Feedback on any candidate is applied to all candidates in the next evolution round.

![Candidates board with annotations](docs/images/candidates-board.png)

### Iterating towards convergence

Each evolution round applies your feedback and branches into new variations. Over multiple rounds, the designs converge towards a unified direction.

![Water tracker app convergence](docs/images/water-tracker-convergence.png)

### Final output

Once you're satisfied, the skill can export your chosen design as HTML/CSS, a React component, design specs, or a polished high-resolution image.

![Final side-by-side output](docs/images/final-output.png)

## Setup

### Prerequisites

- [Claude Code](https://claude.ai/claude-code) with skill support
- [tldraw](https://github.com/tldraw/tldraw) running in a browser
- A `GEMINI_API_KEY` for image generation (via Nano Banana Pro)
- An `ANTHROPIC_API_KEY` for the tldraw agent

### Getting started

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/Thoughts-and-Experiments/design-evolve.git
   cd design-evolve/paper
   npm install
   ```

2. Create a `.dev.vars` file with your API keys:
   ```
   ANTHROPIC_API_KEY=your_key_here
   GOOGLE_API_KEY=your_key_here
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:5173/` and invoke the skill with `/design-evolve` in Claude Code.

## Project structure

```
design-evolve/
  paper/          # tldraw agent app (canvas UI, agent logic, worker)
  skills/         # Claude Code skills
    design-evolve/  # The iterative design evolution skill
    nano-banana-pro/  # Image generation via Gemini
    tldraw/         # tldraw canvas manipulation skill
  agent-ui/       # Agent UI bridge
  docs/           # Documentation and images
```

## Read the essay

For the ideas behind this tool, read the full essay: [Learning to Draw Again With AI](https://thoughts-and-experiments.github.io/Possibilities-Article/)

## License

See [LICENSE.md](paper/LICENSE.md) for details. The tldraw agent components are provided under the [tldraw SDK license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md).
