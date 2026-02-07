/**
 * WebSocket bridge between browser chat UI and pi coding-agent (RPC mode).
 *
 * Start: bun agent-ui/bridge.ts
 * Open:  http://localhost:3032
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { RpcClient } from "../downloads/pi-mono/packages/coding-agent/src/modes/rpc/rpc-client.js";

const PORT = 3032;
const PROJECT_DIR = resolve(import.meta.dir, "..");
const CLI_PATH = resolve(import.meta.dir, "../downloads/pi-mono/packages/coding-agent/dist/cli.js");
const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");
const SKILLS_DIR = join(PROJECT_DIR, ".claude", "skills");

// Auto-discover skills from .claude/skills/
function discoverSkillArgs(): string[] {
	if (!existsSync(SKILLS_DIR)) return [];
	const args: string[] = [];
	for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
		if (entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, "SKILL.md"))) {
			args.push("--skill", join(SKILLS_DIR, entry.name));
		}
	}
	return args;
}

// ============================================================================
// Anthropic OAuth (same PKCE flow as the TUI)
// ============================================================================

const CLIENT_ID = atob("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";

function base64urlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generatePKCE() {
	const verifierBytes = new Uint8Array(32);
	crypto.getRandomValues(verifierBytes);
	const verifier = base64urlEncode(verifierBytes);
	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	const challenge = base64urlEncode(new Uint8Array(hash));
	return { verifier, challenge };
}

// In-flight PKCE state (one login at a time)
let pendingPKCE: { verifier: string } | null = null;

function hasAnthropicAuth(): boolean {
	if (!existsSync(AUTH_PATH)) return false;
	try {
		const data = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
		return !!data.anthropic;
	} catch {
		return false;
	}
}

function saveAnthropicAuth(credentials: { refresh: string; access: string; expires: number }) {
	const dir = join(homedir(), ".pi", "agent");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	let data: Record<string, any> = {};
	if (existsSync(AUTH_PATH)) {
		try { data = JSON.parse(readFileSync(AUTH_PATH, "utf-8")); } catch {}
	}
	data.anthropic = { type: "oauth", ...credentials };
	writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ============================================================================
// RPC Client management
// ============================================================================

let rpc: RpcClient | null = null;
const clients = new Set<any>();

function broadcast(msg: any) {
	const s = JSON.stringify(msg);
	for (const ws of clients) {
		if (ws.readyState === 1) ws.send(s);
	}
}

async function startAgent() {
	if (rpc) {
		try { await rpc.stop(); } catch {}
	}
	const skillArgs = discoverSkillArgs();
	if (skillArgs.length) {
		const names = skillArgs.filter((_, i) => i % 2 === 1).map(p => p.split("/").pop());
		console.log(`Loading skills: ${names.join(", ")}`);
	}
	rpc = new RpcClient({
		cliPath: CLI_PATH,
		cwd: PROJECT_DIR,
		provider: "anthropic",
		model: "claude-opus-4-6",
		args: skillArgs,
	});
	await rpc.start();
	console.log("Pi coding-agent started (claude-opus-4-6)");

	rpc.onEvent((event) => broadcast(event));
	broadcast({ type: "agent_ready" });
}

// Start agent only if already authenticated
if (hasAnthropicAuth()) {
	await startAgent();
} else {
	console.log("No Anthropic auth found — waiting for login via web UI");
}

// ============================================================================
// HTTP + WebSocket server
// ============================================================================

const htmlPath = resolve(import.meta.dir, "pi-chat.html");
const jsPath = resolve(import.meta.dir, "src/pi-chat.ts");

Bun.serve({
	port: PORT,
	async fetch(req, server) {
		const url = new URL(req.url);

		// --- WebSocket upgrade ---
		if (url.pathname === "/ws") {
			if (server.upgrade(req)) return;
			return new Response("WebSocket upgrade failed", { status: 400 });
		}

		// --- OAuth endpoints ---
		if (url.pathname === "/api/auth/status") {
			return Response.json({ authenticated: hasAnthropicAuth(), agentRunning: !!rpc });
		}

		if (url.pathname === "/api/auth/login" && req.method === "POST") {
			const { verifier, challenge } = await generatePKCE();
			pendingPKCE = { verifier };

			const params = new URLSearchParams({
				code: "true",
				client_id: CLIENT_ID,
				response_type: "code",
				redirect_uri: REDIRECT_URI,
				scope: SCOPES,
				code_challenge: challenge,
				code_challenge_method: "S256",
				state: verifier,
			});

			return Response.json({ url: `${AUTHORIZE_URL}?${params}` });
		}

		if (url.pathname === "/api/auth/callback" && req.method === "POST") {
			if (!pendingPKCE) {
				return Response.json({ error: "No pending login" }, { status: 400 });
			}

			const { code: authCode } = (await req.json()) as { code: string };
			const splits = authCode.split("#");
			const code = splits[0];
			const state = splits[1];

			try {
				const tokenRes = await fetch(TOKEN_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						grant_type: "authorization_code",
						client_id: CLIENT_ID,
						code,
						state,
						redirect_uri: REDIRECT_URI,
						code_verifier: pendingPKCE.verifier,
					}),
				});

				if (!tokenRes.ok) {
					const err = await tokenRes.text();
					return Response.json({ error: `Token exchange failed: ${err}` }, { status: 400 });
				}

				const tokenData = (await tokenRes.json()) as {
					access_token: string;
					refresh_token: string;
					expires_in: number;
				};

				const credentials = {
					refresh: tokenData.refresh_token,
					access: tokenData.access_token,
					expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
				};

				saveAnthropicAuth(credentials);
				pendingPKCE = null;
				console.log("Anthropic OAuth login successful");

				// Start the agent now that we have credentials
				await startAgent();

				return Response.json({ success: true });
			} catch (err: any) {
				return Response.json({ error: err.message }, { status: 500 });
			}
		}

		// --- Static files ---
		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(Bun.file(htmlPath), { headers: { "content-type": "text/html" } });
		}
		if (url.pathname === "/pi-chat.js") {
			const built = await Bun.build({ entrypoints: [jsPath], target: "browser" });
			const js = await built.outputs[0].text();
			return new Response(js, { headers: { "content-type": "application/javascript" } });
		}

		return new Response("Not found", { status: 404 });
	},

	websocket: {
		open(ws) {
			clients.add(ws);
			console.log(`Client connected (${clients.size} total)`);
		},
		async message(ws, raw) {
			try {
				const cmd = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));

				if (!rpc) {
					ws.send(JSON.stringify({ type: "error", error: "Agent not running. Please login first." }));
					return;
				}

				switch (cmd.type) {
					case "prompt":
						await rpc.prompt(cmd.message);
						break;
					case "abort":
						await rpc.abort();
						break;
					case "get_state":
						ws.send(JSON.stringify({ type: "state", data: await rpc.getState() }));
						break;
					case "get_messages":
						ws.send(JSON.stringify({ type: "messages", data: await rpc.getMessages() }));
						break;
					case "set_model":
						await rpc.setModel(cmd.provider, cmd.modelId);
						ws.send(JSON.stringify({ type: "model_set", data: { provider: cmd.provider, id: cmd.modelId } }));
						break;
					case "set_thinking_level":
						await rpc.setThinkingLevel(cmd.level);
						break;
					case "get_available_models":
						ws.send(JSON.stringify({ type: "available_models", data: await rpc.getAvailableModels() }));
						break;
					case "new_session":
						await rpc.newSession();
						ws.send(JSON.stringify({ type: "session_cleared" }));
						break;
					default:
						ws.send(JSON.stringify({ type: "error", error: `Unknown command: ${cmd.type}` }));
				}
			} catch (err: any) {
				ws.send(JSON.stringify({ type: "error", error: err.message }));
			}
		},
		close(ws) {
			clients.delete(ws);
			console.log(`Client disconnected (${clients.size} total)`);
		},
	},
});

console.log(`Bridge running → http://localhost:${PORT}`);
