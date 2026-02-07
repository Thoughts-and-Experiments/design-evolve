/**
 * Frontend logic for pi agent chat UI.
 * tldraw-native design. Connects to WebSocket bridge.
 */

// --- Elements ---
const messagesEl = document.getElementById("messages")!;
const messagesInner = document.getElementById("messagesInner")!;
const inputForm = document.getElementById("inputForm") as HTMLFormElement;
const userInput = document.getElementById("userInput") as HTMLTextAreaElement;
const sendBtn = document.getElementById("sendBtn") as HTMLButtonElement;
const abortBtn = document.getElementById("abortBtn") as HTMLButtonElement;
const newSessionBtn = document.getElementById("newSessionBtn") as HTMLButtonElement;
const modelLabel = document.getElementById("modelLabel")!;
const streamIndicator = document.getElementById("streamIndicator")!;

// Login
const loginOverlay = document.getElementById("loginOverlay")!;
const loginBtn = document.getElementById("loginBtn") as HTMLButtonElement;
const loginCodeSection = document.getElementById("loginCodeSection")!;
const loginCodeInput = document.getElementById("loginCodeInput") as HTMLInputElement;
const loginSubmitBtn = document.getElementById("loginSubmitBtn") as HTMLButtonElement;
const loginError = document.getElementById("loginError")!;
const loginSpinner = document.getElementById("loginSpinner")!;
const footer = document.querySelector("footer") as HTMLElement;

// --- State ---
let streaming = false;
let currentAssistantEl: HTMLElement | null = null;
let currentAssistantText = "";
let currentThinkingEl: HTMLElement | null = null;
let currentThinkingText = "";

// --- Auth ---
async function checkAuth() {
	try {
		const res = await fetch("/api/auth/status");
		const { authenticated, agentRunning } = await res.json();
		if (authenticated && agentRunning) {
			showChat();
		} else {
			showLogin();
		}
	} catch {
		showLogin();
	}
}

function showLogin() {
	loginOverlay.classList.add("visible");
	messagesEl.style.display = "none";
	footer.style.display = "none";
	modelLabel.textContent = "not signed in";
}

function showChat() {
	loginOverlay.classList.remove("visible");
	messagesEl.style.display = "";
	footer.style.display = "";
	connect();
}

loginBtn.addEventListener("click", async () => {
	loginBtn.disabled = true;
	loginError.classList.remove("visible");
	try {
		const res = await fetch("/api/auth/login", { method: "POST" });
		const { url } = await res.json();
		window.open(url, "_blank");
		loginCodeSection.classList.add("visible");
		loginCodeInput.focus();
	} catch (err: any) {
		loginError.textContent = err.message;
		loginError.classList.add("visible");
		loginBtn.disabled = false;
	}
});

loginSubmitBtn.addEventListener("click", submitLoginCode);
loginCodeInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter") submitLoginCode();
});

async function submitLoginCode() {
	const code = loginCodeInput.value.trim();
	if (!code) return;
	loginSubmitBtn.disabled = true;
	loginSpinner.classList.add("visible");
	loginError.classList.remove("visible");

	try {
		const res = await fetch("/api/auth/callback", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code }),
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error);
		showChat();
	} catch (err: any) {
		loginError.textContent = err.message;
		loginError.classList.add("visible");
		loginSubmitBtn.disabled = false;
	} finally {
		loginSpinner.classList.remove("visible");
	}
}

// --- WebSocket ---
let ws: WebSocket;

function connect() {
	const base = location.pathname.replace(/\/$/, "");
	ws = new WebSocket(`ws://${location.host}${base}/ws`);
	ws.onopen = () => {
		modelLabel.textContent = "connected";
		sendBtn.disabled = false;
		ws.send(JSON.stringify({ type: "get_state" }));
	};
	ws.onclose = () => {
		modelLabel.textContent = "reconnecting...";
		sendBtn.disabled = true;
		setTimeout(connect, 2000);
	};
	ws.onmessage = (e) => handleEvent(JSON.parse(e.data));
}

// --- Markdown ---
function renderMarkdown(text: string): string {
	let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

	html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
		`<pre><code class="${lang}">${code}</code></pre>`);
	html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
	html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
	html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
	html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
	html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
	html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
	html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
	html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
	html = html.replace(/\n\n/g, "</p><p>");
	html = `<p>${html}</p>`;
	html = html.replace(/<p><(h[1-4]|pre|ul|ol)/g, "<$1");
	html = html.replace(/<\/(h[1-4]|pre|ul|ol)><\/p>/g, "</$1>");

	return html;
}

// --- Rendering ---
function addUserMessage(text: string) {
	const div = document.createElement("div");
	div.className = "msg-user";
	div.innerHTML = `<div class="msg-user-bubble">${escapeHtml(text)}</div>`;
	messagesInner.appendChild(div);
	scrollToBottom();
}

function ensureAssistantBubble(): HTMLElement {
	if (!currentAssistantEl) {
		const wrapper = document.createElement("div");
		wrapper.className = "msg-assistant";
		const bubble = document.createElement("div");
		bubble.className = "msg-assistant-bubble prose";
		wrapper.appendChild(bubble);
		messagesInner.appendChild(wrapper);
		currentAssistantEl = bubble;
		currentAssistantText = "";
	}
	return currentAssistantEl;
}

function addToolBlock(toolName: string, toolCallId: string, args: any): HTMLElement {
	const container = document.createElement("div");
	container.id = `tool-${toolCallId}`;

	const block = document.createElement("details");
	block.className = "tool-block";

	const summary = document.createElement("summary");
	summary.textContent = toolName;
	block.appendChild(summary);

	const body = document.createElement("div");
	body.className = "tool-details";

	const argsText = typeof args === "string" ? args : JSON.stringify(args, null, 2);
	if (argsText && argsText !== "{}") {
		body.innerHTML = `<pre>${escapeHtml(truncate(argsText, 500))}</pre>`;
	}
	block.appendChild(body);
	container.appendChild(block);
	messagesInner.appendChild(container);
	scrollToBottom();
	return body;
}

function updateToolBlock(toolCallId: string, result: any, isError: boolean) {
	const container = document.getElementById(`tool-${toolCallId}`);
	if (!container) return;
	const body = container.querySelector(".tool-details") as HTMLElement;
	if (!body) return;

	const resultText = typeof result === "string" ? result : JSON.stringify(result, null, 2);
	const cls = isError ? "tool-result-err" : "tool-result-ok";
	const label = isError ? "error" : "result";

	body.innerHTML += `<div class="${cls}" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--divider)"><strong>${label}</strong></div><pre>${escapeHtml(truncate(resultText, 1000))}</pre>`;
	scrollToBottom();
}

// --- Events ---
function handleEvent(event: any) {
	switch (event.type) {
		case "state": {
			const s = event.data;
			if (s.model) modelLabel.textContent = `${s.model.id}`;
			break;
		}
		case "agent_ready":
			modelLabel.textContent = "ready";
			ws.send(JSON.stringify({ type: "get_state" }));
			break;
		case "session_cleared":
			messagesInner.innerHTML = "";
			currentAssistantEl = null;
			break;
		case "error":
			console.error("Bridge error:", event.error);
			break;

		case "agent_start":
			setStreaming(true);
			break;
		case "agent_end":
			setStreaming(false);
			finishAssistant();
			break;

		case "turn_start":
			currentAssistantEl = null;
			currentThinkingEl = null;
			currentThinkingText = "";
			break;
		case "turn_end":
			finishAssistant();
			break;

		case "message_update": {
			const ame = event.assistantMessageEvent;
			if (!ame) break;
			switch (ame.type) {
				case "text_delta": {
					const el = ensureAssistantBubble();
					currentAssistantText += ame.delta;
					el.innerHTML = renderMarkdown(currentAssistantText);
					scrollToBottom();
					break;
				}
				case "thinking_start": {
					const block = document.createElement("details");
					block.className = "thinking-block";
					const summary = document.createElement("summary");
					summary.textContent = "thinking...";
					block.appendChild(summary);
					const body = document.createElement("div");
					body.className = "thinking-body";
					block.appendChild(body);
					messagesInner.appendChild(block);
					currentThinkingEl = body;
					currentThinkingText = "";
					scrollToBottom();
					break;
				}
				case "thinking_delta": {
					if (currentThinkingEl) {
						currentThinkingText += ame.delta;
						currentThinkingEl.textContent = currentThinkingText;
					}
					break;
				}
				case "thinking_end": {
					currentThinkingEl = null;
					currentThinkingText = "";
					break;
				}
			}
			break;
		}
		case "message_end":
			finishAssistant();
			break;

		case "tool_execution_start":
			addToolBlock(event.toolName, event.toolCallId, event.args);
			break;
		case "tool_execution_end":
			updateToolBlock(event.toolCallId, event.result, event.isError);
			break;
	}
}

function finishAssistant() {
	currentAssistantEl = null;
	currentAssistantText = "";
}

function setStreaming(on: boolean) {
	streaming = on;
	streamIndicator.classList.toggle("visible", on);
	abortBtn.style.display = on ? "" : "none";
	sendBtn.disabled = on;
	if (!on) userInput.focus();
}

// --- Input ---
inputForm.addEventListener("submit", (e) => {
	e.preventDefault();
	const text = userInput.value.trim();
	if (!text || streaming) return;
	addUserMessage(text);
	ws.send(JSON.stringify({ type: "prompt", message: text }));
	userInput.value = "";
	autoResize();
});

userInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		inputForm.requestSubmit();
	}
});

userInput.addEventListener("input", autoResize);
function autoResize() {
	userInput.style.height = "auto";
	userInput.style.height = Math.min(userInput.scrollHeight, 160) + "px";
}

abortBtn.addEventListener("click", () => ws.send(JSON.stringify({ type: "abort" })));
newSessionBtn.addEventListener("click", () => ws.send(JSON.stringify({ type: "new_session" })));

// --- Util ---
function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max) + "\n... (truncated)" : s;
}

function scrollToBottom() {
	requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
}

// --- Init ---
checkAuth();
