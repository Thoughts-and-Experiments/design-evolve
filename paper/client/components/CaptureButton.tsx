import { useCallback, useState } from 'react'
import { TldrawUiButton, TldrawUiButtonLabel, useEditor } from 'tldraw'

const EVAL_PORT = 3031

export function CaptureButton() {
	const editor = useEditor()
	const [sending, setSending] = useState(false)
	const [sent, setSent] = useState(false)

	const handleCapture = useCallback(async () => {
		setSending(true)
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

			const payload = {
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
			}

			await fetch(`http://localhost:${EVAL_PORT}/capture`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})

			setSent(true)
			setTimeout(() => setSent(false), 3000)
		} catch (e) {
			console.error('Capture failed:', e)
		} finally {
			setSending(false)
		}
	}, [editor])

	return (
		<TldrawUiButton
			type="normal"
			onClick={handleCapture}
			style={{
				backgroundColor: sent ? '#22c55e' : '#6366f1',
				color: 'white',
				borderRadius: 8,
				padding: '4px 12px',
				fontWeight: 600,
				fontSize: 13,
				opacity: sending ? 0.6 : 1,
				transition: 'all 0.2s',
			}}
		>
			<TldrawUiButtonLabel>
				{sent ? 'Captured!' : sending ? 'Sending...' : 'Capture'}
			</TldrawUiButtonLabel>
		</TldrawUiButton>
	)
}
