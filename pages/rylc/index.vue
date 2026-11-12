<template>
  <view class="admission-page">
    <view class="admission-title">{{ admissionFlow.title }}</view>
    <view v-for="(step, index) in admissionFlow.steps" :key="step.title" class="admission-card admission-step">
      <view class="admission-step-heading">
        <text class="admission-step-number">{{ index + 1 }}</text>
        <text class="admission-step-title">{{ step.title }}</text>
      </view>
      <view v-if="step.description" class="admission-description">{{ step.description }}</view>
    </view>
    <view class="admission-card admission-share-card">
      <view class="admission-subtitle">入院流程二维码</view>
      <view v-if="loading" class="admission-state">正在加载二维码...</view>
      <view v-else-if="error" class="admission-state">
        <text>{{ error }}</text>
        <button class="admission-retry" @tap="loadShare">重新加载</button>
      </view>
      <block v-else-if="share">
        <image class="admission-qr" :src="share.qrDataUrl" mode="widthFix" show-menu-by-longpress />
        <view class="admission-hint">扫描或长按识别二维码，直接查看入院流程图片。</view>
        <view class="admission-note">无需登录即可阅读和下载。</view>
      </block>
    </view>
  </view>
</template>

<script>
  import { getAdmissionFlowShare } from '../../utils/api.js'
  import admissionFlow from '../../server/documents/admission-flow.json'

  export default {
    data() { return { admissionFlow, loading: false, error: '', share: null } },
    onLoad() { this.loadShare() },
    methods: {
      async loadShare() {
        if (this.loading) return
        this.loading = true
        this.error = ''
        try {
          const result = await getAdmissionFlowShare()
          this.share = result.share
        } catch (error) {
          this.error = error.message || '加载失败，请稍后重试'
        } finally { this.loading = false }
      }
    }
  }
</script>

<style scoped>
  .admission-page { min-height: 100vh; box-sizing: border-box; padding: 28rpx 24rpx; background: #f5f6f8; }
  .admission-card { margin-bottom: 20rpx; padding: 28rpx; border-radius: 16rpx; background: #fff; box-shadow: 0 4rpx 16rpx rgba(26,54,86,.06); }
  .admission-title { margin: 8rpx 0 28rpx; color: #145ea8; font-size: 38rpx; font-weight: 600; line-height: 54rpx; text-align: center; }
  .admission-step-heading { display: flex; align-items: flex-start; }
  .admission-step-number { display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: 46rpx; height: 46rpx; margin-right: 16rpx; border-radius: 50%; background: #eaf3ff; color: #145ea8; font-size: 28rpx; }
  .admission-step-title { flex: 1; min-width: 0; color: #145ea8; font-size: 34rpx; font-weight: 600; line-height: 48rpx; }
  .admission-description { margin-top: 18rpx; color: #3f4d5c; font-size: 32rpx; line-height: 52rpx; overflow-wrap: anywhere; }
  .admission-share-card { text-align: center; }
  .admission-subtitle { margin-bottom: 18rpx; color: #145ea8; font-size: 34rpx; font-weight: 600; line-height: 48rpx; }
  .admission-qr { display: block; width: 420rpx; max-width: 100%; margin: 0 auto 18rpx; }
  .admission-hint { color: #344253; font-size: 30rpx; line-height: 46rpx; }
  .admission-note { color: #718096; font-size: 28rpx; line-height: 42rpx; margin-top: 12rpx; }
  .admission-state { padding: 24rpx 0; text-align: center; color: #718096; font-size: 30rpx; line-height: 46rpx; }
  .admission-retry { margin-top: 24rpx; background: #1677ed; color: #fff; font-size: 30rpx; border-radius: 12rpx; }
</style>
