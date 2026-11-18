<template>
  <view class="flows-page">
    <view class="flows-heading">入院与出院，一处办理</view>
    <view class="flows-description">请根据当前需要选择流程</view>

    <view class="flow-card">
      <view class="flow-card-heading">
        <view class="flow-icon"><image src="/static/icons/admission.svg" mode="aspectFit" /></view>
        <view class="flow-summary">
          <view class="flow-title">入院流程</view>
          <view class="flow-tag">无需登录</view>
        </view>
      </view>
      <view class="flow-description">查看入院办理步骤、注意事项及入院指引二维码。</view>
      <button class="flow-button" hover-class="flow-button--pressed" @tap="openAdmission">查看入院流程<text class="flow-arrow">›</text></button>
    </view>

    <view class="flow-card">
      <view class="flow-card-heading">
        <view class="flow-icon flow-icon--blue"><image src="/static/icons/discharge.svg" mode="aspectFit" /></view>
        <view class="flow-summary">
          <view class="flow-title">出院流程</view>
          <view class="flow-tag flow-tag--blue">{{ loggedIn ? '选择患者后办理' : '登录后办理' }}</view>
        </view>
      </view>
      <view class="flow-description">选择已建档患者，填写结算及带药信息，生成出院流程文档与二维码。</view>
      <button class="flow-button" hover-class="flow-button--pressed" @tap="openDischarge">办理出院流程<text class="flow-arrow">›</text></button>
    </view>
  </view>
</template>

<script>
  import { isLoggedIn, ensureAuthenticated } from '../../utils/auth.js'

  export default {
    data() { return { loggedIn: false } },
    onShow() { this.loggedIn = isLoggedIn() },
    methods: {
      openAdmission() { uni.navigateTo({ url: '/pages/rylc/index' }) },
      openDischarge() {
        const destination = '/pages/nurse/list?mode=flow'
        if (!ensureAuthenticated(destination)) return
        uni.navigateTo({ url: destination })
      }
    }
  }
</script>

<style scoped>
  .flows-page { box-sizing: border-box; min-height: 100vh; padding: 36rpx 24rpx 48rpx; background: #f5f6f8; }
  .flows-heading { margin: 0 4rpx 12rpx; color: #253344; font-size: 40rpx; font-weight: 600; line-height: 56rpx; }
  .flows-description { margin: 0 4rpx 32rpx; color: #687079; font-size: 28rpx; line-height: 44rpx; }
  .flow-card { margin-bottom: 28rpx; padding: 32rpx; border: 1rpx solid #edf0f2; border-radius: 28rpx; background: #fff; box-shadow: 0 4rpx 14rpx rgba(33,42,55,.06); }
  .flow-card-heading { display: flex; align-items: center; }
  .flow-icon { display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: 100rpx; height: 100rpx; margin-right: 24rpx; border-radius: 26rpx; background: #eaf5f0; }
  .flow-icon--blue { background: #eaf3ff; }
  .flow-icon image { width: 60rpx; height: 60rpx; }
  .flow-summary { flex: 1; min-width: 0; }
  .flow-title { color: #253344; font-size: 36rpx; font-weight: 600; line-height: 50rpx; }
  .flow-tag { display: inline-block; margin-top: 8rpx; padding: 2rpx 12rpx; border-radius: 8rpx; background: #eaf5f0; color: #28765b; font-size: 24rpx; line-height: 36rpx; }
  .flow-tag--blue { background: #eaf3ff; color: #145ea8; }
  .flow-description { margin: 26rpx 0; color: #687079; font-size: 29rpx; line-height: 46rpx; }
  .flow-button { display: flex; align-items: center; justify-content: space-between; width: 100%; margin: 0; padding: 0 28rpx; border-radius: 14rpx; background: #1677ed; color: #fff; font-size: 30rpx; line-height: 88rpx; text-align: left; }
  .flow-button::after { border: none; }
  .flow-button--pressed { opacity: .78; }
  .flow-arrow { margin-left: 16rpx; font-family: Arial, sans-serif; font-size: 44rpx; }
</style>
