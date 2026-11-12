const TOKEN_KEY = 'rehab_auth_token'
const EXPIRES_AT_KEY = 'rehab_auth_expires_at'
const USER_KEY = 'rehab_auth_user'
const LOGIN_ROUTE = '/pages/login/index'
const HOME_ROUTE = '/pages/index/index'

export function getToken() {
	const token = uni.getStorageSync(TOKEN_KEY)
	const expiresAt = Number(uni.getStorageSync(EXPIRES_AT_KEY))
	if (!token || !expiresAt || expiresAt <= Math.floor(Date.now() / 1000)) {
		clearSession()
		return ''
	}
	return token
}

export function saveSession(session) {
	uni.setStorageSync(TOKEN_KEY, session.token)
	uni.setStorageSync(EXPIRES_AT_KEY, session.expiresAt)
	uni.setStorageSync(USER_KEY, session.user || {})
}

export function clearSession() {
	uni.removeStorageSync(TOKEN_KEY)
	uni.removeStorageSync(EXPIRES_AT_KEY)
	uni.removeStorageSync(USER_KEY)
}

export function isLoggedIn() {
	return Boolean(getToken())
}

const PROTECTED_ROUTES = [
	'/pages/hzjbxx/index',
	'/pages/nurse/list',
	'/pages/nurse/detail',
	'/pages/nurse/reservation-detail',
	'/pages/cylc/index'
]

export function requiresAuthentication(url) {
	const route = '/' + String(url || '').split('?')[0].replace(/^\//, '')
	return PROTECTED_ROUTES.includes(route)
}

export function getLoginDestination(url) {
	// Only known internal business pages can be login return destinations.
	if (typeof url !== 'string' || !url.startsWith('/pages/') || /[\r\n#]/.test(url)) return HOME_ROUTE
	return requiresAuthentication(url) ? url : HOME_ROUTE
}

export function getCurrentPageUrl() {
	const pages = getCurrentPages()
	const current = pages[pages.length - 1]
	if (!current) return HOME_ROUTE
	if (current.$page && current.$page.fullPath) return current.$page.fullPath
	const query = Object.keys(current.options || {}).map(key =>
		encodeURIComponent(key) + '=' + encodeURIComponent(current.options[key])).join('&')
	return '/' + String(current.route || '').replace(/^\//, '') + (query ? '?' + query : '')
}

export function redirectToLogin(destination = getCurrentPageUrl()) {
	const pages = getCurrentPages()
	const current = pages[pages.length - 1]
	if (current && current.route === 'pages/login/index') return
	uni.reLaunch({ url: `${LOGIN_ROUTE}?next=${encodeURIComponent(getLoginDestination(destination))}` })
}

export function ensureAuthenticated(destination = getCurrentPageUrl()) {
	if (isLoggedIn()) return true
	redirectToLogin(destination)
	return false
}

export { HOME_ROUTE, LOGIN_ROUTE }
