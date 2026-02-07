# tldraw paper - local development

# Default recipe
default: dev

# Port configuration
VITE_PORT := "3030"
EVAL_PORT := "3031"

# localhostess names for HTTPS
VITE_NAME := "paper"
EVAL_NAME := "paper-eval"
AGENT_UI_NAME := "agent-ui"
AGENT_UI_PORT := "3032"

# Run all dev servers concurrently
dev:
    cd paper && npx concurrently \
        --prefix-colors "cyan,magenta" \
        "NAME={{VITE_NAME}} npx vite --port {{VITE_PORT}}" \
        "NAME={{EVAL_NAME}} EVAL_PORT={{EVAL_PORT}} npx tsx eval-server.ts"

# Run only the vite dev server
vite:
    cd paper && NAME={{VITE_NAME}} npx vite --port {{VITE_PORT}}

# Run only the eval server
eval:
    cd paper && EVAL_PORT={{EVAL_PORT}} npx tsx eval-server.ts

# Build for production
build:
    cd paper && npx vite build

# Preview production build
preview:
    cd paper && npx vite preview

# Run the SDK example
example:
    cd paper && EVAL_PORT={{EVAL_PORT}} npx tsx sdk/example.ts

# Check health of eval server
health:
    curl -s http://localhost:{{EVAL_PORT}}/health | jq .

# Test eval endpoint
test-eval code:
    curl -s -X POST http://localhost:{{EVAL_PORT}}/eval \
        -H "Content-Type: application/json" \
        -d '{"code": "{{code}}"}' | jq .

# Quick test: get canvas state
test-state:
    just test-eval "return getCanvasState()"

# Quick test: get screenshot
test-screenshot:
    just test-eval "return await getScreenshot()"

# Clean up processes on dev ports
clean:
    -lsof -ti:{{VITE_PORT}} | xargs kill -9 2>/dev/null
    -lsof -ti:{{EVAL_PORT}} | xargs kill -9 2>/dev/null
    @echo "Cleaned up processes on ports {{VITE_PORT}} and {{EVAL_PORT}}"

# Install dependencies
install:
    cd paper && npm install

# Run edit CLI - invoke Claude with tldraw context
edit *ARGS:
    cd paper && EVAL_PORT={{EVAL_PORT}} bun run scripts/edit.ts {{ARGS}}

# Upload images to canvas
upload *ARGS:
    cd paper && EVAL_PORT={{EVAL_PORT}} bun run scripts/upload.ts {{ARGS}}

# Generate images and place on canvas
generate *ARGS:
    cd paper && source .env && bun run scripts/generate.ts {{ARGS}}

# Export selected images from canvas
export-selected *ARGS:
    cd paper && bun run scripts/export-selected-images.ts {{ARGS}}

# Build CLI tools to standalone binaries
build-edit:
    cd paper && bun build scripts/edit.ts --compile --outfile dist/edit

build-upload:
    cd paper && bun build scripts/upload.ts --compile --outfile dist/upload

# Run agent-ui dev server
agent-ui:
    cd agent-ui && NAME={{AGENT_UI_NAME}} bun run bridge.ts

# OpenSprite entrypoint
setup: clone-deps install

# Clone and build external dependencies
clone-deps:
    mkdir -p downloads
    [ -d downloads/pi-mono ] || git clone https://github.com/badlogic/pi-mono downloads/pi-mono
    [ -f downloads/pi-mono/packages/coding-agent/dist/cli.js ] || (cd downloads/pi-mono && npm install && npm run build)
start:
    npx concurrently \
        --prefix-colors "cyan,magenta,green" \
        "cd paper && NAME={{VITE_NAME}} npx vite --host 0.0.0.0 --port {{VITE_PORT}}" \
        "cd paper && NAME={{EVAL_NAME}} EVAL_PORT={{EVAL_PORT}} npx tsx eval-server.ts" \
        "cd agent-ui && NAME={{AGENT_UI_NAME}} bun --watch run bridge.ts"
