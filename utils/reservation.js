export function formatReservationTime(value) {
	if (!value) return ''
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''
	// API timestamps are UTC; display consistently in China regardless of the device timezone.
	return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

export function formatWaitingDays(value) {
	if (value === null || value === undefined || !Number.isFinite(Number(value))) return ''
	return Number(value).toFixed(2)
}

export function createReservationRequestId() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
		const random = Math.floor(Math.random() * 16)
		return (character === 'x' ? random : (random & 3) | 8).toString(16)
	})
}
