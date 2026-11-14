import { clearSession, getToken, redirectToLogin } from './auth.js'

// #ifdef H5
// H5 使用相对地址；本地由 manifest.json 的 devServer.proxy 转发，生产环境同站点访问。
export const API_BASE_URL = '/api'
// #endif

// #ifndef H5
// 小程序/真机调试时，将 127.0.0.1 改为运行后端电脑的局域网 IP。
export const API_BASE_URL = 'http://127.0.0.1:3000/api'
// #endif

function request({ url, method = 'GET', data, requiresAuth = true }) {
	return new Promise((resolve, reject) => {
		const token = requiresAuth ? getToken() : ''
		if (requiresAuth && !token) {
			redirectToLogin()
			return reject(new Error('登录已失效，请重新登录'))
		}
		uni.request({
			url: `${API_BASE_URL}${url}`,
			method,
			data,
			header: {
				'content-type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			success: response => {
				if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response.data)
				if (response.statusCode === 401) {
					clearSession()
					redirectToLogin()
				}
				reject(Object.assign(new Error((response.data && response.data.message) || '服务请求失败'), {
					code: response.data && response.data.code, statusCode: response.statusCode
				}))
			},
			fail: () => reject(new Error('无法连接服务器，请检查网络后重试'))
		})
	})
}

export function login(data) {
	return request({ url: '/auth/login', method: 'POST', data, requiresAuth: false })
}

export function createDischargeRecord(data) {
	return request({ url: '/discharge-records', method: 'POST', data })
}

export function getDischargeRecords(params) {
	const query = Object.keys(params || {}).filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
		.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join('&')
	return request({ url: `/discharge-records${query ? `?${query}` : ''}` })
}

export function getDischargeRecord(id) {
	return request({ url: `/discharge-records/${encodeURIComponent(id)}` })
}

export function shareDischargeRecord(id, data) {
	return request({ url: `/discharge-records/${encodeURIComponent(id)}/share`, method: 'POST', data })
}

export function getDischargeRecordShare(id) {
	return request({ url: `/discharge-records/${encodeURIComponent(id)}/share` })
}

export function revokeDischargeRecordShare(id) {
	return request({ url: `/discharge-records/${encodeURIComponent(id)}/share`, method: 'DELETE' })
}

export function getDischargeFlow(id) {
	return request({ url: `/discharge-records/${encodeURIComponent(id)}/flow` })
}

export function getAdmissionFlowShare() {
	return request({ url: '/admission-flow/share', requiresAuth: false })
}

export function generateDischargeFlow(id, data) {
	return request({ url: `/discharge-records/${encodeURIComponent(id)}/flow`, method: 'POST', data })
}

export function revokeDischargeFlowShare(id) {
	return request({ url: `/discharge-records/${encodeURIComponent(id)}/flow/share`, method: 'DELETE' })
}

export function createBedReservation(data) {
	return request({ url: '/bed-reservations', method: 'POST', data, requiresAuth: false })
}

export function lookupBedReservations(data) {
	return request({ url: '/bed-reservations/lookup', method: 'POST', data, requiresAuth: false })
}

export function updateBedReservationNote(id, data) {
	return request({ url: '/bed-reservations/' + encodeURIComponent(id) + '/note', method: 'POST', data })
}

export function getBedReservations(params = {}) {
	const query = Object.keys(params).filter(key => params[key] !== null && params[key] !== undefined && params[key] !== '')
		.map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key])).join('&')
	return request({ url: '/bed-reservations' + (query ? '?' + query : '') })
}

export function getBedReservation(id) {
	return request({ url: '/bed-reservations/' + encodeURIComponent(id) })
}

export function confirmBedReservation(id) {
	return request({ url: '/bed-reservations/' + encodeURIComponent(id) + '/confirm', method: 'POST' })
}

export function getReservationCaptcha() {
	return request({ url: '/bed-reservations/captcha', requiresAuth: false })
}

export function cancelBedReservation(id) {
	return request({ url: '/bed-reservations/' + encodeURIComponent(id) + '/cancel', method: 'POST' })
}

export function getBedReservationReminders() {
	return request({ url: '/bed-reservations/reminders' })
}

export function rebookBedReservation(id, data) {
	return request({ url: '/bed-reservations/' + encodeURIComponent(id) + '/rebook', method: 'POST', data })
}

export function deleteBedReservation(id) {
	return request({ url: '/bed-reservations/' + encodeURIComponent(id), method: 'DELETE' })
}
