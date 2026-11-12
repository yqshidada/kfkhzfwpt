<template>
	<view class="reservation-page">
		<view class="page-header">
			<text class="page-title">预约床位</text>
		</view>
		<view class="booking-notice" role="note"><text>{{ bookingNotice }}</text></view>
		<block v-if="!submitted">
			<view class="form-card">
				<view class="card-title"><view class="title-mark"></view><text>预约信息</text></view>
				<view class="form-field">
					<view class="field-label"><text class="required">*</text>姓名</view>
					<input :disabled="submissionBusy" v-model.trim="form.name" class="field-input" maxlength="50" @input="clearFieldError('name')" placeholder="请输入姓名" placeholder-class="field-placeholder" />
					<text v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</text>
				</view>
				<view class="form-field">
					<view class="field-label"><text class="required">*</text>性别</view>
					<picker :disabled="submissionBusy" :range="genderOptions" :value="genderIndex" @change="handleGenderChange">
						<view class="field-control" :class="{ 'field-placeholder': !form.gender }">
							<text>{{ form.gender || '请选择性别' }}</text><view class="picker-arrow" aria-hidden="true"></view>
						</view>
					</picker>
					<text v-if="fieldErrors.gender" class="field-error">{{ fieldErrors.gender }}</text>
				</view>
				<view class="form-field">
					<view class="field-label"><text class="required">*</text>年龄</view>
					<view class="field-control">
						<input :disabled="submissionBusy" :value="form.age" class="field-input age-input" type="number" maxlength="3" placeholder="请输入年龄" placeholder-class="field-placeholder" @input="handleAgeInput" />
						<text class="field-unit">岁</text>
					</view>
					<text v-if="fieldErrors.age" class="field-error">{{ fieldErrors.age }}</text>
				</view>
				<view class="form-field">
					<view class="field-label"><text class="required">*</text>手机号</view>
					<input :disabled="submissionBusy" v-model.trim="form.phone" class="field-input" type="number" maxlength="11" @input="clearFieldError('phone')" placeholder="请输入11位手机号" placeholder-class="field-placeholder" />
					<text v-if="fieldErrors.phone" class="field-error">{{ fieldErrors.phone }}</text>
				</view>
				<view class="form-field">
					<view class="field-label"><text class="required">*</text>身份证号</view>
					<input :disabled="submissionBusy" :value="form.idCard" class="field-input" type="idcard" maxlength="18" placeholder="请输入18位身份证号，末位可为X" placeholder-class="field-placeholder" @input="handleIdCardInput" />
					<text v-if="fieldErrors.idCard" class="field-error">{{ fieldErrors.idCard }}</text>
				</view>
				<view class="form-field">
					<view class="field-label">预约医生（选填）</view>
					<picker :disabled="submissionBusy" :range="doctorOptions" :value="doctorIndex" @change="handleDoctorChange">
						<view class="field-control" :class="{ 'field-placeholder': !form.doctor }"><text>{{ form.doctor || '请选择预约医生' }}</text><view class="picker-arrow" aria-hidden="true"></view></view>
					</picker>
					<text v-if="form.doctor" class="clear-date" @tap="clearDoctor">清除选择</text>
					<text v-if="fieldErrors.doctor" class="field-error">{{ fieldErrors.doctor }}</text>
				</view>
				<view class="form-field">
					<view class="field-label">管道（选填，可多选）</view>
					<checkbox-group class="tube-options" @change="handleTubeChange">
						<label v-for="option in tubeOptions" :key="option" class="tube-option"><checkbox :value="option" :checked="form.tubeTypes.indexOf(option) !== -1" :disabled="submissionBusy" color="#1677ed" /><text>{{ option }}</text></label>
					</checkbox-group>
					<text v-if="fieldErrors.tubeTypes" class="field-error">{{ fieldErrors.tubeTypes }}</text>
				</view>
				<view v-if="form.tubeTypes.indexOf('其他') !== -1" class="form-field">
					<view class="field-label"><text class="required">*</text>其他管道</view>
					<input :disabled="submissionBusy" v-model.trim="form.otherTube" class="field-input" maxlength="100" @input="clearFieldError('otherTube')" placeholder="请填写其他管道名称" placeholder-class="field-placeholder" />
					<text v-if="fieldErrors.otherTube" class="field-error">{{ fieldErrors.otherTube }}</text>
				</view>
				<view class="form-field">
					<view class="field-label">预约日期（选填）</view>
					<picker mode="date" :disabled="submissionBusy" :value="form.reservationDate || minimumDate" :start="minimumDate" @change="handleDateChange">
						<view class="field-control" :class="{ 'field-placeholder': !form.reservationDate }">
							<text>{{ form.reservationDate || '请选择预约日期' }}</text><view class="picker-arrow" aria-hidden="true"></view>
						</view>
					</picker>
					<text v-if="form.reservationDate" class="clear-date" @tap="clearReservationDate">清除日期</text>
					<text class="field-note">可暂不选择日期；填写日期后才会在预约前一天提醒护士。</text>
					<text v-if="fieldErrors.reservationDate" class="field-error">{{ fieldErrors.reservationDate }}</text>
				</view>
				<view class="form-field">
					<view class="field-label"><text class="required">*</text>诊断及病情介绍</view>
					<textarea :disabled="submissionBusy" v-model.trim="form.diagnosis" class="diagnosis-input" maxlength="500" @input="clearFieldError('diagnosis')" placeholder="请输入诊断及病情介绍" placeholder-class="field-placeholder"></textarea>
					<text v-if="fieldErrors.diagnosis" class="field-error">{{ fieldErrors.diagnosis }}</text>
				</view>
				<view class="form-field">
					<view class="field-label">特殊需求（选填）</view>
					<textarea :disabled="submissionBusy" v-model.trim="form.specialNeeds" class="diagnosis-input" maxlength="500" @input="clearFieldError('specialNeeds')" placeholder="如有特殊需求，请在此填写" placeholder-class="field-placeholder"></textarea>
					<text v-if="fieldErrors.specialNeeds" class="field-error">{{ fieldErrors.specialNeeds }}</text>
				</view>
				<view class="form-field form-field--last">
					<view class="field-label"><text class="required">*</text>验证码</view>
					<reservation-captcha ref="captchaControl" v-model="captcha" :disabled="submissionBusy" @input="clearFieldError('captcha')" />
					<text v-if="fieldErrors.captcha" class="field-error">{{ fieldErrors.captcha }}</text>
				</view>
			</view>
			<text v-if="submissionError" class="submission-error">{{ submissionError }}</text>
			<button class="submit-button" :loading="submitting" :disabled="submissionBusy" @tap="handleSubmit">{{ confirming ? '请确认预约提醒' : (submitting ? '正在提交...' : '提交预约') }}</button>
			<text class="form-note">标有 * 的项目均为必填。提交后由工作人员确认，提交申请不代表已安排床位。</text>
		</block>
		<view v-else class="success-card">
			<text class="success-title">预约申请已提交</text>
			<text class="success-note">当前状态：预约中（仅排队登记）。请等待康复科电话通知入院。</text>
		</view>
	</view>
</template>

<script>
	import ReservationCaptcha from '../../components/reservation-captcha/index.vue'
	import { createBedReservation } from '../../utils/api.js'
	import { createReservationRequestId } from '../../utils/reservation.js'
	import { getReservationFieldErrors, normalizeIdCard, beijingDate, RESERVATION_DOCTORS, RESERVATION_TUBES, normalizeReservationCare } from '../../server/reservation-validation.js'

	export default {
		components: { ReservationCaptcha },
		data() {
			return {
				doctorOptions: RESERVATION_DOCTORS, tubeOptions: RESERVATION_TUBES,
				genderOptions: ['男', '女'], minimumDate: beijingDate(),
				bookingNotice: '⚠️预约仅排队登记，须等康复科电话通知入院，未通知请勿自行来院。',
				confirming: false, submitting: false, submitted: false, requestId: '', submittedPayload: '',
				fieldErrors: {}, submissionError: '', captcha: { id: '', code: '' },
				form: { name: '', gender: '', age: '', phone: '', idCard: '', diagnosis: '', reservationDate: '', specialNeeds: '', doctor: '', tubeTypes: [], otherTube: '' }
			}
		},
		onShow() { this.minimumDate = beijingDate() },
		computed: {
			submissionBusy() { return this.confirming || this.submitting },
			doctorIndex() { return Math.max(0, this.doctorOptions.indexOf(this.form.doctor)) },
			genderIndex() { return Math.max(0, this.genderOptions.indexOf(this.form.gender)) }
		},
		methods: {
			handleDoctorChange(event) {
				if (this.submissionBusy) return
				const index = Number(event.detail.value)
				if (!Number.isInteger(index) || !this.doctorOptions[index]) return
				this.clearFieldError('doctor'); this.form.doctor = this.doctorOptions[index]
			},
			clearDoctor() {
				if (this.submissionBusy) return
				this.clearFieldError('doctor'); this.form.doctor = ''
			},
			handleTubeChange(event) {
				if (this.submissionBusy || !Array.isArray(event.detail.value)) return
				this.clearFieldError('tubeTypes'); this.clearFieldError('otherTube')
				this.form.tubeTypes = this.tubeOptions.filter(value => event.detail.value.includes(value))
				if (!this.form.tubeTypes.includes('其他')) this.form.otherTube = ''
			},
			clearFieldError(key) {
				if (key !== 'captcha') this.submissionError = ''
				if (this.fieldErrors[key]) this.fieldErrors = { ...this.fieldErrors, [key]: '' }
			},
			validateSubmission(form) {
				this.fieldErrors = getReservationFieldErrors(form)
				if (!this.captcha.id || !/^[a-z0-9]{4}$/i.test(this.captcha.code.trim())) this.fieldErrors = { ...this.fieldErrors, captcha: '请输入4位数字字母验证码' }
				const errors = Object.values(this.fieldErrors)
				if (errors.length) uni.showToast({ title: errors[0], icon: 'none' })
				return !errors.length
			},
			async confirmBookingNotice() {
				this.confirming = true
				try {
					return await new Promise(resolve => uni.showModal({
						title: '提交前请确认', content: this.bookingNotice,
						confirmText: '已知晓，提交', cancelText: '返回检查',
						success: result => resolve(Boolean(result.confirm)), fail: () => resolve(false)
					}))
				} catch (error) { return false }
				finally { this.confirming = false }
			},
			async handleSubmit() {
				if (this.submissionBusy || this.submitted) return
				this.submissionError = ''
				const form = Object.fromEntries(Object.entries(this.form).map(([key, value]) => [key, Array.isArray(value) ? value.slice() : String(value).trim()]))
				form.idCard = normalizeIdCard(form.idCard)
				Object.assign(form, normalizeReservationCare(form))
				if (!this.validateSubmission(form)) return
				if (!await this.confirmBookingNotice()) return
				// The captcha or Beijing date may expire while the reminder is open.
				if (!this.validateSubmission(form)) return
				const payload = JSON.stringify(form)
				if (payload !== this.submittedPayload || !this.requestId) {
					this.requestId = createReservationRequestId()
					this.submittedPayload = payload
				}
				this.submitting = true
				try {
					await createBedReservation({ requestId: this.requestId, form, captcha: { ...this.captcha } })
					this.submitted = true
					// No patient contact/diagnosis is persisted in browser storage.
					this.form = { name: '', gender: '', age: '', phone: '', idCard: '', diagnosis: '', reservationDate: '', specialNeeds: '', doctor: '', tubeTypes: [], otherTube: '' }
					this.submittedPayload = ''
					this.captcha = { id: '', code: '' }
				} catch (error) {
					this.submissionError = error.message || '提交失败，请重试'
					uni.showToast({ title: error.message || '提交失败，请重试', icon: 'none' })
					this.submitting = false
					this.captcha = { id: '', code: '' }
					await this.$nextTick()
					if (this.$refs && this.$refs.captchaControl) await this.$refs.captchaControl.refresh()
				} finally { this.submitting = false }
			},
			clearReservationDate() {
				if (this.submissionBusy) return
				this.clearFieldError('reservationDate')
				this.form.reservationDate = ''
			},
			handleDateChange(event) {
				if (this.submissionBusy) return
				this.clearFieldError('reservationDate')
				this.minimumDate = beijingDate()
				this.form.reservationDate = event.detail.value
			},
			handleIdCardInput(event) {
				if (this.submissionBusy) return
				this.clearFieldError('idCard')
				this.form.idCard = normalizeIdCard(event.detail.value)
			},
			handleGenderChange(event) {
				if (this.submissionBusy) return
				this.clearFieldError('gender')
				this.form.gender = this.genderOptions[Number(event.detail.value)] || ''
			},
			handleAgeInput(event) {
				if (this.submissionBusy) return
				this.clearFieldError('age')
				this.form.age = String(event.detail.value || '').replace(/\D/g, '').slice(0, 3)
			}
		}
	}
</script>

<style scoped>
	@import "../../static/styles/picker-arrow.css";
	.reservation-page { box-sizing: border-box; min-height: 100vh; padding: 34rpx 30rpx; background: #f5f6f8; }
	.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24rpx; }
	.page-title { color: #253344; font-size: 38rpx; font-weight: 600; line-height: 52rpx; }
	.booking-notice { box-sizing: border-box; margin-bottom: 24rpx; padding: 24rpx; border: 1rpx solid #f0d69c; border-left: 8rpx solid #e7a124; border-radius: 12rpx; background: #fff8e8; color: #805413; font-size: 28rpx; font-weight: 600; line-height: 44rpx; overflow-wrap: break-word; }
	.form-card { box-sizing: border-box; padding: 25rpx 28rpx 28rpx; border-radius: 16rpx; background: #fff; box-shadow: 0 5rpx 14rpx rgba(38, 49, 65, 0.16); }
	.card-title { display: flex; align-items: center; height: 42rpx; margin-bottom: 16rpx; color: #1f2d3d; font-size: 34rpx; font-weight: 600; line-height: 42rpx; }
	.title-mark { width: 8rpx; height: 32rpx; margin-right: 12rpx; border-radius: 8rpx; background: #1677ed; }
	.form-field { box-sizing: border-box; min-height: 96rpx; padding: 20rpx 0; border-bottom: 1rpx solid #eee; }
	.form-field--last { border-bottom: 0; }
	.field-label { margin-bottom: 10rpx; color: #607080; font-size: 28rpx; line-height: 32rpx; }
	.field-input, .field-control { box-sizing: border-box; width: 100%; height: 42rpx; padding: 0; margin: 0; color: #4d5a68; font-size: 29rpx; line-height: 42rpx; }
	.field-control { display: flex; align-items: center; justify-content: space-between; }
	.field-placeholder { color: #c8cdd3; }
	.age-input { flex: 1; min-width: 0; }
	.field-unit { margin-left: 16rpx; color: #8a96a3; font-size: 28rpx; }
	.diagnosis-input { box-sizing: border-box; width: 100%; height: 160rpx; padding: 12rpx; border: 1rpx solid #e5e8ed; border-radius: 8rpx; color: #4d5a68; font-size: 29rpx; line-height: 42rpx; }
	.clear-date { display: inline-block; margin-top: 12rpx; color: #1677ed; font-size: 25rpx; line-height: 36rpx; }
	.field-note { display: block; margin-top: 10rpx; color: #8a96a3; font-size: 24rpx; line-height: 36rpx; }
	.form-note { display: block; margin-top: 24rpx; color: #8a96a3; font-size: 24rpx; line-height: 38rpx; }
	.submit-button { margin-top: 30rpx; border-radius: 44rpx; background: #1677ed; color: #fff; font-size: 32rpx; }
	.submit-button::after { border: 0; }
	.submit-button[disabled] { background: #a9cdf8; color: #fff; }
	.success-card { padding: 48rpx 28rpx; border-radius: 16rpx; background: #fff; text-align: center; }
	.success-title { display: block; color: #208061; font-size: 36rpx; font-weight: 600; }
	.success-note { display: block; margin-top: 24rpx; color: #607080; font-size: 28rpx; line-height: 44rpx; }
	.required { margin-right: 6rpx; color: #ef4c49; }
	.submission-error { display: block; margin-top: 24rpx; color: #ef4c49; font-size: 26rpx; line-height: 38rpx; }
	.field-error { display: block; margin-top: 10rpx; color: #ef4c49; font-size: 24rpx; line-height: 36rpx; }
	.tube-options { display: flex; flex-wrap: wrap; gap: 20rpx 12rpx; padding-top: 8rpx; }
	.tube-option { display: flex; align-items: center; box-sizing: border-box; width: calc(50% - 6rpx); min-height: 48rpx; color: #4d5a68; font-size: 28rpx; line-height: 40rpx; }
	.tube-option checkbox { flex-shrink: 0; margin-right: 8rpx; transform: scale(.85); transform-origin: left center; }
</style>
