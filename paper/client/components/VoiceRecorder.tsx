import { useCallback, useRef, useState } from 'react'
import { TldrawUiButton, useEditor } from 'tldraw'

export function VoiceRecorder() {
	const editor = useEditor()
	const [recording, setRecording] = useState(false)
	const [transcript, setTranscript] = useState('')
	const recognitionRef = useRef<any>(null)
	const fullTranscriptRef = useRef('')

	const startRecording = useCallback(() => {
		const SpeechRecognition =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
		if (!SpeechRecognition) {
			console.error('SpeechRecognition not supported')
			return
		}

		const recognition = new SpeechRecognition()
		recognition.continuous = true
		recognition.interimResults = true
		recognition.lang = 'en-US'

		fullTranscriptRef.current = ''
		setTranscript('')

		recognition.onresult = (event: any) => {
			let interim = ''
			let final = ''
			for (let i = 0; i < event.results.length; i++) {
				if (event.results[i].isFinal) {
					final += event.results[i][0].transcript
				} else {
					interim += event.results[i][0].transcript
				}
			}
			fullTranscriptRef.current = final
			setTranscript(final + interim)
		}

		recognition.onerror = (event: any) => {
			console.error('Speech error:', event.error)
			setRecording(false)
		}

		recognition.onend = () => {
			setRecording(false)
		}

		recognitionRef.current = recognition
		recognition.start()
		setRecording(true)
	}, [])

	const stopRecording = useCallback(() => {
		if (recognitionRef.current) {
			recognitionRef.current.stop()
			recognitionRef.current = null
		}
		setRecording(false)

		const text = fullTranscriptRef.current.trim()
		if (!text) return

		const viewport = editor.getViewportScreenBounds()
		const center = editor.screenToPage({ x: viewport.w / 2, y: viewport.h / 2 })

		const noteId = `shape:voice-${Date.now()}`
		editor.createShape({
			id: noteId as any,
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

		setTranscript('')
		fullTranscriptRef.current = ''
	}, [editor])

	const handleClick = useCallback(() => {
		if (recording) {
			stopRecording()
		} else {
			startRecording()
		}
	}, [recording, startRecording, stopRecording])

	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
			<TldrawUiButton
				type="normal"
				onClick={handleClick}
				style={{
					backgroundColor: recording ? '#ef4444' : '#8b5cf6',
					color: 'white',
					borderRadius: 8,
					padding: '4px 12px',
					fontWeight: 600,
					fontSize: 13,
					animation: recording ? 'pulse-recording 1.5s ease-in-out infinite' : 'none',
					transition: 'all 0.2s',
				}}
			>
				<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					{recording ? (
						<>
							<span
								style={{
									width: 8,
									height: 8,
									borderRadius: '50%',
									backgroundColor: 'white',
								}}
							/>
							Stop
						</>
					) : (
						<>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="white">
								<path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" />
								<path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="white" strokeWidth="2" fill="none" />
								<line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" />
							</svg>
							Voice
						</>
					)}
				</span>
			</TldrawUiButton>
			{recording && transcript && (
				<span
					style={{
						fontSize: 11,
						color: '#666',
						maxWidth: 200,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{transcript}
				</span>
			)}
		</div>
	)
}
