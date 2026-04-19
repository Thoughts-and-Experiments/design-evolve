import { useEffect, useState } from 'react'

const EVAL_PORT = 3031

type StatusState = 'idle' | 'sending' | 'reading' | 'working' | 'done' | 'error'
interface Status {
	state: StatusState
	message: string
	current?: number
	total?: number
	ts: number
}

export function StatusBar() {
	const [status, setStatus] = useState<Status>({ state: 'idle', message: '', ts: 0 })

	useEffect(() => {
		let cancelled = false
		const tick = async () => {
			try {
				const res = await fetch(`http://localhost:${EVAL_PORT}/status`)
				const data = await res.json()
				if (!cancelled) setStatus(data)
			} catch {}
		}
		tick()
		const id = setInterval(tick, 600)
		return () => {
			cancelled = true
			clearInterval(id)
		}
	}, [])

	const visible = status.state !== 'idle' && status.message.length > 0
	const isError = status.state === 'error'
	const isDone = status.state === 'done'
	const isWorking = !isError && !isDone

	const indicator =
		status.total && status.current !== undefined
			? ` · ${status.current} of ${status.total}`
			: ''

	return (
		<div
			style={{
				position: 'fixed',
				top: 0,
				left: '50%',
				transform: `translateX(-50%) translateY(${visible ? '0' : '-120%'})`,
				transition: 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
				zIndex: 100000,
				pointerEvents: 'none',
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 10,
					padding: '8px 16px',
					background: 'rgba(20, 20, 22, 0.92)',
					color: 'rgba(255, 255, 255, 0.96)',
					borderRadius: '0 0 12px 12px',
					boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
					fontSize: 13,
					fontFamily:
						'-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
					fontWeight: 500,
					letterSpacing: '-0.01em',
					backdropFilter: 'blur(8px)',
					WebkitBackdropFilter: 'blur(8px)',
				}}
			>
				<Indicator working={isWorking} error={isError} done={isDone} />
				<span>
					{status.message}
					{indicator}
				</span>
			</div>
		</div>
	)
}

function Indicator({ working, error, done }: { working: boolean; error: boolean; done: boolean }) {
	const color = error ? '#ef4444' : done ? '#22c55e' : '#a78bfa'
	if (done) {
		return (
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3">
				<polyline points="20 6 9 17 4 12" />
			</svg>
		)
	}
	if (error) {
		return (
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3">
				<line x1="18" y1="6" x2="6" y2="18" />
				<line x1="6" y1="6" x2="18" y2="18" />
			</svg>
		)
	}
	return (
		<>
			<style>{`
				@keyframes status-pulse {
					0%, 100% { opacity: 0.35; transform: scale(0.85); }
					50% { opacity: 1; transform: scale(1); }
				}
			`}</style>
			<span
				style={{
					width: 8,
					height: 8,
					borderRadius: '50%',
					background: color,
					animation: working ? 'status-pulse 1.1s ease-in-out infinite' : 'none',
					display: 'inline-block',
				}}
			/>
		</>
	)
}
