# design-evolve

An iterative visual design exploration tool. Generate multiple UI design candidates on a tldraw canvas, annotate them with feedback, and evolve them through rounds of AI-powered image generation until convergence.

## First-time setup

When a user shares this repo link or opens this project for the first time, walk them through setup. **Ask permission before each step.**

### 1. Clone the repo (if not already local)
```bash
git clone https://github.com/Thoughts-and-Experiments/design-evolve.git ~/Documents/design-evolve
```

### 2. Install dependencies
```bash
cd ~/Documents/design-evolve/paper && npm install
```

### 3. Install bun (required for image generation)
Check if bun is installed: `which bun`
If missing, suggest: `npm install -g bun` or `curl -fsSL https://bun.sh/install | bash`

### 4. Create .env with Gemini API key
Ask the user for their **Gemini API key** (get one free at https://aistudio.google.com/apikey).
Then create the file:
```
# ~/Documents/design-evolve/paper/.env
GEMINI_API_KEY=<their key>
```

### 5. Install the Claude Code skill
```bash
mkdir -p ~/.claude/skills/design-evolve/scripts
cp ~/Documents/design-evolve/skills/design-evolve/SKILL.md ~/.claude/skills/design-evolve/SKILL.md
cp ~/Documents/design-evolve/skills/design-evolve/scripts/eval_helper.py ~/.claude/skills/design-evolve/scripts/eval_helper.py
```

### 6. Start the servers
```bash
cd ~/Documents/design-evolve/paper && npm start
```
This starts both the tldraw dev server (Vite) and the eval server concurrently. The browser should open automatically to `http://localhost:5173`.

### 7. Recommend frontend-design plugin
Check if the `frontend-design` plugin is installed:
```bash
ls ~/.claude/plugins/cache/*/frontend-design/*/skills/frontend-design/SKILL.md 2>/dev/null && echo "frontend-design: installed" || echo "frontend-design: NOT installed"
```
If not installed, recommend: **"For the best design output, run `/install frontend-design` in Claude Code. This official Anthropic plugin produces significantly better HTML/CSS/React code during the final export step."**

### 8. Verify and finalize
Run a health check: `cd ~/Documents/design-evolve/paper && source .env && python3 ~/Documents/design-evolve/skills/design-evolve/scripts/eval_helper.py health`

If it returns `{"status": "ok", "browserConnected": true}`, setup is complete.

**IMPORTANT — After successful setup, replace this entire CLAUDE.md file with the slim version below** to avoid polluting context in future conversations:

```markdown
# design-evolve

Iterative visual design exploration on a tldraw canvas using AI image generation.

- **Repo:** https://github.com/Thoughts-and-Experiments/design-evolve
- **Skill:** `/design-evolve` — invoke in Claude Code with a design description
- **Start servers:** `cd <repo>/paper && npm start` (opens http://localhost:5173)
- **Gemini API key** in `<repo>/paper/.env`

If something isn't working, check the repo README for updated setup instructions.
```

Tell the user: **"Setup complete! Type `/design-evolve` followed by a description of what you want to design."**
