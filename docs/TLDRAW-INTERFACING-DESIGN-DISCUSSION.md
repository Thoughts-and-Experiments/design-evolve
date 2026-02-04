# tldraw Agent Interfacing: Design Discussion

> **Goal:** Enable AI agents (like Claude Code) to manipulate tldraw canvases programmatically.

## Executive Summary

There are three architectural approaches, each suited to different goals:

| Approach | Real-Time? | Controls Browser? | Complexity | Best For |
|----------|-----------|-------------------|------------|----------|
| **SDK + Custom MCP** | ✅ Yes | ❌ Local app only | Medium | Agent-controlled local canvas |
| **Sync Service + Headless Client** | ✅ Yes | ✅ Yes (if same room) | High | Driving existing browser sessions |
| **tldraw-mcp (File-Based)** | ❌ No | ❌ No | Low | Async workflows, persistent artifacts |

**Quick Recommendation:**
- Want to drive an existing browser session? → **Sync + Headless Client** (requires self-hosted sync server)
- Want agent-controlled canvas with live UI? → **SDK + Custom MCP** (simplest real-time option)
- Want persistent visual artifacts? → **tldraw-mcp** (already exists, works today)

---

## The Three Options Deep Dive

### Option 1: tldraw SDK Only (+ Custom MCP Wrapper)

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│  Your Local App (Vite + React)                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │  <Tldraw onMount={(editor) => exposeToMCP(editor)}/│││
│  │                                                     ││
│  │  Editor instance with full API access               ││
│  └─────────────────────────────────────────────────────┘│
│                          │                              │
│                          ▼                              │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Custom MCP Server (running in same process)        ││
│  │  - create_shape(type, x, y, props)                  ││
│  │  - update_shape(id, updates)                        ││
│  │  - delete_shape(id)                                 ││
│  │  - get_shapes()                                     ││
│  │  - screenshot() → base64                            ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                          │
                          │ MCP Protocol (stdio)
                          ▼
                    Claude Code
```

**What the SDK Provides (out of box):**

```typescript
// Complete programmatic control via Editor API
editor.createShapes([{ type: 'geo', x: 100, y: 100, props: { w: 200, h: 100 } }])
editor.updateShape({ id: 'shape:abc', props: { color: 'blue' } })
editor.deleteShapes(['shape:abc'])
editor.getCurrentPageShapes()  // Read all shapes
editor.getSelectedShapes()     // Read selection
editor.setCamera({ x: 0, y: 0, zoom: 1 })
editor.zoomToFit()
editor.undo() / editor.redo()
editor.getSnapshot() / editor.loadSnapshot(snapshot)  // Save/load
```

**What you'd build:**
- Vite + React app with `<Tldraw />` component
- MCP server that holds reference to `editor` instance
- Tools that call editor methods and return results

**Pros:**
- Full editor API access (most capable)
- Real-time visual feedback
- Simplest real-time option
- Can screenshot/export

**Cons:**
- Doesn't control existing browser sessions
- Need to keep local app running
- Agent sees separate canvas from your browser

**Effort:** ~2-4 hours to scaffold

---

### Option 2: Sync Service + Headless Client

**Architecture:**
```
┌──────────────────────────────────────────┐
│  Your Browser (tldraw.com or self-hosted)│
│  ┌──────────────────────────────────────┐│
│  │  useSync({ uri: 'wss://...', room }) ││
│  │  Connected to Room "my-canvas-123"   ││
│  └──────────────────────────────────────┘│
└──────────────────────────────────────────┘
                    │
                    │ WebSocket (sync protocol)
                    ▼
┌──────────────────────────────────────────┐
│  Sync Server (Cloudflare Workers / Node) │
│  - TLSocketRoom manages room state       │
│  - Broadcasts changes to all clients     │
│  - Persists to database                  │
└──────────────────────────────────────────┘
                    │
                    │ WebSocket (sync protocol)
                    ▼
┌──────────────────────────────────────────┐
│  Headless Agent Client (Node.js)         │
│  ┌──────────────────────────────────────┐│
│  │  TLSyncClient + WebSocket            ││
│  │  Connected to same Room              ││
│  │                                       ││
│  │  Pushes changes → appear in browser! ││
│  └──────────────────────────────────────┘│
│                    │                      │
│                    ▼                      │
│  ┌──────────────────────────────────────┐│
│  │  MCP Server wrapping sync client     ││
│  └──────────────────────────────────────┘│
└──────────────────────────────────────────┘
                    │
                    │ MCP Protocol
                    ▼
              Claude Code
```

**What the Sync Service Provides:**

| Feature | Description |
|---------|-------------|
| **Real-time collaboration** | Changes broadcast to all clients instantly |
| **Conflict resolution** | Server-authoritative, automatic rebase on conflicts |
| **Persistence** | Changes saved to database (SQLite, PostgreSQL) |
| **Network resilience** | Auto-reconnect, state reconciliation |
| **External access** | Any client speaking the protocol can join |
| **Server-side modification** | `room.updateStore()` pushes to all clients |

**The Sync Protocol (v8):**
```typescript
// Client → Server
{ type: 'connect', schema, protocolVersion: 8, lastServerClock }
{ type: 'push', diff: NetworkDiff, clientClock }

// Server → Client
{ type: 'connect', diff: fullSnapshot, serverClock, isReadonly }
{ type: 'patch', diff: changes, serverClock }
{ type: 'push_result', action: 'commit' | 'rebaseWithDiff' }
```

**What you'd build:**
1. Deploy sync server (use `/templates/sync-cloudflare/` as base)
2. Build headless sync client in Node.js using `@tldraw/sync-core`
3. Wrap in MCP server

**Can you use tldraw.com?**
- ❌ **No** - tldraw.com uses closed authentication
- ✅ **demo.tldraw.xyz** works - public, anyone with room ID can join
- ✅ **Self-hosted** works - full control

**Pros:**
- **Can drive existing browser sessions** (if using same sync server)
- Real-time collaboration
- Multiple agents can work together
- Production-ready infrastructure

**Cons:**
- Must run your own sync server (or use demo.tldraw.xyz for testing)
- Headless client requires implementing sync protocol
- More infrastructure complexity
- demo.tldraw.xyz data expires in ~24 hours

**Effort:** ~1-2 days for MVP

---

### Option 3: tldraw-mcp (File-Based)

**Architecture:**
```
┌──────────────────────────────────────────┐
│  Claude Code                             │
│  - tldraw_create("diagram.tldr")         │
│  - tldraw_add_shape(path, shape)         │
│  - tldraw_search("TODO")                 │
└──────────────────────────────────────────┘
                    │
                    │ MCP Protocol (stdio)
                    ▼
┌──────────────────────────────────────────┐
│  tldraw-mcp Server                       │
│  - Reads/writes .tldr files to disk      │
│  - JSON manipulation only                │
│  - No SDK, no sync                       │
└──────────────────────────────────────────┘
                    │
                    │ File I/O
                    ▼
┌──────────────────────────────────────────┐
│  ~/.tldraw/                              │
│  ├── diagram.tldr                        │
│  ├── notes.tldr                          │
│  └── sketches/planning.tldr              │
└──────────────────────────────────────────┘
                    │
                    │ (Manual: user opens file)
                    ▼
┌──────────────────────────────────────────┐
│  tldraw App (Desktop/Web)                │
│  - Opens .tldr file                      │
│  - Shows what agent created              │
└──────────────────────────────────────────┘
```

**What tldraw-mcp Provides:**

| Tool | Description |
|------|-------------|
| `tldraw_create` | Create new empty canvas |
| `tldraw_read` | Load canvas as JSON |
| `tldraw_write` | Save canvas to disk |
| `tldraw_add_shape` | Insert shape into canvas |
| `tldraw_update_shape` | Modify shape properties |
| `tldraw_delete_shape` | Remove shape |
| `tldraw_list` | Enumerate all .tldr files |
| `tldraw_search` | Full-text search across canvases |

**Pros:**
- **Already exists** - npm install and go
- Simple, lightweight (~800 LOC)
- Persistent artifacts on disk
- Great for batch workflows
- AI-friendly tool interface

**Cons:**
- **Not real-time** - async workflow only
- Human must manually open files to see results
- No live canvas control
- No rendering/export (just JSON)

**Effort:** ~5 minutes (already built)

---

## Decision Framework

### Question 1: Do you need real-time visual feedback?

```
                    ┌─────────────────────┐
                    │ Need real-time UI?  │
                    └─────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
        ┌─────────┐                     ┌─────────┐
        │   YES   │                     │   NO    │
        └─────────┘                     └─────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐              ┌─────────────────┐
    │ Use SDK+MCP or  │              │ Use tldraw-mcp  │
    │ Sync+Headless   │              │ (file-based)    │
    └─────────────────┘              └─────────────────┘
```

### Question 2: Do you need to control an EXISTING browser session?

```
                    ┌─────────────────────────────┐
                    │ Control existing browser    │
                    │ session (e.g., tldraw.com)? │
                    └─────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
        ┌─────────┐                     ┌─────────┐
        │   YES   │                     │   NO    │
        └─────────┘                     └─────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────────┐          ┌─────────────────────┐
    │ MUST use Sync       │          │ SDK+MCP is simpler  │
    │ + Headless Client   │          │ and gives full API  │
    │                     │          │                     │
    │ Note: Won't work    │          │ Run local app,      │
    │ with tldraw.com     │          │ agent controls it   │
    │ (closed auth)       │          │                     │
    └─────────────────────┘          └─────────────────────┘
```

### Question 3: How much infrastructure are you willing to manage?

| Complexity Level | Approach | What You Manage |
|-----------------|----------|-----------------|
| **Minimal** | tldraw-mcp | Nothing - just file I/O |
| **Low** | SDK + Custom MCP | Local Vite app + MCP server |
| **Medium** | Sync (demo server) | Headless client only |
| **High** | Sync (self-hosted) | Cloudflare Worker + DB + client |

---

## Recommendations by Use Case

### Use Case A: "I want Claude to create diagrams I can view"

**Recommendation: tldraw-mcp** ✅

- Already built, works today
- Agent creates `.tldr` files
- You open them in tldraw desktop app or web
- Perfect for: architecture diagrams, flowcharts, visual notes

```bash
# Install and configure
npx @talhaorak/tldraw-mcp
```

### Use Case B: "I want Claude to control a live canvas I can watch"

**Recommendation: SDK + Custom MCP** ✅

- Build local Vite app with tldraw
- Expose editor via MCP server
- Agent calls tools, you see changes live
- Perfect for: interactive drawing, debugging visuals, demos

### Use Case C: "I want Claude to modify drawings while I'm editing them"

**Recommendation: Sync + Headless Client** ✅

- Deploy your own sync server (or use demo.tldraw.xyz for testing)
- Build headless client that joins same room as your browser
- Agent pushes changes, they appear in your session
- Perfect for: collaborative AI, pair-drawing, real-time assistance

**Note:** This does NOT work with tldraw.com (closed auth). You need:
- Self-hosted sync server, OR
- demo.tldraw.xyz (public, data expires in 24h)

### Use Case D: "I want Claude to modify my tldraw.com drawings"

**Recommendation: Not currently possible** ❌

- tldraw.com uses proprietary authentication
- No public API to connect as external client
- Would require browser extension/injection (fragile, not recommended)

**Alternatives:**
- Export from tldraw.com → modify with tldraw-mcp → re-import
- Switch to self-hosted tldraw with sync

---

## Technical Deep Dive: What Each Layer Provides

### Layer 1: tldraw SDK (Editor API)

The SDK provides complete programmatic control of a single editor instance:

```typescript
// Shape CRUD
editor.createShapes([...])
editor.updateShape({ id, props })
editor.deleteShapes([id])
editor.getCurrentPageShapes()

// Selection & Styling
editor.select(id)
editor.setStyleForSelectedShapes(style, value)

// Camera
editor.setCamera({ x, y, zoom })
editor.zoomToFit()

// Persistence
editor.getSnapshot()
editor.loadSnapshot(snapshot)

// Events
editor.on('change', (entry) => { ... })
editor.store.listen((entry) => { ... })
```

**Limitation:** No IPC mechanism. External processes cannot reach the editor without building a bridge.

### Layer 2: Sync Service (Multiplayer)

The sync system adds real-time collaboration on top of the SDK:

| Capability | SDK Only | With Sync |
|------------|----------|-----------|
| Local editing | ✅ | ✅ |
| Persistence | Manual | Automatic (DB) |
| Multiple clients | ❌ | ✅ |
| Conflict resolution | N/A | Automatic |
| External access | ❌ | ✅ (WebSocket) |
| Server-side changes | ❌ | ✅ |

**Key insight:** The sync server CAN push changes into a room that all clients receive:

```typescript
// Server-side code
await room.updateStore((store) => {
  store.put([{
    id: createShapeId('agent-shape'),
    type: 'geo',
    x: 100, y: 100,
    props: { w: 200, h: 100 }
  }])
})
// All connected clients immediately see this shape!
```

### Layer 3: MCP Server (AI Interface)

MCP provides a tool-based interface for AI agents:

```typescript
// What Claude sees and can call:
{
  tools: [
    { name: 'create_shape', params: { type, x, y, props } },
    { name: 'update_shape', params: { id, updates } },
    { name: 'get_shapes', params: {} },
    { name: 'screenshot', params: {} }
  ]
}
```

**The MCP server is a bridge** - it can wrap:
- File I/O (tldraw-mcp approach)
- SDK editor instance (custom approach)
- Sync client (headless approach)

---

## Implementation Roadmap

### Phase 1: Validate with tldraw-mcp (Today)

1. Install tldraw-mcp:
   ```bash
   npm install -g @talhaorak/tldraw-mcp
   ```

2. Configure Claude Code to use it

3. Test workflow:
   - Have Claude create a diagram
   - Open the .tldr file in tldraw
   - Verify the workflow works for your needs

### Phase 2: Build SDK + MCP Wrapper (If Real-Time Needed)

1. Scaffold Vite + React + tldraw app
2. Create MCP server that accesses editor instance
3. Expose tools: create_shape, update_shape, delete_shape, get_shapes, screenshot
4. Run app, connect Claude Code

### Phase 3: Build Sync Integration (If Browser Control Needed)

1. Deploy sync server using Cloudflare template
2. Build headless sync client in Node.js
3. Wrap in MCP server
4. Connect browser and agent to same room

---

## Appendix: File Format Reference

The `.tldr` file format (tldraw v2):

```json
{
  "tldrawFileFormatVersion": 1,
  "schema": {
    "schemaVersion": 2,
    "sequences": {
      "com.tldraw.store": 4,
      "com.tldraw.shape": 4,
      "com.tldraw.shape.geo": 10
    }
  },
  "records": [
    {
      "id": "document:document",
      "typeName": "document",
      "gridSize": 10,
      "name": ""
    },
    {
      "id": "page:page-1",
      "typeName": "page",
      "name": "Page 1",
      "index": "a1"
    },
    {
      "id": "shape:abc123",
      "typeName": "shape",
      "type": "geo",
      "x": 100,
      "y": 100,
      "rotation": 0,
      "props": {
        "geo": "rectangle",
        "w": 200,
        "h": 100,
        "color": "black",
        "fill": "none"
      }
    }
  ]
}
```

---

## Appendix: Sync Protocol Messages

```typescript
// Connect (Client → Server)
{
  type: 'connect',
  connectRequestId: string,
  protocolVersion: 8,
  schema: SerializedSchema,
  lastServerClock: number
}

// Connect Response (Server → Client)
{
  type: 'connect',
  hydrationType: 'wipe_all' | 'wipe_presence',
  serverClock: number,
  diff: NetworkDiff,  // Full room state
  isReadonly: boolean
}

// Push Changes (Client → Server)
{
  type: 'push',
  clientClock: number,
  diff: NetworkDiff,
  presence?: unknown
}

// Push Result (Server → Client)
{
  type: 'push_result',
  action: 'commit' | 'discard' | { rebaseWithDiff: NetworkDiff }
}

// Broadcast Changes (Server → Client)
{
  type: 'patch',
  diff: NetworkDiff,
  serverClock: number
}
```

---

## Appendix: Key Source Files

| Purpose | File |
|---------|------|
| Editor API | `packages/editor/src/lib/editor/Editor.ts` |
| Store System | `packages/store/src/lib/Store.ts` |
| Sync Client | `packages/sync-core/src/lib/TLSyncClient.ts` |
| Sync Room (Server) | `packages/sync-core/src/lib/TLSyncRoom.ts` |
| Sync Protocol | `packages/sync-core/src/lib/protocol.ts` |
| React Integration | `packages/sync/src/useSync.ts` |
| Cloudflare Template | `templates/sync-cloudflare/` |
| Agent Template | `templates/agent/` |
| tldraw-mcp | `downloads/tldraw-mcp/src/index.ts` |
