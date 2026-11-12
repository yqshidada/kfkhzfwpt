<template>
	<view class="page">
		<view class="form-card">
			<view class="card-title">
				<view class="title-mark"></view>
				<text>患者信息</text>
			</view>

			<view class="form-field">
				<view class="field-label"><text class="required">*</text>住院号</view>
				<input v-model.trim="form.hospitalizationNumber" class="field-input" maxlength="20" placeholder="请输入住院号" placeholder-class="field-placeholder" />
			</view>

			<view class="form-field">
				<view class="field-label"><text class="required">*</text>性别</view>
				<picker :range="genderOptions" @change="handleGenderChange">
					<view class="field-control" :class="{ 'field-placeholder': !form.gender }">
						<text>{{ form.gender || '请选择性别' }}</text>
						<view class="picker-arrow" aria-hidden="true"></view>
					</view>
				</picker>
			</view>

			<view class="form-field">
				<view class="field-label"><text class="required">*</text>年龄</view>
				<picker :range="ageOptions" :value="ageIndex" @change="handleAgeChange">
					<view class="field-control" :class="{ 'field-placeholder': !form.age }">
						<text>{{ form.age || '请选择年龄' }}</text>
						<view class="picker-arrow" aria-hidden="true"></view>
					</view>
				</picker>
			</view>

			<view class="form-field">
				<view class="field-label"><text class="required">*</text>联系电话</view>
				<input v-model.trim="form.phone" class="field-input" type="number" maxlength="11" @input="handlePhoneInput" placeholder="请输入联系电话" placeholder-class="field-placeholder" />
			</view>

			<view class="form-field">
				<view class="field-label"><text class="required">*</text>诊断</view>
				<picker :range="diagnosisOptions" @change="handleDiagnosisChange">
					<view class="field-control" :class="{ 'field-placeholder': !form.diagnosis }">
						<text>{{ form.diagnosis || '请选择诊断' }}</text>
						<view class="picker-arrow" aria-hidden="true"></view>
					</view>
				</picker>
			</view>

			<view class="form-field">
				<view class="field-label"><text class="required">*</text>出院带药</view>
				<radio-group class="option-row" @change="handleDischargeMedicationChange">
					<label v-for="option in yesNoOptions" :key="option" class="radio-option">
						<radio :value="option" :checked="form.hasDischargeMedication === option" color="#1677ed" />
						<text>{{ option }}</text>
					</label>
				</radio-group>
				<view v-if="form.hasDischargeMedication === '有'" class="medication-types">
					<view class="field-label"><text class="required">*</text>药物类型</view>
					<checkbox-group class="option-row option-row--wrap" @change="handleMedicationTypeChange">
						<label v-for="option in medicationOptions" :key="option" class="checkbox-option">
							<checkbox :value="option" :checked="form.medicationTypes.indexOf(option) !== -1" color="#1677ed" />
							<text>{{ option }}</text>
						</label>
					</checkbox-group>
				</view>
			</view>

			<view class="form-field">
				<view class="field-label"><text class="required">*</text>有无管道</view>
				<radio-group class="option-row" @change="handleTubeChange">
					<label v-for="option in yesNoOptions" :key="option" class="radio-option">
						<radio :value="option" :checked="form.hasTube === option" color="#1677ed" />
						<text>{{ option }}</text>
					</label>
				</radio-group>
				<view v-if="form.hasTube === '有'" class="tube-types">
					<view class="field-label">管道类型（选填）</view>
					<checkbox-group :key="'tube-types-' + form.hasTube" class="option-row option-row--wrap" @change="handleTubeTypeChange">
						<label v-for="option in tubeTypeOptions" :key="option" class="checkbox-option">
							<checkbox :value="option" :checked="form.tubeTypes.indexOf(option) !== -1" color="#1677ed" />
							<text>{{ option }}</text>
						</label>
					</checkbox-group>
				</view>
			</view>

			<view class="form-field">
				<view class="field-label">皮肤情况（选填）</view>
				<checkbox-group class="option-row option-row--wrap" @change="handleSkinTypeChange">
					<label v-for="option in skinCareOptions" :key="option" class="checkbox-option">
						<checkbox :value="option" :checked="form.skinTypes.indexOf(option) !== -1" color="#1677ed" />
						<text>{{ option }}</text>
					</label>
				</checkbox-group>
			</view>
		</view>

		<button class="submit-button" :loading="submitting" @tap="handleSubmit">生成出院报告</button>
		<view v-if="share" class="share-card">
			<view class="share-title">报告分享二维码</view>
			<image class="share-qr" :src="share.qrDataUrl" mode="widthFix" />
			<view class="share-expiry">扫码查看报告图片，链接有效期至 {{ formatShareExpiry(share.expiresAt) }}</view>
			<button class="share-copy" size="mini" @tap="copyShareUrl">复制分享链接</button>
		</view>
	</view>
</template>

<script>
	import { medicationCareGuides, medicationOptions, medicationReferenceNotice, medicationReminder } from './medication-care.js'
	import { caseCopyQrImage } from './case-copy-qr.js'
	import { medicalCopyApplicationQrImage } from './medical-copy-application-qr.js'
	import { documentDisclaimer, followUpNotice, medicalRecordCopyNoticeAfterQr, medicalRecordCopyNoticeBeforeQr } from './discharge-notices.js'
	import { generateDischargeReportPdf } from './report-pdf.js'
	import { savePdfToDevice } from '../../utils/save-pdf.js'
	import { skinCareGuides, skinCareOptions, skinCareReferenceNotice, skinCareReminder, woundCareReminder } from './skin-care.js'
	import { tubeCareGuides, tubeReferenceNotice, tubeReminder, tubeTypeOptions } from './tube-care.js'
	import { createDischargeRecord, shareDischargeRecord } from '../../utils/api.js'

	function createRequestId() {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
			const random = Math.floor(Math.random() * 16)
			return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16)
		})
	}

	export default {
		data() {
			return {
				submitting: false,
				confirming: false,
				share: null,
				recordRequestId: createRequestId(),
				genderOptions: ['男', '女'],
				ageOptions: ['20-30岁', '30-40岁', '40-50岁', '50-60岁', '60-70岁', '70-80岁', '80-90岁'],
				diagnosisOptions: ['中风', '腰椎间盘突出', '颈椎病', '骨质疏松', '类风湿关节炎','骨折', '脊髓损伤', '肩痹', '膝痹', '其他'],
				yesNoOptions: ['有', '无'],
				medicationOptions,
				medicationCareGuides,
				medicationReminder,
				medicationReferenceNotice,
				tubeTypeOptions,
				tubeCareGuides,
				tubeReminder,
				tubeReferenceNotice,
				skinCareOptions,
				skinCareGuides,
				skinCareReminder,
				woundCareReminder,
				skinCareReferenceNotice,
				followUpNotice,
				medicalRecordCopyNoticeBeforeQr,
				medicalRecordCopyNoticeAfterQr,
				documentDisclaimer,
				ageIndex: 4,
				form: {
					hospitalizationNumber: 'TEST20261012', gender: '男', age: '60-70岁', phone: '13800138000', diagnosis: '中风',
					hasDischargeMedication: '有', medicationTypes: ['降压药', '降糖药'], hasTube: '有', tubeTypes: ['PICC管', 'CVC管'],
					skinTypes: ['皮肤护理', '营养支持']
				}
			}
		},
		computed: {
			selectedMedicationGuides() {
				return this.form.medicationTypes.map(type => this.medicationCareGuides[type])
			},
			selectedTubeGuides() {
				return this.form.tubeTypes.map(type => this.tubeCareGuides[type])
			},
			selectedSkinCareGuides() {
				return this.form.skinTypes.map(type => this.skinCareGuides[type])
			}
		},
		methods: {
			formatShareExpiry(value) {
				if (!value) return ''
				const date = new Date(value)
				return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
			},
			copyShareUrl() {
				if (!this.share || !this.share.url) return
				uni.setClipboardData({ data: this.share.url, success: () => uni.showToast({ title: '链接已复制', icon: 'none' }) })
			},
			handlePhoneInput(event) {
				this.form.phone = String(event.detail.value || '').replace(/\D/g, '').slice(0, 11)
			},
			handleSkinTypeChange(event) {
				this.form.skinTypes = event.detail.value
			},
			handleDiagnosisChange(event) {
				this.form.diagnosis = this.diagnosisOptions[event.detail.value]
			},
			handleDischargeMedicationChange(event) {
				this.form.hasDischargeMedication = event.detail.value
				if (this.form.hasDischargeMedication !== '有') this.form.medicationTypes = []
			},
			handleMedicationTypeChange(event) {
				this.form.medicationTypes = event.detail.value
			},
			handleTubeChange(event) {
				this.form.hasTube = event.detail.value
				this.form.tubeTypes = []
			},
			handleTubeTypeChange(event) {
				this.form.tubeTypes = event.detail.value
			},
			handleAgeChange(event) {
				this.ageIndex = Number(event.detail.value)
				this.form.age = this.ageOptions[this.ageIndex]
			},
			handleGenderChange(event) {
				this.form.gender = this.genderOptions[event.detail.value]
			},
			buildReportSections() {
				const form = this.form
				const sections = [
					{
						title: '患者信息',
						items: [
							`住院号：${form.hospitalizationNumber}`,
							`性别：${form.gender}`,
							`年龄：${form.age}`
						]
					},
					{
						title: '诊断',
						items: [`诊断结果：${form.diagnosis}`]
					},
					{
						title: '出院带药',
						items: [
							`是否带药：${form.hasDischargeMedication}`,
							`药物类型：${form.hasDischargeMedication === '有' ? form.medicationTypes.join('、') : '无'}`
						]
					},
					{
						title: '管道信息',
						items: [
							`有无管道：${form.hasTube}`,
							`管道类型：${form.hasTube === '有' ? (form.tubeTypes.join('、') || '未填写') : '无'}`
						]
					},
					{
						title: '皮肤情况',
						items: [
							`皮肤情况：${form.skinTypes.join('、') || '未填写'}`
						]
					}
				]

				if (form.hasDischargeMedication === '有') {
					const medicationSection = sections[2]
					medicationSection.items.push({ title: '注意事项', content: '', group: true, color: 'red' })
					this.selectedMedicationGuides.forEach(guide => {
						medicationSection.items.push({ title: guide.title, content: guide.content, indent: 3 })
					})
					if (this.selectedMedicationGuides.length) {
						medicationSection.items.push({ title: '总提醒', content: this.medicationReminder, indent: 3 })
						medicationSection.items.push({ body: true, content: this.medicationReferenceNotice, bold: true, indent: 3, marginTop: 10 })
					}
				}

				if (form.hasTube === '有' && this.selectedTubeGuides.length) {
					const tubeSection = sections[3]
					tubeSection.items.push({ title: '注意事项', content: '', group: true, color: 'red' })
					this.selectedTubeGuides.forEach(guide => {
						tubeSection.items.push({ title: guide.title, content: guide.content, indent: 3 })
					})
					if (this.selectedTubeGuides.length) {
						tubeSection.items.push({ title: '总提醒', content: this.tubeReminder, indent: 3 })
						tubeSection.items.push({ body: true, content: this.tubeReferenceNotice, bold: true, indent: 3, marginTop: 10 })
					}
				}

				if (form.skinTypes.length) {
					const skinSection = sections[4]
					const hasPressureCare = form.skinTypes.some(type => type !== '其他伤口的居家宣教')
					skinSection.items.push({ title: '注意事项', content: '', group: true, color: 'red' })
					this.selectedSkinCareGuides.forEach(guide => {
						skinSection.items.push({ title: guide.title, content: guide.content, indent: 3 })
					})
					if (hasPressureCare) {
						skinSection.items.push({ title: '总提醒', content: this.skinCareReminder, indent: 3 })
						skinSection.items.push({ body: true, content: this.skinCareReferenceNotice, bold: true, indent: 3, marginTop: 10 })
					}
					if (form.skinTypes.indexOf('其他伤口的居家宣教') !== -1) {
						skinSection.items.push({ title: '伤口护理总提醒', content: this.woundCareReminder, indent: 3 })
					}
				}

				sections.push({ title: '复诊须知', items: [{ body: true, content: this.followUpNotice }] })
				sections.push({ items: [{ image: caseCopyQrImage, imageKey: 'CaseCopyQr', width: 150, marginBottom: 22, keepWithNext: true }], spacingAfter: false })
				sections.push({
					title: '病例复印',
					items: [
						{ body: true, content: this.medicalRecordCopyNoticeBeforeQr },
						{ image: medicalCopyApplicationQrImage, imageKey: 'MedicalCopyApplicationQr', width: 150, marginTop: 10, marginBottom: 22, keepWithNext: true },
						{ body: true, content: this.medicalRecordCopyNoticeAfterQr },
						{ body: true, content: this.documentDisclaimer, bold: true, marginTop: 10 }
					]
				})

				return sections
			},
			buildRecordSnapshot(sections) {
				return sections.map(section => ({
					title: section.title || '',
					items: (section.items || []).filter(item => !(item && typeof item === 'object' && item.image)).map(item => {
						if (typeof item === 'string') return item
						return {
							title: item.title || '',
							content: item.content || '',
							body: Boolean(item.body),
							group: Boolean(item.group),
							color: item.color || '',
							bold: Boolean(item.bold)
						}
					})
				})).filter(section => section.title || section.items.length)
			},
			getReportFileName() {
				const safeNumber = this.form.hospitalizationNumber.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
				const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '')
				return `出院报告_${safeNumber}_${timestamp}.pdf`
			},
			savePdfToDevice,
			async handleSubmit() {
				if (this.submitting || this.confirming) return
				const { hospitalizationNumber, gender, age, phone, diagnosis, hasDischargeMedication, medicationTypes, hasTube } = this.form
				if (!hospitalizationNumber) return this.showError('请输入住院号')
				if (!gender) return this.showError('请选择性别')
				if (this.ageOptions.indexOf(age) === -1) return this.showError('请选择年龄')
				if (!/^1[3-9]\d{9}$/.test(String(phone))) return this.showError('请输入正确的联系电话')
				if (!diagnosis) return this.showError('请选择诊断')
				if (!hasDischargeMedication) return this.showError('请选择是否出院带药')
				if (hasDischargeMedication === '有' && !medicationTypes.length) return this.showError('请选择药物类型')
				if (!hasTube) return this.showError('请选择有无管道')

				this.confirming = true
				const confirmed = await this.confirmReportGeneration()
				this.confirming = false
				if (!confirmed) return
				this.submitting = true
				try {
					const sections = this.buildReportSections()
					const pdf = generateDischargeReportPdf(sections)
					const result = await createDischargeRecord({
						requestId: this.recordRequestId,
						form: { ...this.form },
						reportSnapshot: this.buildRecordSnapshot(sections)
					})
					if (!result || !result.record || !result.record.id) throw new Error('记录保存成功但缺少记录编号，请重试')
					const shareResult = await shareDischargeRecord(result.record.id, { pdfBase64: pdf, fileName: this.getReportFileName() })
					this.share = shareResult.share || null
					this.recordRequestId = createRequestId()
					try {
						await this.savePdfToDevice(pdf, this.getReportFileName())
						uni.showToast({ title: '报告已生成，可扫码查看', icon: 'none' })
					} catch (error) {
						uni.showToast({ title: '报告已保存，可在患者详情扫码查看和下载', icon: 'none' })
					}
					uni.redirectTo({ url: `/pages/nurse/detail?id=${result.record.id}` })
				} catch (error) {
					this.showError((error && error.message) || '生成报告失败，请重试')
				} finally {
					this.submitting = false
				}
			},
			confirmReportGeneration() {
				return new Promise(resolve => {
					uni.showModal({
						title: '确认生成报告',
						content: '请确认填写内容无误。生成后将保存记录，且同一住院号不能重复生成报告。',
						confirmText: '确认生成',
						cancelText: '返回修改',
						success: result => resolve(Boolean(result.confirm)),
						fail: () => resolve(false)
					})
				})
			},
			showError(title) {
				uni.showToast({ title, icon: 'none' })
			}
		}
	}
</script>

<style>
	@import "../../static/styles/picker-arrow.css";
	page { background: #f5f6f8; }

	.page {
		box-sizing: border-box;
		min-height: 100vh;
		padding: 34rpx 30rpx 34rpx;
		background: #f5f6f8;
	}

	.form-card {
		box-sizing: border-box;
		padding: 25rpx 28rpx 28rpx;
		border-radius: 16rpx;
		background: #ffffff;
		box-shadow: 0 5rpx 14rpx rgba(38, 49, 65, 0.16);
	}

	.card-title {
		display: flex;
		align-items: center;
		height: 42rpx;
		margin-bottom: 16rpx;
		color: #1f2d3d;
		font-size: 34rpx;
		font-weight: 600;
		line-height: 42rpx;
	}

	.title-mark {
		width: 8rpx;
		height: 32rpx;
		margin-right: 12rpx;
		border-radius: 8rpx;
		background: #1677ed;
	}

	.form-field {
		box-sizing: border-box;
		min-height: 96rpx;
		padding: 20rpx 0;
		border-bottom: 1rpx solid #eeeeee;
	}

	.form-field--last { border-bottom: 0; }

	.field-label {
		margin-bottom: 10rpx;
		color: #607080;
		font-size: 28rpx;
		line-height: 32rpx;
	}

	.required { margin-right: 2rpx; color: #ef4c49; }

	.field-input,
	.field-control {
		box-sizing: border-box;
		width: 100%;
		height: 42rpx;
		padding: 0;
		margin: 0;
		color: #4d5a68;
		font-size: 29rpx;
		line-height: 42rpx;
	}

	.field-placeholder { color: #c8cdd3; }

	.field-control {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.field-control--readonly {
		color: #4d5a68;
	}

	.option-row {
		display: flex;
		align-items: center;
		min-height: 42rpx;
	}

	.option-row--wrap {
		flex-wrap: wrap;
		margin: 0 -16rpx -10rpx 0;
	}

	.radio-option,
	.checkbox-option {
		display: flex;
		align-items: center;
		margin-right: 42rpx;
		color: #4d5a68;
		font-size: 29rpx;
		line-height: 42rpx;
	}

	.checkbox-option {
		margin-right: 24rpx;
		margin-bottom: 10rpx;
	}

	.radio-option radio,
	.checkbox-option checkbox {
		transform: scale(0.78);
		margin-right: 4rpx;
	}

	.detail-textarea {
		box-sizing: border-box;
		width: 100%;
		height: 132rpx;
		margin-top: 18rpx;
		padding: 12rpx;
		border: 1rpx solid #e5e8ed;
		border-radius: 8rpx;
		color: #4d5a68;
		font-size: 29rpx;
		line-height: 36rpx;
	}

	.tube-types {
		margin-top: 18rpx;
		padding-top: 16rpx;
	}

	.medication-types {
		margin-top: 18rpx;
		padding-top: 16rpx;
	}

	.skin-details {
		margin-top: 18rpx;
		padding-top: 16rpx;
	}

	.detail-label {
		margin-top: 20rpx;
	}


	.submit-button {
		box-sizing: border-box;
		width: 100%;
		height: 68rpx;
		margin: 24rpx 0 0;
		padding: 0;
		border: 0;
		border-radius: 36rpx;
		background: #1478ed;
		color: #ffffff;
		font-size: 32rpx;
		font-weight: 500;
		line-height: 68rpx;
	}

	.submit-button::after { border: 0; }
	.submit-button:active { background: #0b68d6; }

	.share-card { margin: 24rpx 0 10rpx; padding: 28rpx 24rpx; border-radius: 16rpx; background: #fff; text-align: center; box-shadow: 0 4rpx 16rpx rgba(26, 54, 86, 0.08); }
	.share-title { color: #1f2d3d; font-size: 32rpx; font-weight: 600; line-height: 46rpx; }
	.share-qr { display: block; width: 420rpx; height: 420rpx; margin: 18rpx auto 12rpx; }
	.share-expiry { color: #718096; font-size: 25rpx; line-height: 38rpx; }
	.share-copy { width: 240rpx; height: 58rpx; margin: 18rpx auto 0; border: 1px solid #1677ed; border-radius: 8rpx; background: #fff; color: #1677ed; font-size: 26rpx; line-height: 56rpx; }
	.share-copy::after { border: 0; }
</style>
