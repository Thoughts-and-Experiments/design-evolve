import { useCallback, useRef, useState } from 'react'
import { useEditor } from 'tldraw'

const EVAL_PORT = 3031

export function VoiceToolbarItem() {
	const editor = useEditor()
	const [recording, setRecording] = useState(false)
	const recognitionRef = useRef<any>(null)
	const fullTranscriptRef = useRef('')

	const toggle = useCallback(() => {
		if (recording) {
			if (recognitionRef.current) {
				recognitionRef.current.stop()
				recognitionRef.current = null
			}
			setRecording(false)

			const text = fullTranscriptRef.current.trim()
			if (!text) return

			const viewport = editor.getViewportScreenBounds()
			const center = editor.screenToPage({ x: viewport.w / 2, y: viewport.h / 2 })
			editor.createShape({
				id: `shape:voice-${Date.now()}` as any,
				type: 'note',
				x: center.x - 100,
				y: center.y - 50,
				props: {
					richText: {
						type: 'doc',
						content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
					},
					color: 'violet',
					size: 'm',
				} as any,
			})
			fullTranscriptRef.current = ''
		} else {
			const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
			if (!SR) return

			const recognition = new SR()
			recognition.continuous = true
			recognition.interimResults = true
			recognition.lang = 'en-US'
			fullTranscriptRef.current = ''

			recognition.onresult = (event: any) => {
				let final = ''
				for (let i = 0; i < event.results.length; i++) {
					if (event.results[i].isFinal) final += event.results[i][0].transcript
				}
				fullTranscriptRef.current = final
			}
			recognition.onerror = () => setRecording(false)
			recognition.onend = () => setRecording(false)

			recognitionRef.current = recognition
			recognition.start()
			setRecording(true)
		}
	}, [recording, editor])

	return (
		<button
			data-testid="tools.voice"
			aria-label={recording ? 'Stop Recording' : 'Voice Note'}
			title={recording ? 'Stop Recording' : 'Voice Note'}
			onClick={toggle}
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: 40,
				height: 40,
				borderRadius: 10,
				border: 'none',
				cursor: 'pointer',
				background: recording ? '#ef4444' : '#8b5cf6',
				animation: recording ? 'pulse-recording 1.5s ease-in-out infinite' : 'none',
				transition: 'background 0.2s',
			}}
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="white">
				<path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" />
				<path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="white" strokeWidth="2" fill="none" />
				<line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" />
			</svg>
		</button>
	)
}

export function CaptureToolbarItem() {
	const editor = useEditor()
	const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')

	const handleCapture = useCallback(async () => {
		setState('sending')
		try {
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
		}
	}, [editor])

	return (
		<button
			data-testid="tools.capture"
			aria-label="Capture Exploration"
			title={state === 'sent' ? 'Captured!' : 'Capture Exploration'}
			onClick={handleCapture}
			disabled={state === 'sending'}
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: 40,
				height: 40,
				borderRadius: 10,
				border: 'none',
				cursor: state === 'sending' ? 'wait' : 'pointer',
				background: state === 'sent' ? '#22c55e' : '#6366f1',
				opacity: state === 'sending' ? 0.6 : 1,
				transition: 'all 0.2s',
			}}
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
				{state === 'sent' ? (
					<polyline points="20 6 9 17 4 12" />
				) : (
					<>
						<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
						<circle cx="12" cy="13" r="4" />
					</>
				)}
			</svg>
		</button>
	)
}
