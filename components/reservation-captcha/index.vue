<template>
	<view class="captcha-control">
		<view class="captcha-row">
			<input class="captcha-input" :value="value.code || ''" :disabled="disabled || loading || !challengeId" maxlength="4" placeholder="请输入图片中的4位字符" placeholder-class="captcha-placeholder" @input="handleInput" />
			<button class="captcha-image-button" :disabled="disabled || loading" aria-label="更换图片验证码" @tap="refresh">
				<image v-if="image" class="captcha-image" :src="image" mode="aspectFit" @error="handleImageError" />
				<text v-else class="captcha-placeholder">{{ loading ? '加载中...' : '点击获取' }}</text>
			</button>
		</view>
		<view class="captcha-help">
			<text :class="{ 'captcha-error': !!error }">{{ error || '数字和字母组合，不区分大小写，5分钟内有效' }}</text>
			<button class="refresh-button" :disabled="disabled || loading" @tap="refresh">换一张</button>
		</view>
	</view>
</template>
<script>
	import { getReservationCaptcha } from '../../utils/api.js'
	export default {
		props: { value: { type: Object, default: () => ({ id: '', code: '' }) }, disabled: Boolean },
		data() { return { image: '', challengeId: '', loading: false, error: '', expiryTimer: null, disposed: false } },
		mounted() { this.refresh() },
		beforeDestroy() { this.disposed = true; clearTimeout(this.expiryTimer) },
		methods: {
			async refresh() {
				if (this.disabled || this.loading || this.disposed) return
				clearTimeout(this.expiryTimer)
				this.loading = true; this.error = ''; this.image = ''; this.challengeId = ''
				this.$emit('input', { id: '', code: '' })
				try {
					const result = await getReservationCaptcha()
					if (this.disposed) return
					this.challengeId = result.id; this.image = result.image
					this.$emit('input', { id: result.id, code: '' })
					this.expiryTimer = setTimeout(() => {
						this.challengeId = ''; this.image = ''; this.error = '验证码已过期，请换一张'
						this.$emit('input', { id: '', code: '' })
					}, result.expiresIn * 1000)
				} catch (error) { if (!this.disposed) this.error = error.message || '验证码加载失败，请重试' }
				finally { if (!this.disposed) this.loading = false }
			},
			handleInput(event) {
				this.$emit('input', { id: this.challengeId, code: String(event.detail.value || '').replace(/[^a-z0-9]/gi, '').slice(0, 4) })
			},
			handleImageError() {
				clearTimeout(this.expiryTimer)
				this.image = ''; this.challengeId = ''; this.error = '验证码图片加载失败，请换一张'
				this.$emit('input', { id: '', code: '' })
			}
		}
	}
</script>
<style scoped>
	.captcha-row { display: flex; align-items: center; gap: 16rpx; }
	.captcha-input { flex: 1; min-width: 0; height: 84rpx; color: #4d5a68; font-size: 27rpx; }
	.captcha-image-button { flex: 0 0 240rpx; display: flex; align-items: center; justify-content: center; width: 240rpx; height: 84rpx; padding: 0; margin: 0; border-radius: 8rpx; background: #f2f6fc; line-height: 84rpx; }
	.captcha-image-button::after, .refresh-button::after { border: 0; }
	.captcha-image { display: block; width: 240rpx; height: 84rpx; }
	.captcha-placeholder { color: #a4aeb9; font-size: 25rpx; }
	.captcha-help { display: flex; align-items: center; justify-content: space-between; margin-top: 8rpx; color: #8a96a3; font-size: 22rpx; line-height: 34rpx; }
	.captcha-help > text { flex: 1; min-width: 0; }
	.refresh-button { flex-shrink: 0; padding: 8rpx 0 8rpx 16rpx; margin: 0; color: #1677ed; background: transparent; font-size: 24rpx; line-height: 34rpx; }
	.refresh-button[disabled] { color: #a4aeb9; background: transparent; }
	.captcha-error { color: #ef4c49; }
</style>
