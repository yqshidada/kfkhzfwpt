<template>
	<view class="page">
		<view class="hero">
			<view class="hero-ring hero-ring--left"></view>
			<view class="hero-ring hero-ring--right"></view>
			<view class="brand-mark">
				<text class="brand-text">康复</text>
				<text class="brand-plus">+</text>
			</view>
			<text class="brand-title">登录</text>
		</view>

		<view class="login-card">
			<input :value="username" class="login-input" type="number" placeholder="请输入手机号" placeholder-class="input-placeholder" maxlength="11" @input="handlePhoneInput" />
			<input v-model="password" class="login-input" password placeholder="请输入密码" placeholder-class="input-placeholder" maxlength="64" @confirm="handleLogin" />
			<!-- <text class="input-tip">密码至少 8 位，且必须包含字母和数字</text> -->
			<button class="login-button" :loading="submitting" @tap="handleLogin">登录</button>
			<view class="back-home" @tap="goHome">暂不登录，返回首页</view>
		</view>
	</view>
</template>

<script>
	import { login } from '../../utils/api.js'
	import { HOME_ROUTE, isLoggedIn, saveSession, getLoginDestination } from '../../utils/auth.js'

	export default {
		data() {
			const isDevelopment = process.env.NODE_ENV === 'development'
			return { username: isDevelopment ? '13800138000' : '', password: isDevelopment ? 'Test1234' : '', submitting: false, nextUrl: HOME_ROUTE }
		},
		onLoad(query = {}) {
			this.nextUrl = getLoginDestination(query.next)
			if (isLoggedIn()) uni.reLaunch({ url: this.nextUrl })
		},
		methods: {
			goHome() { uni.reLaunch({ url: HOME_ROUTE }) },
			handlePhoneInput(event) {
				this.username = String(event.detail.value || '').replace(/\D/g, '').slice(0, 11)
			},
			async handleLogin() {
				if (this.submitting) return
				if (!/^1[3-9]\d{9}$/.test(this.username)) return uni.showToast({ title: '请输入正确的11位手机号', icon: 'none' })
				if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(this.password)) return uni.showToast({ title: '密码至少8位，且包含字母和数字', icon: 'none' })
				this.submitting = true
				try {
					const result = await login({ username: this.username, password: this.password })
					saveSession(result)
					uni.reLaunch({ url: this.nextUrl })
				} catch (error) {
					uni.showToast({ title: error.message || '登录失败，请重试', icon: 'none' })
				} finally {
					this.submitting = false
				}
			}
		}
	}
</script>

<style>
	.back-home { margin-top: 28rpx; color: #607080; text-align: center; font-size: 28rpx; line-height: 44rpx; }
	.page { position: relative; min-height: 100vh; overflow: hidden;}
	.hero { position: relative; height: 430rpx; overflow: hidden; background: #1295ee; }
	.hero-ring { position: absolute; border: 2rpx solid rgba(255, 255, 255, 0.08); border-radius: 50%; }
	.hero-ring--left { width: 324rpx; height: 324rpx; top: 168rpx; left: -202rpx; }
	.hero-ring--right { width: 448rpx; height: 448rpx; top: -194rpx; right: -130rpx; }
	.brand-mark { position: absolute; top: 72rpx; left: 50%; display: flex; align-items: center; justify-content: center; width: 122rpx; height: 122rpx; margin-left: -61rpx; border-radius: 50%; background: #fff; box-shadow: 0 5rpx 14rpx rgba(0, 85, 147, 0.18); }
	.brand-text { color: #2378b8; font-size: 31rpx; font-weight: 700; line-height: 1; }
	.brand-plus { position: absolute; right: 24rpx; bottom: 16rpx; color: #168fe5; font-size: 35rpx; font-weight: 700; line-height: 1; }
	.brand-title { position: absolute; top: 228rpx; left: 0; width: 100%; color: #fff; font-size: 43rpx; font-weight: 600; line-height: 56rpx; text-align: center; }
	.login-card { position: absolute; left: 0; right: 0; box-sizing: border-box; min-height: 660rpx; margin: -126rpx 32rpx 0; padding: 64rpx 44rpx; border-radius: 22rpx 22rpx 0 0; background: #fff; box-shadow: 0 8rpx 24rpx rgba(17, 72, 112, 0.12); }
	.login-input { box-sizing: border-box; width: 100%; height: 100rpx; margin-bottom: 32rpx; padding: 0 24rpx; border-radius: 12rpx; background: #f4f7fb; color: #334154; font-size: 30rpx; line-height: 100rpx; }
	.input-tip { display: block; margin: -12rpx 0 12rpx; color: #8791a0; font-size: 24rpx; line-height: 36rpx; }
	.input-placeholder { color: #b7bec9; }
	.login-button { width: 100%; height: 100rpx; margin-top: 34rpx; border-radius: 12rpx; background: #1295ee; color: #fff; font-size: 34rpx; font-weight: 500; line-height: 100rpx; }
	.login-button::after { border: 0; }
	.login-button:active { background: #087ed0; }
</style>
