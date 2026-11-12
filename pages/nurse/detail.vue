<template>
	<view class="page">
		<view v-if="loading" class="state-text">正在加载记录...</view>
		<view v-else-if="error" class="state-panel">
			<text>{{ error }}</text>
			<button class="retry-button" size="mini" @tap="loadRecord">重新加载</button>
		</view>
		<block v-else-if="record">
			<view class="card">
				<view class="card-title">患者信息</view>
				<view class="field"><text>住院号：</text><text>{{ record.form.hospitalizationNumber }}</text></view>
				<view class="field"><text>性别：</text><text>{{ record.form.gender }}</text></view>
				<view class="field"><text>年龄：</text><text>{{ record.form.age }}</text></view>
				<view class="field"><text>联系电话：</text><text>{{ record.form.phone }}</text></view>
				<view class="field"><text>生成时间：</text><text>{{ formatDate(record.createdAt) }}</text></view>
			</view>

			<view class="card">
				<view class="card-title">诊断</view>
				<view class="field"><text>诊断结果：</text><text>{{ record.form.diagnosis }}</text></view>
			</view>

			<view class="card">
				<view class="card-title">出院带药</view>
				<view class="field"><text>是否带药：</text><text>{{ record.form.hasDischargeMedication }}</text></view>
				<view class="field"><text>药物类型：</text><text>{{ record.form.medicationTypesText }}</text></view>
			</view>

			<view class="card">
				<view class="card-title">管道信息</view>
				<view class="field"><text>有无管道：</text><text>{{ record.form.hasTube }}</text></view>
				<view class="field"><text>管道类型：</text><text>{{ record.form.tubeTypesText }}</text></view>
			</view>

			<view class="card">
				<view class="card-title">皮肤情况</view>
				<view class="field"><text>皮肤情况：</text><text>{{ record.form.skinTypesText }}</text></view>
			</view>

			<view class="card share-card" v-if="share">
				<view class="card-title">患者出院报告二维码</view>
				<image class="share-qr" :src="share.qrDataUrl" mode="widthFix" />
				<view class="share-expiry">链接有效期至 {{ formatDate(share.expiresAt) }}</view>
				<button v-if="false" class="share-button" size="mini" @tap="copyShareUrl">复制分享链接</button>
				<button v-if="false" class="revoke-button" size="mini" @tap="revokeShare">撤销分享</button>
			</view>
			<view v-if="hasFlow" class="card share-card">
				<view class="card-title">出院流程二维码</view>
				<view v-if="flowError" class="share-expiry">{{ flowError }}<button class="share-button" size="mini" @tap="loadFlow">重新加载</button></view>
				<block v-else-if="flowShare">
					<image class="share-qr" :src="flowShare.qrDataUrl" mode="widthFix" />
					<view class="share-expiry">链接有效期至 {{ formatDate(flowShare.expiresAt) }}</view>
					<button v-if="false" class="share-button" size="mini" @tap="copyFlowUrl">复制分享链接</button>
					<button v-if="false" class="revoke-button" size="mini" @tap="revokeFlow">撤销流程分享</button>
				</block>
				<view v-else class="share-expiry">流程分享已过期或撤销。</view>
			</view>
		</block>
	</view>
</template>

<script>
	import { getDischargeRecord, getDischargeRecordShare, revokeDischargeRecordShare, getDischargeFlow, revokeDischargeFlowShare } from '../../utils/api.js'

	export default {
		data() {
			return { id: '', record: null, share: null, flowShare: null, hasFlow: false, flowError: '', loading: false, error: '' }
		},
		onLoad(query) {
			this.id = query.id
		},
		onShow() { if (this.id) this.loadRecord() },
		methods: {
			copyFlowUrl() { if (this.flowShare) uni.setClipboardData({ data: this.flowShare.url }) },
			async loadFlow() {
				this.flowError = ''
				try {
					const result = await getDischargeFlow(this.id)
					this.hasFlow = Boolean(result.flow)
					this.flowShare = result.flow && result.flow.share || null
				} catch (error) { this.flowError = error.message || '流程二维码加载失败' }
			},
			async revokeFlow() {
				const confirmed = await new Promise(resolve => uni.showModal({ title: '撤销流程分享', content: '撤销后出院流程二维码将失效，患者报告二维码不受影响。确定撤销吗？', success: value => resolve(value.confirm), fail: () => resolve(false) }))
				if (!confirmed) return
				try {
					await revokeDischargeFlowShare(this.id)
					this.flowShare = null
					uni.showToast({ title: '已撤销流程分享', icon: 'none' })
				} catch (error) { uni.showToast({ title: error.message || '撤销失败', icon: 'none' }) }
			},
			async loadRecord() {
				if (this.loading) return
				this.loading = true
				this.error = ''
				try {
					const result = await getDischargeRecord(this.id)
					this.record = this.prepareRecord(result.record)
					const shareResult = await getDischargeRecordShare(this.id)
					this.share = shareResult.share || null
					await this.loadFlow()
				} catch (error) {
					this.error = error.message || '加载失败，请稍后重试'
				} finally {
					this.loading = false
				}
			},
			formatDate(value) {
				if (!value) return ''
				const date = new Date(value)
				if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 19)
				return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
			},
			copyShareUrl() {
				if (!this.share || !this.share.url) return
				uni.setClipboardData({ data: this.share.url, success: () => uni.showToast({ title: '链接已复制', icon: 'none' }) })
			},
			async revokeShare() {
				const result = await new Promise(resolve => uni.showModal({ title: '撤销分享', content: '撤销后二维码将无法继续查看，确定撤销吗？', success: value => resolve(value) }))
				if (!result.confirm) return
				try {
					await revokeDischargeRecordShare(this.id)
					this.share = null
					uni.showToast({ title: '已撤销分享', icon: 'none' })
				} catch (error) {
					uni.showToast({ title: error.message || '撤销失败', icon: 'none' })
				}
			},
			prepareRecord(record) {
				const form = record.form || {}
				return {
					...record,
					form: {
						...form,
						medicationTypesText: form.hasDischargeMedication === '有' ? (form.medicationTypes || []).join('、') : '无',
						tubeTypesText: form.hasTube === '有' ? (form.tubeTypes || []).join('、') : '无',
						skinTypesText: (form.skinTypes || []).join('、')
					}
				}
			}
		}
	}
</script>

<style>
	page { background: #f5f6f8; }
	.page { min-height: 100vh; padding: 24rpx; box-sizing: border-box; background: #f5f6f8; }
	.card { margin-bottom: 18rpx; padding: 24rpx; border-radius: 12rpx; background: #fff; box-shadow: 0 3rpx 10rpx rgba(34, 48, 65, 0.07); }
	.card-title { margin-bottom: 18rpx; color: #145ea8; font-size: 33rpx; font-weight: 600; line-height: 44rpx; }
	.field { display: flex; margin-top: 12rpx; color: #3f4d5c; font-size: 28rpx; line-height: 40rpx; }
	.state-text, .state-panel { padding: 100rpx 20rpx; color: #8a96a3; font-size: 29rpx; text-align: center; }
	.retry-button { display: block; width: 156rpx; height: 54rpx; margin: 22rpx auto 0; border-radius: 8rpx; background: #1677ed; color: #fff; font-size: 26rpx; line-height: 54rpx; }
	.retry-button::after { border: 0; }
	.share-card { text-align: center; }
	.share-qr { display: block; width: 420rpx; margin: 0 auto 12rpx; }
	.share-expiry { color: #8a96a3; font-size: 25rpx; line-height: 36rpx; }
	.share-button, .revoke-button { display: inline-block; margin: 18rpx 8rpx 0; padding: 0 20rpx; height: 54rpx; border-radius: 8rpx; font-size: 25rpx; line-height: 54rpx !important; }
	.share-button { background: #1677ed; color: #fff; }
	.revoke-button { background: #fff; color: #d64545; border: 1rpx solid #d64545; }
	.share-button::after, .revoke-button::after { border: 0; }
</style>
