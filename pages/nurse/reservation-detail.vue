<template>
	<view class="reservation-detail">
		<view class="page-header"><text class="page-title">预约详情</text></view>
		<view v-if="loading" class="state-text">正在加载预约信息...</view>
		<view v-else-if="error" class="state-text"><text>{{ error }}</text><button class="retry-button" size="mini" @tap="loadReservation">重新加载</button></view>
		<block v-else-if="reservation">
			<view class="detail-card">
				<view class="detail-row"><text class="label">姓名</text><text class="value">{{ reservation.name }}</text></view>
				<view class="detail-row"><text class="label">性别</text><text class="value">{{ reservation.gender }}</text></view>
				<view class="detail-row"><text class="label">年龄</text><text class="value">{{ reservation.age }}岁</text></view>
				<view class="detail-row"><text class="label">手机号</text><text class="value">{{ reservation.phone }}</text></view>
				<view class="detail-row"><text class="label">身份证号</text><text class="value">{{ reservation.idCard || '未填写' }}</text></view>
				<view v-if="reservation.repeatReservation === '是'" class="detail-row"><text class="label">预约类型</text><text class="value">再次预约</text></view>
				<view class="detail-row"><text class="label">预约医生</text><text class="value">{{ reservation.doctor || '未填写' }}</text></view>
				<view class="detail-row"><text class="label">管道</text><text class="value">{{ tubeSummary }}</text></view>
				<view class="detail-row"><text class="label">预约日期</text><text class="value">{{ reservation.reservationDate || '未填写' }}</text></view>
				<view class="detail-row"><text class="label">提交时间</text><text class="value">{{ formatReservationTime(reservation.createdAt) }}</text></view>
				<view class="detail-row"><text class="label">预约状态</text><text class="status" :class="{ 'status--success': reservation.status === '预约成功', 'status--cancelled': reservation.status === '取消预约' }">{{ reservation.status }}</text></view>
				<view v-if="reservation.status === '预约成功'" class="detail-row"><text class="label">平均约床时长</text><text class="value">{{ formatWaitingDays(reservation.waitingDays) }} 天</text></view>
				<view class="diagnosis"><text class="label">诊断及病情介绍</text><text class="diagnosis-text">{{ reservation.diagnosis }}</text></view>
				<view class="diagnosis"><text class="label">特殊需求</text><text class="diagnosis-text">{{ reservation.specialNeeds || '无' }}</text></view>
			</view>
			<button v-if="reservation.status === '预约中'" class="confirm-button" :loading="confirming" :disabled="confirming || cancelling" @tap="handleConfirm">{{ confirming ? '正在确认...' : '确认预约' }}</button>
			<button v-if="reservation.status !== '取消预约'" class="cancel-button" :loading="cancelling" :disabled="confirming || cancelling" @tap="handleCancel">{{ cancelling ? '正在取消...' : '取消预约' }}</button>
			<text v-if="reservation.status === '预约成功'" class="duration-note">约床时长按本次预约提交至确认的时间差计算，1天为24小时，保留两位小数。</text>
		</block>
	</view>
</template>

<script>
	import { getBedReservation, confirmBedReservation, cancelBedReservation } from '../../utils/api.js'
	import { formatReservationTime, formatWaitingDays } from '../../utils/reservation.js'

	export default {
		data() { return { id: '', reservation: null, loading: false, confirming: false, cancelling: false, error: '' } },
		computed: {
			tubeSummary() {
				if (!this.reservation) return '未填写'
				return (this.reservation.tubeTypes || []).map(type => type === '其他' ? '其他：' + this.reservation.otherTube : type).join('、') || '未填写'
			}
		},
		onLoad(query = {}) { this.id = query.id || ''; this.loadReservation() },
		methods: {
			formatReservationTime,
			formatWaitingDays,
			async loadReservation() {
				if (this.loading || this.confirming || this.cancelling) return
				if (!this.id) { this.error = '预约编号无效'; return }
				this.loading = true
				this.error = ''
				try { this.reservation = (await getBedReservation(this.id)).reservation }
				catch (error) { this.error = error.message || '加载失败，请稍后重试' }
				finally { this.loading = false }
			},
			async handleCancel() {
				if (this.loading || this.confirming || this.cancelling || !this.reservation || this.reservation.status === '取消预约') return
				this.cancelling = true
				try {
					const confirmed = await new Promise(resolve => uni.showModal({
						title: '取消预约', content: '确认取消该患者的预约？取消后保留记录，患者可以重新提交预约。',
						confirmText: '确认取消', success: result => resolve(Boolean(result.confirm)), fail: () => resolve(false)
					}))
					if (!confirmed) return
					this.reservation = (await cancelBedReservation(this.id)).reservation
					uni.showToast({ title: '预约已取消', icon: 'success' })
				} catch (error) { uni.showToast({ title: error.message || '取消失败，请重试', icon: 'none' }) }
				finally { this.cancelling = false }
			},
			async handleConfirm() {
				if (this.loading || this.confirming || this.cancelling || !this.reservation || this.reservation.status !== '预约中') return
				this.confirming = true
				try {
					const confirmed = await new Promise(resolve => uni.showModal({
						title: '确认预约', content: '确认已为该患者安排床位？确认后将记录确认时间，并将状态改为预约成功。',
						confirmText: '确认预约', success: result => resolve(Boolean(result.confirm)), fail: () => resolve(false)
					}))
					if (!confirmed) return
					this.reservation = (await confirmBedReservation(this.id)).reservation
					uni.showToast({ title: '预约已确认', icon: 'success' })
				} catch (error) { uni.showToast({ title: error.message || '确认失败，请重试', icon: 'none' }) }
				finally { this.confirming = false }
			}
		}
	}
</script>

<style scoped>
	.reservation-detail { min-height: 100vh; box-sizing: border-box; padding: 30rpx 24rpx; background: #f5f6f8; }
	.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24rpx; }
	.page-title { color: #253344; font-size: 36rpx; font-weight: 600; }
	.detail-card { padding: 10rpx 28rpx 28rpx; border-radius: 16rpx; background: #fff; box-shadow: 0 4rpx 14rpx rgba(38, 49, 65, .08); }
	.detail-row { display: flex; justify-content: space-between; align-items: center; padding: 24rpx 0; border-bottom: 1rpx solid #eee; gap: 20rpx; }
	.label { flex-shrink: 0; color: #718096; font-size: 28rpx; line-height: 42rpx; }
	.value { color: #344253; font-size: 29rpx; line-height: 42rpx; text-align: right; overflow-wrap: anywhere; }
	.status { color: #ba7b15; background: #fff6e5; padding: 6rpx 18rpx; border-radius: 8rpx; font-size: 27rpx; }
	.status--success { color: #208061; background: #eaf6ef; }
	.status--cancelled { color: #7b8492; background: #edf0f4; }
	.cancel-button { margin-top: 24rpx; border-radius: 44rpx; color: #d44949; background: #fff; font-size: 30rpx; }
	.cancel-button[disabled] { color: #a3acb8; }
	.diagnosis { padding-top: 24rpx; }
	.diagnosis-text { display: block; margin-top: 14rpx; color: #344253; font-size: 29rpx; line-height: 46rpx; white-space: pre-wrap; overflow-wrap: anywhere; }
	.confirm-button { margin-top: 32rpx; border-radius: 44rpx; background: #1677ed; color: #fff; font-size: 32rpx; }
	.confirm-button::after, .retry-button::after { border: 0; }
	.confirm-button[disabled] { background: #a9cdf8; color: #fff; }
	.duration-note { display: block; margin-top: 24rpx; color: #8a96a3; font-size: 24rpx; line-height: 38rpx; }
	.state-text { padding: 90rpx 20rpx; text-align: center; color: #8a96a3; font-size: 28rpx; }
	.retry-button { display: block; margin: 24rpx auto; color: #fff; background: #1677ed; }
</style>
