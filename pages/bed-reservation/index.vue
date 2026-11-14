<template>
	<view class="reservation-page">
		<view class="page-header">
			<text class="page-title">预约床位</text>
		</view>
		<view class="booking-notice" role="note"><text>{{ bookingNotice }}</text></view>
		<block v-if="!submitted">
			<view class="lookup-card">
				<view class="lookup-heading" @tap="toggleLookup"><text>预约查询 / 再次预约</text><text class="lookup-toggle">{{ lookupOpen ? '收起' : '展开查询' }}</text></view>
				<view v-if="lookupOpen">
					<text class="lookup-hint">填写原预约手机号和身份证号，查询最近10条预约。身份信息须与原预约一致。</text>
					<input :value="lookupPhone" class="lookup-input" type="number" maxlength="11" placeholder="请输入原预约手机号" :disabled="submissionBusy" @input="changeLookup('phone', $event)" />
					<input :value="lookupIdCard" class="lookup-input" type="idcard" maxlength="18" placeholder="请输入身份证号" :disabled="submissionBusy" @input="changeLookup('idCard', $event)" />
					<reservation-captcha ref="lookupCaptchaControl" v-model="lookupCaptcha" :disabled="submissionBusy" />
					<button class="lookup-search" :loading="lookupBusy" :disabled="submissionBusy" @tap="searchPreviousReservations">查询预约</button>
					<text v-if="lookupError" class="lookup-error">{{ lookupError }}</text>
					<text v-if="lookupSearched && !lookupResults.length && !lookupError" class="lookup-hint">未找到匹配的预约，请核对原预约信息，或在下方填写新预约。</text>
					<text v-if="lookupPending" class="lookup-warning">您已有预约中的记录，请等待康复科电话通知，不能重复预约。</text>
					<view v-for="record in lookupResults" :key="record.id" class="lookup-result">
						<view class="lookup-result-heading"><text>{{ record.name }}</text><text>{{ record.status }}</text></view>
						<text class="lookup-hint">提交时间：{{ formatReservationTime(record.createdAt) }}</text>
						<text class="lookup-hint">预约日期：{{ record.reservationDate || '未填写' }}</text>
						<button size="mini" class="lookup-rebook" :disabled="submissionBusy || !record.canRebook" @tap="usePreviousReservation(record)">{{ record.canRebook ? '再次预约' : '预约中，暂不可再次预约' }}</button>
					</view>
				</view>
			</view>
			<view v-if="rebooking" class="rebooking-hint"><text>已带入原预约信息，请核对年龄、医生及病情等内容，选择新的预约日期（选填），输入下方验证码后提交。</text><text class="lookup-toggle" @tap="cancelPublicRebook">清空，填写新预约</text></view>
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
	import { createBedReservation, lookupBedReservations } from '../../utils/api.js'
	import { createReservationRequestId, formatReservationTime } from '../../utils/reservation.js'
	import { getReservationFieldErrors, normalizeIdCard, beijingDate, RESERVATION_DOCTORS, RESERVATION_TUBES, normalizeReservationCare, isValidMobile, isValidIdCard } from '../../server/reservation-validation.js'

	export default {
		components: { ReservationCaptcha },
		data() {
			return {
				doctorOptions: RESERVATION_DOCTORS, tubeOptions: RESERVATION_TUBES,
				genderOptions: ['男', '女'], minimumDate: beijingDate(),
				bookingNotice: '⚠️预约仅排队登记，须等康复科电话通知入院，未通知请勿自行来院。',
				confirming: false, submitting: false, submitted: false, requestId: '', submittedPayload: '',
				lookupOpen: false, lookupPhone: '', lookupIdCard: '', lookupCaptcha: { id: '', code: '' },
				lookupResults: [], lookupPending: false, lookupSearched: false, lookupError: '', lookupBusy: false, lookupVersion: 0, rebooking: false,
				fieldErrors: {}, submissionError: '', captcha: { id: '', code: '' },
				form: { name: '', gender: '', age: '', phone: '', idCard: '', diagnosis: '', reservationDate: '', specialNeeds: '', doctor: '', tubeTypes: [], otherTube: '' }
			}
		},
		onShow() { this.minimumDate = beijingDate() },
		computed: {
			submissionBusy() { return this.confirming || this.submitting || this.lookupBusy },
			doctorIndex() { return Math.max(0, this.doctorOptions.indexOf(this.form.doctor)) },
			genderIndex() { return Math.max(0, this.genderOptions.indexOf(this.form.gender)) }
		},
		methods: {
			formatReservationTime,
			toggleLookup() { if (!this.submissionBusy) this.lookupOpen = !this.lookupOpen },
			changeLookup(key, event) {
				if (this.submissionBusy) return
				if (key === 'phone') this.lookupPhone = String(event.detail.value || '').replace(/\D/g, '').slice(0, 11)
				else this.lookupIdCard = String(event.detail.value || '').replace(/[^0-9x]/gi, '').toUpperCase().slice(0, 18)
				this.lookupVersion++; this.lookupResults = []; this.lookupPending = false; this.lookupSearched = false; this.lookupError = ''
			},
			async searchPreviousReservations() {
				if (this.submissionBusy) return
				const phone = this.lookupPhone.trim(), idCard = normalizeIdCard(this.lookupIdCard)
				if (!isValidMobile(phone) || !isValidIdCard(idCard)) { this.lookupError = '请输入正确的预约手机号和身份证号'; return }
				if (!this.lookupCaptcha.id || !/^[a-z0-9]{4}$/i.test(this.lookupCaptcha.code.trim())) { this.lookupError = '请输入查询图片中的4位验证码'; return }
				const version = ++this.lookupVersion
				this.lookupBusy = true; this.lookupError = ''; this.lookupResults = []; this.lookupPending = false; this.lookupSearched = false
				try {
					const result = await lookupBedReservations({ phone, idCard, captcha: { ...this.lookupCaptcha } })
					if (version !== this.lookupVersion) return
					this.lookupResults = result.items; this.lookupPending = result.pending; this.lookupSearched = true
				} catch (error) { if (version === this.lookupVersion) this.lookupError = error.message || '查询失败，请重试' }
				finally {
					if (version === this.lookupVersion) {
						this.lookupBusy = false; this.lookupCaptcha = { id: '', code: '' }
						await this.$nextTick()
						if (this.$refs && this.$refs.lookupCaptchaControl) await this.$refs.lookupCaptchaControl.refresh()
					}
				}
			},
			async usePreviousReservation(record) {
				if (this.submissionBusy || this.lookupPending || !record.canRebook || !this.lookupResults.includes(record)) return
				this.form = { ...record.form, tubeTypes: record.form.tubeTypes.slice(), reservationDate: '' }
				this.rebooking = true; this.lookupOpen = false; this.fieldErrors = {}; this.submissionError = ''; this.requestId = ''; this.submittedPayload = ''; this.captcha = { id: '', code: '' }
				await this.$nextTick()
				if (this.$refs && this.$refs.captchaControl) await this.$refs.captchaControl.refresh()
				uni.showToast({ title: '已带入信息，请核对后提交', icon: 'none' })
			},
			async cancelPublicRebook() {
				if (this.submissionBusy) return
				this.rebooking = false; this.requestId = ''; this.submittedPayload = ''; this.fieldErrors = {}; this.submissionError = ''
				this.form = { name: '', gender: '', age: '', phone: '', idCard: '', diagnosis: '', reservationDate: '', specialNeeds: '', doctor: '', tubeTypes: [], otherTube: '' }
				this.captcha = { id: '', code: '' }
				await this.$nextTick()
				if (this.$refs && this.$refs.captchaControl) await this.$refs.captchaControl.refresh()
			},
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
				if (this.rebooking) form.repeatReservation = '是'
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
					this.lookupVersion++; this.lookupResults = []; this.lookupPhone = ''; this.lookupIdCard = ''; this.lookupCaptcha = { id: '', code: '' }; this.lookupOpen = false; this.rebooking = false
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
	.lookup-card { padding: 24rpx; margin-bottom: 24rpx; border: 1rpx solid #d7e6fa; border-radius: 14rpx; background: #fff; }
	.lookup-heading, .lookup-result-heading { display: flex; align-items: center; justify-content: space-between; gap: 14rpx; color: #344253; font-size: 29rpx; font-weight: 600; }
	.lookup-toggle { flex-shrink: 0; color: #1677ed; font-size: 25rpx; font-weight: 400; }
	.lookup-hint { display: block; margin-top: 14rpx; color: #788797; font-size: 25rpx; line-height: 38rpx; }
	.lookup-input { box-sizing: border-box; width: 100%; height: 80rpx; padding: 0 18rpx; margin: 18rpx 0; border: 1rpx solid #dfe5ed; border-radius: 8rpx; font-size: 28rpx; }
	.lookup-search { margin-top: 18rpx; color: #fff; background: #1677ed; border-radius: 10rpx; font-size: 28rpx; }
	.lookup-error, .lookup-warning { display: block; margin-top: 16rpx; color: #c76520; font-size: 25rpx; line-height: 38rpx; }
	.lookup-result { margin-top: 22rpx; padding-top: 20rpx; border-top: 1rpx solid #e8edf3; }
	.lookup-rebook { margin-top: 18rpx; color: #1677ed; background: #edf5ff; }
	.rebooking-hint { padding: 22rpx; margin-bottom: 24rpx; border-radius: 10rpx; background: #edf5ff; color: #526273; font-size: 26rpx; line-height: 40rpx; }
	.rebooking-hint .lookup-toggle { display: block; margin-top: 10rpx; }
</style>
