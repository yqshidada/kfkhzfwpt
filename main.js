import App from './App'
import { ensureAuthenticated, requiresAuthentication, getCurrentPageUrl } from './utils/auth.js'

function guardPage() {
	const route = (this.$page && this.$page.fullPath) || this.route
	if (requiresAuthentication(route)) ensureAuthenticated(getCurrentPageUrl())
}

// #ifndef VUE3
import Vue from 'vue'
import './uni.promisify.adaptor'
Vue.config.productionTip = false
Vue.mixin({
	onShow: guardPage
})
App.mpType = 'app'
const app = new Vue({
	...App
})
app.$mount()
// #endif

// #ifdef VUE3
import {
	createSSRApp
} from 'vue'
export function createApp() {
	const app = createSSRApp(App)
	app.mixin({
		onShow: guardPage
	})
	return {
		app
	}
}
// #endif
