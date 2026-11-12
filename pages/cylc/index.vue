<template>
  <view class="page">
    <view v-if="loading" class="state-panel">正在加载患者信息...</view>
    <view v-else-if="error" class="state-panel">
      <text>{{ error }}</text>
      <button class="secondary-button" @tap="loadPatient">重新加载</button>
    </view>
    <view v-else-if="!record" class="state-panel">
      <text>请先选择患者，再填写出院流程。</text>
      <button class="primary-button" @tap="choosePatient">选择患者</button>
    </view>
    <block v-else>
      <view class="patient-card">
        <view class="patient-number">住院号：{{ record.form.hospitalizationNumber }}</view>
        <view class="patient-meta">{{ record.form.gender }} · {{ record.form.age }}</view>
      </view>

      <view class="step-card">
        <view class="step-heading"><text class="step-number">1</text><text>步骤一</text></view>
        <view class="field-label"><text class="required">*</text>结算方式</view>
        <view v-if="showSettlementReminder" class="field-hint">{{ settlementReminder }}</view>
        <radio-group @change="setChoice('settlementMethod', $event)">
          <label v-for="option in settlementOptions" :key="option" class="choice" :class="{ 'choice--selected': form.settlementMethod === option }">
            <radio :value="option" :checked="form.settlementMethod === option" :disabled="busy" color="#1677ed" />
            <text>{{ option }}</text>
          </label>
        </radio-group>
      </view>

      <view class="step-card">
        <view class="step-heading"><text class="step-number">2</text><text>步骤二</text></view>
        <view class="field-label"><text class="required">*</text>出院西药带药</view>
        <view class="field-hint">（{{ invoiceReminder }}）</view>
        <radio-group class="choices-inline" @change="setChoice('westernMedicine', $event)">
          <label v-for="option in medicineOptions" :key="option" class="choice" :class="{ 'choice--selected': form.westernMedicine === option }">
            <radio :value="option" :checked="form.westernMedicine === option" :disabled="busy" color="#1677ed" />
            <text>{{ option }}</text>
          </label>
        </radio-group>
      </view>

      <view class="step-card">
        <view class="step-heading"><text class="step-number">3</text><text>步骤三</text></view>
        <view class="field-label"><text class="required">*</text>出院中药带药</view>
        <view class="field-hint">（{{ invoiceReminder }}）</view>
        <radio-group class="choices-inline" @change="setChoice('chineseMedicine', $event)">
          <label v-for="option in medicineOptions" :key="option" class="choice" :class="{ 'choice--selected': form.chineseMedicine === option }">
            <radio :value="option" :checked="form.chineseMedicine === option" :disabled="busy" color="#1677ed" />
            <text>{{ option }}</text>
          </label>
        </radio-group>
      </view>

      <view class="submit-hint">生成后可保存 PDF，并在患者详情查看出院流程二维码。</view>
      <button class="primary-button" :loading="submitting" :disabled="busy" @tap="handleSubmit">{{ submitting ? '正在生成...' : '生成出院流程' }}</button>

    </block>
  </view>
</template>

<script>
  import { getDischargeRecord, getDischargeFlow, generateDischargeFlow } from '../../utils/api.js'
  import { generateDischargeReportPdf } from '../hzjbxx/report-pdf.js'
  import { savePdfToDevice } from '../../utils/save-pdf.js'
  import { settlementOptions, medicineOptions, invoiceReminder, settlementReminder, needsSettlementReminder, buildFlowSections } from './flow-content.js'

  function createRequestId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
      const random = Math.floor(Math.random() * 16)
      return (character === 'x' ? random : (random & 3) | 8).toString(16)
    })
  }

  export default {
    data() {
      return {
        id: '', record: null, loading: false, error: '', submitting: false, confirming: false,
        form: { settlementMethod: '', westernMedicine: '', chineseMedicine: '' },
        settlementOptions, medicineOptions, invoiceReminder, settlementReminder,
        savedForm: null, requestId: createRequestId()
      }
    },
    computed: {
      busy() { return this.submitting || this.confirming },
      showSettlementReminder() { return needsSettlementReminder(this.form.settlementMethod) }
    },
    onLoad(query) {
      this.id = query.id || ''
      if (this.id) this.loadPatient()
    },
    methods: {
      async loadPatient() {
        if (this.loading || !this.id) return
        this.loading = true
        this.error = ''
        try {
          const [patient, result] = await Promise.all([getDischargeRecord(this.id), getDischargeFlow(this.id)])
          this.record = patient.record
          if (result.flow) {
            this.form = { ...result.flow.form }
            this.savedForm = { ...result.flow.form }
          }
        } catch (error) {
          this.error = error.message || '加载失败，请重试'
        } finally { this.loading = false }
      },
      choosePatient() { uni.redirectTo({ url: '/pages/nurse/list?mode=flow' }) },
      setChoice(field, event) {
        if (this.busy) return
        this.form[field] = event.detail.value
        this.requestId = createRequestId()
      },
      createPdf(form) {
        return generateDischargeReportPdf(buildFlowSections(this.record.form.hospitalizationNumber, form), { title: '出院流程' })
      },
      fileName() {
        return `出院流程_${this.record.form.hospitalizationNumber.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')}.pdf`
      },
      async handleSubmit() {
        if (this.busy || !this.record) return
        if (this.savedForm) return this.showError('已生成出院流程，请前往患者详情页查看')
        if (!settlementOptions.includes(this.form.settlementMethod)) return this.showError('请选择结算方式')
        if (!medicineOptions.includes(this.form.westernMedicine)) return this.showError('请选择是否出院西药带药')
        if (!medicineOptions.includes(this.form.chineseMedicine)) return this.showError('请选择是否出院中药带药')
        this.confirming = true
        const confirmed = await new Promise(resolve => uni.showModal({
          title: '确认生成出院流程',
          content: `住院号：${this.record.form.hospitalizationNumber}\n结算方式：${this.form.settlementMethod}\n西药带药：${this.form.westernMedicine}；中药带药：${this.form.chineseMedicine}\n请确认填写无误，出院流程仅能生成一次。`,
          confirmText: '确认生成', cancelText: '返回修改',
          success: result => resolve(Boolean(result.confirm)), fail: () => resolve(false)
        }))
        this.confirming = false
        if (!confirmed) return
        this.submitting = true
        try {
          const form = { ...this.form }
          const pdf = this.createPdf(form)
          const result = await generateDischargeFlow(this.id, { requestId: this.requestId, form, pdfBase64: pdf })
          this.savedForm = { ...result.flow.form }
          this.requestId = createRequestId()
          try {
            await savePdfToDevice(pdf, this.fileName())
            uni.showToast({ title: '出院流程已生成', icon: 'none' })
          } catch (error) { this.showError('出院流程已保存，可扫描二维码打开 PDF 后下载') }
          uni.redirectTo({ url: `/pages/nurse/detail?id=${this.id}` })
        } catch (error) { this.showError(error.message || '生成失败，请重试') }
        finally { this.submitting = false }
      },
      showError(title) { uni.showToast({ title, icon: 'none' }) }
    }
  }
</script>

<style>
  page { background: #f5f6f8; }
  .page { min-height: 100vh; box-sizing: border-box; padding: 24rpx 24rpx 48rpx; background: #f5f6f8; }
  .patient-card, .step-card { padding: 28rpx; margin-bottom: 24rpx; border-radius: 18rpx; background: #fff; box-shadow: 0 4rpx 16rpx rgba(26,54,86,.06); }
  .patient-number { color: #253344; font-size: 34rpx; font-weight: 600; overflow-wrap: anywhere; }
  .patient-meta { margin-top: 12rpx; font-size: 29rpx; color: #718096; }
  .step-heading { display: flex; align-items: center; gap: 16rpx; margin-bottom: 26rpx; color: #145ea8; font-size: 38rpx; font-weight: 600; }
  .step-number { display: inline-flex; justify-content: center; align-items: center; width: 52rpx; height: 52rpx; border-radius: 50%; background: #eaf3ff; font-size: 30rpx; }
  .field-label { font-size: 34rpx; color: #253344; line-height: 48rpx; font-weight: 500; }
  .required { color: #e45454; margin-right: 8rpx; }
  .field-hint { color: #b8772c; font-size: 28rpx; line-height: 42rpx; margin: 8rpx 0; }
  .choice { display: flex; align-items: center; box-sizing: border-box; min-height: 86rpx; margin-top: 18rpx; padding: 16rpx 20rpx; border: 2rpx solid #e6ebf1; border-radius: 12rpx; font-size: 32rpx; color: #344253; }
  .choice radio { flex-shrink: 0; margin-right: 14rpx; }
  .choice--selected { border-color: #1677ed; background: #f0f7ff; }
  .choices-inline { display: flex; gap: 20rpx; }
  .choices-inline .choice { flex: 1; }
  .submit-hint { color: #718096; font-size: 27rpx; line-height: 42rpx; margin: 6rpx 0 20rpx; }
  .primary-button { background: #1677ed; color: #fff; border-radius: 14rpx; font-size: 34rpx; line-height: 92rpx; }
  .primary-button::after, .secondary-button::after { border: 0; }
  .secondary-button { margin-top: 18rpx; background: #eff6ff; color: #1677ed; border-radius: 10rpx; font-size: 30rpx; line-height: 76rpx; }
  .state-panel { padding: 80rpx 20rpx; font-size: 30rpx; color: #718096; line-height: 48rpx; text-align: center; }
</style>
