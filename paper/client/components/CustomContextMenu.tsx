import { useCallback, useRef, useState } from 'react'
import { DefaultContextMenu, DefaultContextMenuContent, useEditor } from 'tldraw'

const EVAL_PORT = 3031

export function CustomContextMenu({ children }: { children?: React.ReactNode }) {
	return (
		<DefaultContextMenu>
			<DefaultContextMenuContent />
			<div style={{ borderTop: '1px solid var(--color-divider)', margin: '4px 0' }} />
			<VoiceMenuItem />
			<CaptureMenuItem />
			{children}
		</DefaultContextMenu>
	)
}

function VoiceMenuItem() {
	const editor = useEditor()
	const [recording, setRecording] = useState(false)
	const recognitionRef = useRef<any>(null)
	const fullTranscriptRef = useRef('')
	const dropPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
	const noteIdRef = useRef<string | null>(null)

	const updateNoteText = useCallback((text: string) => {
		const id = noteIdRef.current
		if (!id) return
		editor.updateShape({
			id: id as any,
			type: 'note',
			props: {
				richText: {
					type: 'doc',
					content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
				},
			} as any,
		})
	}, [editor])

	const toggle = useCallback(() => {
		if (recording) {
			if (recognitionRef.current) {
				try { recognitionRef.current.stop() } catch {}
				recognitionRef.current = null
			}
			setRecording(false)

			const text = fullTranscriptRef.current.trim()
			console.log('[Voice] stopped, transcript:', text)
			if (text) {
				updateNoteText(text)
			} else {
				updateNoteText('(no audio captured)')
			}
			fullTranscriptRef.current = ''
			noteIdRef.current = null
		} else {
			dropPointRef.current = editor.inputs.currentPagePoint.toJson()

			const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
			if (!SR) {
				alert('Speech recognition not supported in this browser. Use Chrome.')
				return
			}

			const pt = dropPointRef.current
			const id = `shape:voice-${Date.now()}`
			noteIdRef.current = id
			editor.createShape({
				id: id as any,
				type: 'note',
				x: pt.x - 100,
				y: pt.y - 50,
				props: {
					richText: {
						type: 'doc',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: '🎙️ Recording...' }] }],
					},
					color: 'violet',
					size: 'm',
				} as any,
			})
			console.log('[Voice] placeholder created:', id, 'at', pt)

			const recognition = new SR()
			recognition.continuous = true
			recognition.interimResults = true
			recognition.lang = 'en-US'
			fullTranscriptRef.current = ''

			recognition.onresult = (event: any) => {
				let final = ''
				let interim = ''
				for (let i = 0; i < event.results.length; i++) {
					const transcript = event.results[i][0].transcript
					if (event.results[i].isFinal) final += transcript
					else interim += transcript
				}
				const combined = (final + interim).trim()
				fullTranscriptRef.current = combined
				if (combined) updateNoteText('🎙️ ' + combined)
			}
			recognition.onerror = (e: any) => {
				console.error('[Voice] error:', e)
				setRecording(false)
			}
			recognition.onend = () => {
				console.log('[Voice] onend fired')
				setRecording(false)
			}

			recognitionRef.current = recognition
			recognition.start()
			setRecording(true)
		}
	}, [recording, editor, updateNoteText])

	return (
		<button
			onClick={toggle}
			className="tlui-button tlui-context-menu__item"
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'flex-start',
				gap: 8,
				padding: '6px 12px',
				width: '100%',
				border: 'none',
				cursor: 'pointer',
				fontSize: 13,
				fontFamily: 'inherit',
				background: recording ? '#fef2f2' : 'transparent',
				color: recording ? '#ef4444' : '#8b5cf6',
				fontWeight: 500,
				textAlign: 'left',
			}}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill={recording ? '#ef4444' : '#8b5cf6'} style={{ flexShrink: 0 }}>
				<path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" />
				<path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke={recording ? '#ef4444' : '#8b5cf6'} strokeWidth="2" fill="none" />
				<line x1="12" y1="19" x2="12" y2="23" stroke={recording ? '#ef4444' : '#8b5cf6'} strokeWidth="2" />
			</svg>
			{recording ? 'Stop Recording' : 'Voice Note'}
		</button>
	)
}

function CaptureMenuItem() {
	const editor = useEditor()
	const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')

	const handleCapture = useCallback(async () => {
		setState('sending')
		try {
			fetch(`http://localhost:${EVAL_PORT}/status`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ state: 'sending', message: 'Sending context to Claude' }),
			}).catch(() => {})

			const shapes = editor.getCurrentPageShapes()
			const annotations = shapes.filter(
				(s) =>
					s.type === 'draw' ||
					s.type === 'arrow' ||
					s.type === 'text' ||
					s.type === 'note' ||
					(s.type === 'geo' && !s.id.startsWith('shape:placeholder'))
			)
			const images = shapes.filter((s) => s.type === 'image')

			await fetch(`http://localhost:${EVAL_PORT}/capture`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					annotations: annotations.map((s) => ({
						id: s.id,
						type: s.type,
						x: s.x,
						y: s.y,
						props: s.props,
					})),
					images: images.map((s) => ({
						id: s.id,
						x: s.x,
						y: s.y,
						w: (s.props as any).w,
						h: (s.props as any).h,
					})),
					selectedIds: editor.getSelectedShapeIds(),
					shapeCount: shapes.length,
				}),
			})

			setState('sent')
			setTimeout(() => setState('idle'), 2000)
		} catch (e) {
			console.error('Capture failed:', e)
			setState('idle')
			fetch(`http://localhost:${EVAL_PORT}/status`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ state: 'error', message: 'Failed to send context' }),
			}).catch(() => {})
		}
	}, [editor])

	const color = state === 'sent' ? '#22c55e' : '#6366f1'
	const label = state === 'sent' ? 'Sent!' : state === 'sending' ? 'Sending...' : 'Send Context'

	return (
		<button
			onClick={handleCapture}
			disabled={state === 'sending'}
			className="tlui-button tlui-context-menu__item"
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'flex-start',
				gap: 8,
				padding: '6px 12px',
				width: '100%',
				border: 'none',
				cursor: state === 'sending' ? 'wait' : 'pointer',
				fontSize: 13,
				fontFamily: 'inherit',
				background: 'transparent',
				color,
				fontWeight: 500,
				textAlign: 'left',
			}}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill={color} stroke="none" style={{ flexShrink: 0 }}>
				{state === 'sent' ? (
					<polyline points="20 6 9 17 4 12" fill="none" stroke={color} strokeWidth="2" />
				) : (
					<path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
				)}
			</svg>
			{label}
		</button>
	)
}
