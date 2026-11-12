<template>
	<view class="page">
		<view class="page-header">
			<text class="page-header__title">康复科患者服务平台</text>
			<text v-if="loggedIn" class="logout" @tap="handleLogout">退出登录</text>
		</view>
		<view
			v-for="item in menuItems"
			:key="item.title"
			class="entry-card"
			hover-class="entry-card--pressed"
			hover-stay-time="80"
			@tap="handleMenuTap(item)"
		>
			<view class="entry-icon" :class="item.background">
				<image :src="item.icon" mode="aspectFit" />
			</view>
			<view class="entry-content">
				<text class="entry-title">{{ item.title }}</text>
				<text class="entry-description">{{ item.description }}</text>
			</view>
			<text class="entry-arrow">›</text>
		</view>
	</view>
</template>

<script>
	import { clearSession, isLoggedIn, ensureAuthenticated, requiresAuthentication } from '../../utils/auth.js'

	export default {
		data() {
			return {
				loggedIn: false,
				menuItems: [
					{ title: '入院流程', description: '查看入院办理流程，扫码阅读入院指引', path: '/pages/rylc/index', icon: '/static/icons/admission.svg', background: 'entry-icon--mint' },
					{ title: '预约床位', description: '填写预约床位信息，无需登录', path: '/pages/bed-reservation/index', icon: '/static/icons/bed.svg', background: 'entry-icon--mint' },
					{ title: '患者入口', description: '填写患者基本情况，生成文档并打印好给到患者', path: '/pages/hzjbxx/index', icon: '/static/icons/patient.svg', background: 'entry-icon--mint' },
					{ title: '护士入口', description: '查看已就诊患者记录，了解已就诊患者基本情况', path: '/pages/nurse/list', icon: '/static/icons/nurse.svg', background: 'entry-icon--mint' },
					{ title: '出院流程', description: '选择患者并填写出院流程，生成文档及二维码', path: '/pages/nurse/list?mode=flow', icon: '/static/icons/discharge.svg', background: 'entry-icon--mint' }
				]
			}
		},
		onShow() {
			this.loggedIn = isLoggedIn()
		},
		methods: {
			handleLogout() {
				clearSession()
				this.loggedIn = false
				uni.showToast({ title: '已退出登录', icon: 'none' })
			},
			handleMenuTap(item) {
				if (requiresAuthentication(item.path) && !ensureAuthenticated(item.path)) return
				if (item.path) return uni.navigateTo({ url: item.path })
				uni.showToast({ title: '功能暂未开放', icon: 'none' })
			}
		}
	}
</script>

<style>
	page { background: #f5f6f8; }

	.page {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		padding: 32rpx 20rpx 40rpx;
		background: #f5f6f8;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12rpx 20rpx;
		margin: 4rpx 8rpx 24rpx;
	}

	.page-header__title { color: #253344; font-size: 38rpx; font-weight: 600; line-height: 52rpx; }
	.logout { flex-shrink: 0; margin-left: auto; color: #1677ed; font-size: 28rpx; line-height: 44rpx; }

	.entry-card {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 216rpx;
		margin-bottom: 24rpx;
		padding: 30rpx 28rpx;
		border: 1rpx solid #edf0f2;
		border-radius: 34rpx;
		background: #ffffff;
		box-shadow: 0 4rpx 14rpx rgba(33, 42, 55, 0.08);
		transition: transform 0.12s ease, opacity 0.12s ease;
	}

	.entry-card--pressed { opacity: 0.72; transform: scale(0.985); }
	.entry-card:last-child { margin-bottom: 0; }

	.entry-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 108rpx;
		width: 108rpx;
		height: 108rpx;
		border-radius: 28rpx;
	}

	.entry-icon--mint { background: #eaf5f0; }
	.entry-icon image { width: 66rpx; height: 66rpx; }

	.entry-content {
		box-sizing: border-box;
		flex: 1;
		min-width: 0;
		padding: 0 20rpx;
	}

	.entry-title {
		display: block;
		margin-bottom: 8rpx;
		color: #20252b;
		font-size: 36rpx;
		font-weight: 600;
		line-height: 46rpx;
	}

	.entry-description {
		display: -webkit-box;
		overflow: hidden;
		color: #687079;
		font-size: 27rpx;
		line-height: 40rpx;
		text-overflow: ellipsis;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
	}

	.entry-arrow {
		flex: 0 0 24rpx;
		width: 24rpx;
		color: #92999f;
		font-family: Arial, sans-serif;
		font-size: 48rpx;
		font-weight: 300;
		line-height: 48rpx;
		text-align: right;
	}
</style>
