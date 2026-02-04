#!/usr/bin/env bun

/**
 * edit CLI - Invoke Claude Code with full tldraw canvas context
 *
 * This CLI launches Claude with:
 * 1. The TLDRAW_CONTEXT.md system prompt (how to use the eval API)
 * 2. Current canvas state (shapes, viewport, selection)
 * 3. Optional screenshot for visual context
 *
 * Claude can then manipulate the canvas by calling curl to the eval endpoint.
 *
 * Usage:
 *   ./edit "Draw a blue rectangle"     # Run with task
 *   ./edit                             # Interactive mode
 *   ./edit --resume <id>               # Resume session
 *   ./edit --screenshot                # Include screenshot in context
 */

import { spawn } from 'child_process'
import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Configuration
const EVAL_PORT = process.env.EVAL_PORT || '3031'
const EVAL_URL = `http://localhost:${EVAL_PORT}`
const CONTEXT_FILE = join(__dirname, 'TLDRAW_CONTEXT.md')
const LOG_FILE = process.env.EDIT_LOG || join(process.cwd(), 'ralph-edit.log')
const PROGRESS_FILE = process.env.EDIT_PROGRESS || join(process.cwd(), 'progress-edit.txt')

interface CliArgs {
  task?: string
  resume?: string
  screenshot: boolean
  help: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const result: CliArgs = {
    screenshot: false,
    help: false,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '--help' || arg === '-h') {
      result.help = true
      i++
    } else if (arg === '--resume' || arg === '-r') {
      result.resume = args[i + 1]
      i += 2
    } else if (arg === '--screenshot' || arg === '-s') {
      result.screenshot = true
      i++
    } else if (!arg.startsWith('-')) {
      // Positional argument is the task
      result.task = arg
      i++
    } else {
      console.error(`Unknown option: ${arg}`)
      process.exit(1)
    }
  }

  return result
}

function printHelp() {
  console.log(`
edit - Invoke Claude Code with tldraw canvas context

USAGE:
  edit [OPTIONS] [TASK]

ARGUMENTS:
  TASK    Description of what to do on the canvas (optional)

OPTIONS:
  -h, --help              Show this help message
  -r, --resume <ID>       Resume a previous Claude session
  -s, --screenshot        Include canvas screenshot in context

EXAMPLES:
  edit "Draw a flowchart with Start, Process, and End boxes"
  edit "Create a blue rectangle at 100,100"
  edit --screenshot "What do you see on the canvas?"
  edit --resume abc123
  edit                    # Interactive mode

ENVIRONMENT:
  EVAL_PORT       Eval server port (default: 3031)
  EDIT_LOG        Log file path (default: ./ralph-edit.log)
  EDIT_PROGRESS   Progress file path (default: ./progress-edit.txt)
`)
}

async function checkHealth(): Promise<{ ok: boolean; browserConnected: boolean }> {
  try {
    const res = await fetch(`${EVAL_URL}/health`)
    const data = await res.json() as { status: string; browserConnected: boolean }
    return { ok: data.status === 'ok', browserConnected: data.browserConnected }
  } catch (e) {
    return { ok: false, browserConnected: false }
  }
}

async function evalCode(code: string): Promise<any> {
  const res = await fetch(`${EVAL_URL}/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  return res.json()
}

async function getCanvasState(): Promise<any> {
  const result = await evalCode('return getCanvasState()')
  if (!result.success) {
    throw new Error(result.error || 'Failed to get canvas state')
  }
  return result.result
}

async function getScreenshot(): Promise<string> {
  const result = await evalCode('return await getScreenshot({ format: "png" })')
  if (!result.success) {
    throw new Error(result.error || 'Failed to get screenshot')
  }
  return result.result
}

function log(message: string) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${message}\n`
  appendFileSync(LOG_FILE, line)
}

function formatCanvasState(state: any): string {
  const shapes = state.shapes || []
  const viewport = state.viewport || {}
  const selectedIds = state.selectedIds || []

  let output = '## Current Canvas State\n\n'

  output += `**Viewport:** x=${viewport.x?.toFixed(0) || 0}, y=${viewport.y?.toFixed(0) || 0}, w=${viewport.w?.toFixed(0) || 0}, h=${viewport.h?.toFixed(0) || 0}\n\n`

  if (selectedIds.length > 0) {
    output += `**Selected:** ${selectedIds.join(', ')}\n\n`
  }

  output += `**Shapes (${shapes.length}):**\n\n`

  if (shapes.length === 0) {
    output += '_Canvas is empty_\n'
  } else {
    for (const shape of shapes) {
      const props = shape.props || {}
      output += `- **${shape.id}** (${shape.type})`

      if (shape.type === 'geo') {
        output += ` [${props.geo || 'rectangle'}]`
      }

      output += ` at (${shape.x?.toFixed(0) || 0}, ${shape.y?.toFixed(0) || 0})`

      if (props.w && props.h) {
        output += ` size ${props.w}x${props.h}`
      }

      if (props.text) {
        output += ` text="${props.text}"`
      }

      if (props.color) {
        output += ` color=${props.color}`
      }

      output += '\n'
    }
  }

  return output
}

function buildPrompt(args: CliArgs, contextMd: string, canvasState: any, screenshotDataUrl?: string): string {
  let prompt = ''

  // System context
  prompt += contextMd
  prompt += '\n\n---\n\n'

  // Current canvas state
  prompt += formatCanvasState(canvasState)
  prompt += '\n'

  // Screenshot if available
  if (screenshotDataUrl) {
    prompt += '\n## Screenshot\n\n'
    prompt += 'A screenshot of the canvas is attached to this message.\n'
    prompt += `[Screenshot data: ${screenshotDataUrl.substring(0, 100)}...]\n`
  }

  prompt += '\n---\n\n'

  // User task
  if (args.task) {
    prompt += `## Task\n\n${args.task}\n\n`
  } else {
    prompt += '## Task\n\nAwaiting your instructions. What would you like me to do on the canvas?\n\n'
  }

  // Instructions
  prompt += `## Instructions

Execute the task by calling curl to POST to the eval API at ${EVAL_URL}/eval.

After making changes, verify your work by getting the canvas state:
\`\`\`bash
curl -s -X POST ${EVAL_URL}/eval -H "Content-Type: application/json" -d '{"code": "return getCanvasState()"}' | jq .
\`\`\`

When you're done, summarize what you created or modified.
`

  return prompt
}

async function main() {
  const args = parseArgs()

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  log(`Starting edit CLI: task="${args.task || 'interactive'}" screenshot=${args.screenshot} resume=${args.resume || 'none'}`)

  // Check eval server health
  console.log('Checking eval server...')
  const health = await checkHealth()

  if (!health.ok) {
    console.error('Error: Eval server is not running')
    console.error(`Make sure to start it: just eval (or npx tsx eval-server.ts)`)
    process.exit(1)
  }

  if (!health.browserConnected) {
    console.error('Error: Browser not connected to eval server')
    console.error('Open tldraw in your browser: http://localhost:3030')
    process.exit(1)
  }

  console.log('Eval server: OK, browser connected')

  // Load context file
  if (!existsSync(CONTEXT_FILE)) {
    console.error(`Error: Context file not found: ${CONTEXT_FILE}`)
    process.exit(1)
  }
  const contextMd = readFileSync(CONTEXT_FILE, 'utf-8')

  // Get current canvas state
  console.log('Getting canvas state...')
  let canvasState: any
  try {
    canvasState = await getCanvasState()
    console.log(`Canvas has ${canvasState.shapes?.length || 0} shapes`)
  } catch (e: any) {
    console.error(`Error getting canvas state: ${e.message}`)
    process.exit(1)
  }

  // Get screenshot if requested
  let screenshot: string | undefined
  if (args.screenshot) {
    console.log('Getting screenshot...')
    try {
      screenshot = await getScreenshot()
      console.log('Screenshot captured')
    } catch (e: any) {
      console.warn(`Warning: Could not get screenshot: ${e.message}`)
    }
  }

  // Build the prompt
  const prompt = buildPrompt(args, contextMd, canvasState, screenshot)

  // Write prompt to a temp file for debugging
  const promptFile = join(__dirname, '.edit-prompt.md')
  writeFileSync(promptFile, prompt)
  log(`Prompt written to ${promptFile}`)

  // Build claude command
  const claudeArgs: string[] = []

  if (args.resume) {
    claudeArgs.push('--resume', args.resume)
  } else {
    claudeArgs.push('-p', prompt)
  }

  // Add allowedTools to let Claude use curl
  claudeArgs.push('--allowedTools', 'Bash(curl*),Read,Write,Edit,Glob,Grep')

  // Stream output (--verbose required with stream-json when using -p)
  claudeArgs.push('--output-format', 'stream-json')
  claudeArgs.push('--verbose')

  console.log('\nLaunching Claude...\n')
  log(`Claude args: ${claudeArgs.join(' ')}`)

  // Spawn claude
  const claude = spawn('claude', claudeArgs, {
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env },
  })

  let sessionId: string | undefined
  let outputBuffer = ''

  claude.stdout.on('data', (data: Buffer) => {
    const chunk = data.toString()
    outputBuffer += chunk

    // Process each line
    const lines = outputBuffer.split('\n')
    outputBuffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const event = JSON.parse(line)

        // Extract session ID
        if (event.session_id && !sessionId) {
          sessionId = event.session_id
          console.log(`Session ID: ${sessionId}`)
        }

        // Print assistant messages
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              process.stdout.write(block.text)
            }
          }
        }

        // Print tool results (useful for seeing curl output)
        if (event.type === 'result') {
          if (event.result) {
            console.log('\n' + event.result)
          }
        }

      } catch (e) {
        // Not JSON, just print it
        process.stdout.write(line + '\n')
      }
    }
  })

  claude.on('close', (code) => {
    // Process any remaining output
    if (outputBuffer.trim()) {
      try {
        const event = JSON.parse(outputBuffer)
        if (event.type === 'result' && event.result) {
          console.log(event.result)
        }
      } catch (e) {
        console.log(outputBuffer)
      }
    }

    console.log(`\nClaude exited with code ${code}`)
    if (sessionId) {
      console.log(`Resume with: edit --resume ${sessionId}`)
    }
    log(`Claude exited with code ${code}, session=${sessionId}`)

    // Write progress
    writeFileSync(PROGRESS_FILE, `Session: ${sessionId || 'none'}\nExit code: ${code}\nTimestamp: ${new Date().toISOString()}\n`)

    process.exit(code ?? 0)
  })

  claude.on('error', (err) => {
    console.error(`Failed to start Claude: ${err.message}`)
    log(`Failed to start Claude: ${err.message}`)
    process.exit(1)
  })
}

main().catch((e) => {
  console.error('Error:', e.message)
  log(`Error: ${e.message}`)
  process.exit(1)
})
