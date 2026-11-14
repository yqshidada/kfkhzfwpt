<template>
	<view class="page">
		<view v-if="!selectFlow" class="list-tabs">
			<view v-for="tab in tabs" :key="tab.key" class="list-tab" :class="{ 'list-tab--active': activeTab === tab.key }" @tap="switchTab(tab.key)">
				<text>{{ tab.title }}</text><view v-if="activeTab === tab.key" class="tab-indicator"></view>
			</view>
		</view>
		<view v-if="selectFlow" class="selection-hint">请选择患者，为该患者填写出院流程。未建档患者请先在患者入口生成出院报告。</view>
		<view v-if="activeTab === 'reservations' && reminders.total > 0" class="reminder-banner">
			<view class="reminder-content"><text class="reminder-title">明日预约提醒</text><text class="reminder-description">明天（{{ reminders.date }}）有 {{ reminders.total }} 位患者预约床位，请提前联系并做好床位安排。</text></view>
			<button class="reminder-button" size="mini" @tap="showTomorrowReservations">查看名单</button>
		</view>
		<view v-if="activeTab === 'reservations' && reminders.error" class="reminder-error" @tap="refreshReminders">{{ reminders.error }}，点击重试</view>
		<view class="search-bar">
			<input v-model.trim="currentList.keyword" class="search-input" :placeholder="activeTab === 'patients' ? '搜索住院号、电话或诊断' : '搜索姓名或电话'" confirm-type="search" @confirm="search" />
			<button class="search-button" size="mini" @tap="search">搜索</button>
		</view>
		<view v-if="activeTab === 'reservations'" class="reservation-filters">
			<picker class="status-picker" :range="reservationStatusOptions" :value="reservationStatusIndex" @change="handleStatusChange">
				<view class="status-select"><text>{{ reservationStatusOptions[reservationStatusIndex] }}</text><view class="status-select-arrow" aria-hidden="true"></view></view>
			</picker>
			<text class="reservation-count">{{ currentList.total === null ? (currentList.loading ? '人数统计中...' : '人数：—') : '共 ' + currentList.total + ' 人' }}</text>
		</view>
		<view v-if="activeTab === 'reservations' && currentList.reminderOnly" class="reminder-filter">
			<text>仅查看明日预约（不含已取消）</text><text class="reminder-clear" @tap="clearReminderFilter">查看全部日期</text>
		</view>
		<view v-if="currentList.loading && !currentList.records.length" class="state-text">正在加载记录...</view>
		<view v-else-if="currentList.error && !currentList.records.length" class="state-panel">
			<text>{{ currentList.error }}</text><button class="retry-button" size="mini" @tap="reload()">重新加载</button>
		</view>
		<view v-else-if="!currentList.records.length" class="state-text">{{ activeTab === 'patients' ? '暂无符合条件的患者记录' : '暂无符合条件的预约记录' }}</view>

		<block v-if="activeTab === 'patients'">
			<view v-for="record in currentList.records" :key="record.id" class="record-card" hover-class="record-card--pressed" @tap="openDetail(record.id)">
				<view class="record-heading"><text class="record-number">住院号：{{ record.hospitalizationNumber }}</text><text class="record-arrow">›</text></view>
				<view class="record-row"><text>性别：{{ record.gender }}</text><text>年龄：{{ record.age }}</text></view>
				<view class="record-row"><text>诊断：{{ record.diagnosis }}</text></view>
				<view class="record-row"><text>电话：{{ record.phone }}</text></view>
				<view class="record-row record-row--muted"><text>生成时间：{{ formatDate(record.createdAt) }}</text></view>
			</view>
		</block>
		<block v-else>
			<view v-for="record in currentList.records" :key="record.id" class="record-card" hover-class="record-card--pressed" @tap="openReservation(record.id)">
				<view class="record-heading"><text class="record-number">姓名：{{ record.name }}</text><text class="record-arrow">›</text></view>
				<view class="record-row"><text>性别：{{ record.gender }}</text><text>年龄：{{ record.age }}岁</text></view>
				<view class="record-row"><text>电话：{{ record.phone }}</text></view>
				<view v-if="record.repeatReservation === '是'" class="record-row"><text class="repeat-tag">再次预约</text></view>
				<view class="record-row"><text>预约日期：{{ record.reservationDate || '未填写' }}</text><text v-if="record.reservationDate === reminders.date && record.status !== '取消预约'" class="tomorrow-tag">明日预约</text></view>
				<view class="record-row record-row--muted"><text>提交时间：{{ formatReservationTime(record.createdAt) }}</text></view>
				<view class="record-row"><text>预约状态</text><text class="status-tag" :class="{ 'status-tag--success': record.status === '预约成功', 'status-tag--cancelled': record.status === '取消预约' }">{{ record.status }}</text></view>
				<view v-if="record.status === '预约成功'" class="record-row waiting-days"><text>平均约床时长：{{ formatWaitingDays(record.waitingDays) }} 天</text></view>
				<view class="staff-note" @tap.stop>
					<view class="staff-note-heading"><text>护士备注</text><text class="staff-note-count">{{ (noteEditors[record.id] ? noteEditors[record.id].text : record.staffNote || '').length }}/1000</text></view>
					<textarea class="staff-note-input" :value="noteEditors[record.id] ? noteEditors[record.id].text : record.staffNote || ''" maxlength="1000" :disabled="!!(noteEditors[record.id] && noteEditors[record.id].saving)" placeholder="护长、护士可在此填写备注" @input="changeNote(record, $event)" @tap.stop />
					<text v-if="noteEditors[record.id] && noteEditors[record.id].error" class="staff-note-error">{{ noteEditors[record.id].error }}</text>
					<view class="staff-note-actions"><text class="staff-note-updated">{{ record.staffNoteUpdatedAt ? '更新于 ' + formatReservationTime(record.staffNoteUpdatedAt) : '尚无备注' }}</text><button class="note-save" size="mini" :loading="!!(noteEditors[record.id] && noteEditors[record.id].saving)" :disabled="!noteEditors[record.id] || !noteEditors[record.id].dirty || noteEditors[record.id].saving" @tap.stop="saveNote(record)">保存备注</button></view>
					<text v-if="noteEditors[record.id] && noteEditors[record.id].conflict" class="note-refresh" @tap.stop="refreshNote(record)">加载最新备注（将替换当前输入）</text>
				</view>
				<view class="record-actions" @tap.stop>
					<button v-if="record.status !== '预约中'" class="record-action rebook-action" size="mini" :disabled="actionBusy || !!rebookTarget" @tap.stop="openRebook(record)">再次预约</button>
					<button class="record-action delete-action" size="mini" :disabled="actionBusy || !!rebookTarget" @tap.stop="handleDeleteReservation(record)">删除预约</button>
				</view>
			</view>
		</block>
		<view v-if="currentList.records.length" class="load-more">
			<text v-if="currentList.loading">正在加载...</text>
			<text v-else-if="currentList.error" @tap="loadMore()">加载失败，点击重试</text>
			<text v-else-if="currentList.hasMore">继续下滑加载更多</text>
			<text v-else>没有更多记录了</text>
		</view>
		<view v-if="rebookTarget" class="reservation-dialog-mask" @tap="closeRebook">
			<view class="reservation-dialog" @tap.stop>
				<text class="dialog-title">再次预约</text>
				<text class="dialog-patient">患者：{{ rebookTarget.name }}</text>
				<text class="dialog-note">沿用原预约的患者资料、预约医生、管道、诊断及病情介绍和特殊需求，新建一条“预约中”记录；原预约保留不变。</text>
				<text class="dialog-label">预约日期（选填）</text>
				<picker mode="date" :disabled="actionBusy" :value="rebookDate || minimumRebookDate" :start="minimumRebookDate" @change="handleRebookDateChange">
					<view class="rebook-date"><text>{{ rebookDate || '请选择预约日期' }}</text><view class="picker-arrow" aria-hidden="true"></view></view>
				</picker>
				<text v-if="rebookDate" class="rebook-clear" @tap="clearRebookDate">清除日期</text>
				<text class="dialog-note">预约日期默认留空，不沿用原日期；填写后才会在预约前一天提醒护士。</text>
				<text v-if="rebookError" class="dialog-error">{{ rebookError }}</text>
				<view class="dialog-actions">
					<button class="dialog-cancel" :disabled="actionBusy" @tap="closeRebook">取消</button>
					<button class="dialog-confirm" :loading="actionBusy" :disabled="actionBusy" @tap="handleRebook">确认再次预约</button>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import { getDischargeRecords, getBedReservations, getBedReservationReminders, rebookBedReservation, deleteBedReservation, updateBedReservationNote, getBedReservation } from '../../utils/api.js'
	import { formatReservationTime, formatWaitingDays, createReservationRequestId } from '../../utils/reservation.js'

	import { beijingDate, isValidReservationDate } from '../../server/reservation-validation.js'

	function emptyList() {
		return { keyword: '', queryKeyword: '', status: '', queryStatus: '', reminderOnly: false, queryReminderOnly: false, total: null, records: [], cursor: null, hasMore: true, loading: false, error: '', loaded: false, version: 0 }
	}
	export default {
		data() {
			return {
				selectFlow: false, noteEditors: {},
				actionBusy: false, rebookTarget: null, rebookDate: '', rebookError: '', rebookRequestId: '', minimumRebookDate: beijingDate(),
				reminders: { date: '', total: 0, loading: false, error: '', version: 0 },
				activeTab: 'patients',
				reservationStatusOptions: ['全部状态', '预约中', '预约成功', '取消预约'],
				tabs: [{ key: 'patients', title: '患者列表' }, { key: 'reservations', title: '预约列表' }],
				lists: { patients: emptyList(), reservations: emptyList() }
			}
		},
		computed: {
			currentList() { return this.lists[this.activeTab] },
			reservationStatusIndex() { return Math.max(0, this.reservationStatusOptions.indexOf(this.lists.reservations.status)) }
		},
		onLoad(query = {}) {
			this.selectFlow = query.mode === 'flow'
			this.activeTab = !this.selectFlow && query.tab === 'reservations' ? 'reservations' : 'patients'
			uni.setNavigationBarTitle({ title: this.selectFlow ? '选择出院患者' : '患者与预约' })
			this.reload()
		},
		onShow() {
			// Returning from a confirmation refreshes the selected tab without resetting it.
			if (this.currentList.loaded && !this.currentList.loading) this.reload()
			this.startReminderRefresh()
		},
		onHide() { this.stopReminderRefresh() },
		onUnload() { this.stopReminderRefresh() },
		onReachBottom() { this.loadMore() },
		onPullDownRefresh() { Promise.all([this.reload(), this.activeTab === 'reservations' ? this.refreshReminders() : Promise.resolve()]).finally(() => uni.stopPullDownRefresh()) },
		methods: {
			ensureNoteEditor(record) {
				if (!this.noteEditors[record.id]) this.noteEditors = { ...this.noteEditors, [record.id]: { text: record.staffNote || '', version: record.staffNoteVersion || 0, dirty: false, saving: false, error: '', conflict: false } }
				return this.noteEditors[record.id]
			},
			changeNote(record, event) {
				const editor = this.ensureNoteEditor(record)
				if (editor.saving) return
				editor.text = String(event.detail.value || '').slice(0, 1000); editor.dirty = true; editor.error = ''
			},
			async saveNote(record) {
				const editor = this.ensureNoteEditor(record)
				if (!editor.dirty || editor.saving) return
				editor.saving = true; editor.error = ''
				try {
					const result = await updateBedReservationNote(record.id, { note: editor.text, version: editor.version })
					Object.assign(record, result.reservation)
					editor.text = record.staffNote; editor.version = record.staffNoteVersion; editor.dirty = false; editor.conflict = false
					uni.showToast({ title: '备注已保存', icon: 'success' })
				} catch (error) { editor.error = error.message || '备注保存失败，请重试'; editor.conflict = error.code === 'NOTE_VERSION_CONFLICT' }
				finally { editor.saving = false }
			},
			async refreshNote(record) {
				const editor = this.ensureNoteEditor(record)
				if (editor.saving) return
				editor.saving = true
				try {
					const result = await getBedReservation(record.id)
					Object.assign(record, result.reservation)
					editor.text = record.staffNote; editor.version = record.staffNoteVersion; editor.dirty = false; editor.conflict = false; editor.error = ''
				} catch (error) { editor.error = error.message || '加载备注失败，请重试' }
				finally { editor.saving = false }
			},
			openRebook(record) {
				if (this.actionBusy || this.rebookTarget || !record || record.status === '预约中') return
				uni.hideToast()
				this.rebookTarget = { id: record.id, name: record.name }
				this.rebookDate = ''; this.rebookError = ''; this.minimumRebookDate = beijingDate()
				this.rebookRequestId = createReservationRequestId()
			},
			closeRebook() {
				if (this.actionBusy) return
				this.rebookTarget = null; this.rebookError = ''; this.rebookRequestId = ''
			},
			handleRebookDateChange(event) {
				if (this.actionBusy || !this.rebookTarget) return
				const date = event.detail.value
				if (date !== this.rebookDate) this.rebookRequestId = createReservationRequestId()
				this.rebookDate = date; this.rebookError = ''; this.minimumRebookDate = beijingDate()
			},
			clearRebookDate() {
				if (this.actionBusy || !this.rebookTarget) return
				this.rebookDate = ''; this.rebookError = ''; this.rebookRequestId = createReservationRequestId()
			},
			async refreshReservationQueue() {
				const list = this.lists.reservations
				list.version++; list.loaded = false; list.loading = false
				this.reminders.version++; this.reminders.loading = false
				if (this.activeTab === 'reservations') await Promise.all([this.reload(), this.refreshReminders()])
			},
			async handleRebook() {
				if (this.actionBusy || !this.rebookTarget) return
				this.minimumRebookDate = beijingDate()
				if (this.rebookDate && (!isValidReservationDate(this.rebookDate) || this.rebookDate < this.minimumRebookDate)) { this.rebookError = '请选择今天或以后的有效预约日期'; return }
				this.actionBusy = true; this.rebookError = ''
				try {
					await rebookBedReservation(this.rebookTarget.id, { requestId: this.rebookRequestId, reservationDate: this.rebookDate })
					this.rebookTarget = null; this.rebookRequestId = ''
					uni.showToast({ title: '再次预约已提交', icon: 'success' })
					await this.refreshReservationQueue()
				} catch (error) { this.rebookError = error.message || '再次预约失败，请重试' }
				finally { this.actionBusy = false }
			},
			async handleDeleteReservation(record) {
				if (this.actionBusy || this.rebookTarget || !record) return
				uni.hideToast()
				this.actionBusy = true
				try {
					const confirmed = await new Promise(resolve => uni.showModal({
						title: '删除预约信息', content: '确认永久删除“' + record.name + '”的这条预约？删除后无法恢复，不影响该患者的其他预约及出院档案。',
						confirmText: '确认删除', confirmColor: '#d44949', success: result => resolve(Boolean(result.confirm)), fail: () => resolve(false)
					}))
					if (!confirmed) return
					await deleteBedReservation(record.id)
					uni.showToast({ title: '预约已删除', icon: 'success' })
					await this.refreshReservationQueue()
				} catch (error) { uni.showToast({ title: error.message || '删除失败，请重试', icon: 'none' }) }
				finally { this.actionBusy = false }
			},
			startReminderRefresh() {
				this.stopReminderRefresh()
				if (this.selectFlow) return
				if (this.activeTab === 'reservations') this.refreshReminders()
				this._reminderTimer = setInterval(() => {
					if (this.activeTab === 'reservations') this.refreshReminders()
				}, 60000)
			},
			stopReminderRefresh() {
				if (this._reminderTimer) clearInterval(this._reminderTimer)
				this._reminderTimer = null
				this.reminders.version++
				this.reminders.loading = false
			},
			async refreshReminders() {
				if (this.selectFlow || this.activeTab !== 'reservations' || this.reminders.loading) return
				const version = ++this.reminders.version
				this.reminders.loading = true
				try {
					const result = await getBedReservationReminders()
					if (version !== this.reminders.version) return
					const previousDate = this.reminders.date
					this.reminders.date = result.date
					this.reminders.total = result.total
					this.reminders.error = ''
					// Keep an open tomorrow-only list correct when the China calendar day changes.
					if (previousDate && previousDate !== result.date && this.currentList.reminderOnly) this.reload()
				} catch (error) {
					if (version === this.reminders.version) { this.reminders.total = 0; this.reminders.error = '预约提醒暂时加载失败' }
				} finally { if (version === this.reminders.version) this.reminders.loading = false }
			},
			showTomorrowReservations() {
				if (this.selectFlow || this.activeTab !== 'reservations') return
				const list = this.lists.reservations
				list.keyword = ''; list.status = ''; list.reminderOnly = true
				return this.reload()
			},
			clearReminderFilter() {
				this.lists.reservations.reminderOnly = false
				return this.reload()
			},
			handleStatusChange(event) {
				const index = Number(event.detail.value)
				if (this.activeTab !== 'reservations' || !Number.isInteger(index) || !this.reservationStatusOptions[index]) return
				const status = index === 0 ? '' : this.reservationStatusOptions[index]
				if (status === this.lists.reservations.status) return
				this.lists.reservations.status = status
				return this.reload()
			},
			formatReservationTime,
			formatWaitingDays,
			formatDate(value) { return value ? String(value).replace('T', ' ').slice(0, 19) : '' },
			switchTab(key) {
				if (this.selectFlow || !this.lists[key] || this.activeTab === key) return
				this.activeTab = key
				if (key === 'reservations') this.refreshReminders()
				uni.pageScrollTo({ scrollTop: 0, duration: 0 })
				this.reload()
			},
			async reload() { return this.loadMore(true) },
			async search() { return this.reload() },
			async loadMore(reset = false) {
				const tab = this.activeTab
				const list = this.lists[tab]
				if (!reset && (list.loading || !list.hasMore)) return
				const version = ++list.version
				if (reset) { list.queryKeyword = list.keyword; list.queryStatus = list.status; list.queryReminderOnly = list.reminderOnly; list.total = null; list.cursor = null; list.records = []; list.hasMore = true }
				list.loading = true
				list.error = ''
				try {
					const request = tab === 'patients' ? getDischargeRecords : getBedReservations
					const result = await request({ keyword: list.queryKeyword, cursor: list.cursor, limit: 20, ...(tab === 'reservations' ? { status: list.queryStatus, reminder: list.queryReminderOnly ? 'tomorrow' : '' } : {}) })
					if (version !== list.version) return
					list.records = reset ? result.items : list.records.concat(result.items)
					if (tab === 'reservations') {
						list.total = result.total
						for (const record of result.items) {
							const editor = this.noteEditors[record.id]
							if (editor && (editor.dirty || editor.saving)) continue
							this.noteEditors = { ...this.noteEditors, [record.id]: { text: record.staffNote || '', version: record.staffNoteVersion || 0, dirty: false, saving: false, error: '', conflict: false } }
						}
					}
					list.cursor = result.nextCursor
					list.hasMore = result.hasMore
					list.loaded = true
				} catch (error) {
					if (version !== list.version) return
					list.error = error.message || '加载失败，请稍后重试'
					if (list.records.length && this.activeTab === tab) uni.showToast({ title: list.error, icon: 'none' })
				} finally {
					if (version === list.version) list.loading = false
				}
			},
			openDetail(id) {
				if (this.selectFlow) return uni.navigateTo({ url: '/pages/cylc/index?id=' + id })
				uni.navigateTo({ url: '/pages/nurse/detail?id=' + id })
			},
			openReservation(id) { uni.navigateTo({ url: '/pages/nurse/reservation-detail?id=' + id }) }
		}
	}
</script>

<style scoped>
	@import "../../static/styles/picker-arrow.css";
	page { background: #f5f6f8; }
	.page { min-height: 100vh; padding: 24rpx 24rpx 36rpx; box-sizing: border-box; background: #f5f6f8; }
	.selection-hint { margin-bottom: 20rpx; color: #62758b; font-size: 28rpx; line-height: 42rpx; }
	.search-bar { display: flex; align-items: center; margin-bottom: 20rpx; padding: 12rpx 14rpx 12rpx 20rpx; border-radius: 12rpx; background: #fff; box-shadow: 0 3rpx 10rpx rgba(34, 48, 65, 0.08); }
	.search-input { flex: 1; min-width: 0; height: 58rpx; color: #344253; font-size: 29rpx; }
	.search-button, .retry-button { margin: 0; border-radius: 8rpx; background: #1677ed; color: #fff; font-size: 26rpx; line-height: 54rpx; }
	.search-button { flex: 0 0 140rpx; width: 140rpx; height: 54rpx; padding: 0; white-space: nowrap; }
	.search-button::after, .retry-button::after { border: 0; }
	.record-card { margin-bottom: 18rpx; padding: 24rpx; border-radius: 12rpx; background: #fff; box-shadow: 0 3rpx 10rpx rgba(34, 48, 65, 0.07); }
	.record-card--pressed { opacity: 0.72; }
	.record-heading, .record-row { display: flex; align-items: center; justify-content: space-between; }
	.record-number { color: #1f2d3d; font-size: 31rpx; font-weight: 600; }
	.record-arrow { color: #9ba5b1; font-size: 43rpx; line-height: 40rpx; }
	.record-row { margin-top: 14rpx; color: #4d5a68; font-size: 27rpx; line-height: 36rpx; }
	.record-row--muted { color: #8a96a3; font-size: 25rpx; }
	.state-text, .state-panel { padding: 100rpx 20rpx; color: #8a96a3; font-size: 29rpx; text-align: center; }
	.retry-button { display: block; width: 156rpx; height: 54rpx; margin: 22rpx auto 0; }
	.load-more { padding: 18rpx 0; color: #9aa4af; font-size: 25rpx; text-align: center; }
	.list-tabs { position: sticky; top: 0; z-index: 5; display: flex; margin: -24rpx -24rpx 24rpx; background: #fff; border-bottom: 1rpx solid #edf0f2; }
	.list-tab { position: relative; flex: 1; padding: 28rpx 0 26rpx; text-align: center; color: #34495e; font-size: 32rpx; line-height: 46rpx; }
	.list-tab--active { color: #4095ff; font-weight: 600; }
	.tab-indicator { position: absolute; bottom: 0; left: 50%; width: 84rpx; height: 6rpx; margin-left: -42rpx; background: #4095ff; }
	.status-tag { padding: 4rpx 18rpx; border-radius: 8rpx; color: #ba7b15; background: #fff6e5; font-size: 25rpx; }
	.status-tag--success { color: #208061; background: #eaf6ef; }
	.reminder-banner { display: flex; align-items: center; gap: 16rpx; padding: 22rpx; margin-bottom: 22rpx; border: 1rpx solid #ffd591; border-radius: 12rpx; background: #fff7e6; }
	.reminder-content { flex: 1; min-width: 0; }
	.reminder-title { display: block; color: #ad6800; font-size: 29rpx; font-weight: 600; }
	.reminder-description { display: block; margin-top: 10rpx; color: #92641a; font-size: 25rpx; line-height: 38rpx; }
	.reminder-button { flex-shrink: 0; margin: 0; padding: 0 16rpx; color: #ad6800; background: #ffe7ba; font-size: 25rpx; line-height: 56rpx; }
	.reminder-button::after { border: 0; }
	.reminder-filter { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10rpx; margin-bottom: 20rpx; color: #92641a; font-size: 25rpx; line-height: 38rpx; }
	.reminder-clear { color: #1677ed; }
	.reminder-error { margin-bottom: 18rpx; color: #b27916; font-size: 25rpx; line-height: 38rpx; }
	.tomorrow-tag { flex-shrink: 0; margin-left: 12rpx; padding: 2rpx 12rpx; border-radius: 6rpx; color: #ad6800; background: #fff1d6; font-size: 23rpx; }
	.status-tag--cancelled { color: #7b8492; background: #edf0f4; }
	.waiting-days { padding-top: 14rpx; border-top: 1rpx solid #edf0f2; color: #1677ed; }
	.record-number { overflow-wrap: anywhere; }
	.reservation-filters { display: flex; align-items: center; justify-content: space-between; gap: 20rpx; margin-bottom: 22rpx; }
	.status-picker { flex: 0 1 280rpx; }
	.status-select { display: flex; align-items: center; padding: 0 20rpx; color: #344253; font-size: 27rpx; }
	.reservation-count { flex-shrink: 0; color: #607080; font-size: 27rpx; line-height: 40rpx; }

	.record-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 18rpx; margin-top: 22rpx; padding-top: 18rpx; border-top: 1rpx solid #edf0f2; }
	.record-action { margin: 0; padding: 0 22rpx; font-size: 25rpx; line-height: 58rpx; border-radius: 8rpx; }
	.record-action::after, .dialog-actions button::after { border: 0; }
	.rebook-action { color: #1677ed; background: #edf5ff; }
	.delete-action { color: #d44949; background: #fff1f0; }
	.record-action[disabled] { color: #9ba5b1; background: #f0f2f5; }
	.repeat-tag { padding: 4rpx 16rpx; border-radius: 8rpx; color: #1677ed; background: #edf5ff; font-size: 25rpx; }
	.reservation-dialog-mask { position: fixed; z-index: 100; inset: 0; display: flex; align-items: center; justify-content: center; padding: 32rpx; background: rgba(0,0,0,.45); }
	.reservation-dialog { box-sizing: border-box; width: 100%; max-width: 640rpx; max-height: 85vh; overflow-y: auto; padding: 32rpx; border-radius: 20rpx; background: #fff; }
	.dialog-title { display: block; color: #253344; font-size: 34rpx; font-weight: 600; }
	.dialog-patient, .dialog-label { display: block; margin-top: 24rpx; color: #344253; font-size: 28rpx; }
	.dialog-note { display: block; margin-top: 16rpx; color: #718096; font-size: 25rpx; line-height: 40rpx; }
	.rebook-date { display: flex; align-items: center; justify-content: space-between; min-height: 76rpx; padding: 0 16rpx; margin-top: 16rpx; border-radius: 8rpx; background: #f5f6f8; font-size: 28rpx; color: #344253; }
	.rebook-clear { display: inline-block; padding: 12rpx 0; color: #1677ed; font-size: 25rpx; }
	.dialog-error { display: block; margin-top: 18rpx; color: #d44949; font-size: 26rpx; line-height: 40rpx; }
	.dialog-actions { display: flex; gap: 16rpx; margin-top: 30rpx; }
	.dialog-actions button { flex: 1; margin: 0; padding: 0 12rpx; font-size: 27rpx; line-height: 76rpx; border-radius: 10rpx; }
	.dialog-cancel { color: #4d5a68; background: #f0f2f5; }
	.dialog-confirm { color: #fff; background: #1677ed; }
	.dialog-actions button[disabled] { color: #9ba5b1; background: #f0f2f5; }
	.staff-note { margin-top: 22rpx; padding-top: 20rpx; border-top: 1rpx solid #edf0f4; }
	.staff-note-heading, .staff-note-actions { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; color: #526273; font-size: 26rpx; }
	.staff-note-count, .staff-note-updated { color: #8a96a3; font-size: 22rpx; }
	.staff-note-input { box-sizing: border-box; width: 100%; height: 142rpx; padding: 16rpx; margin: 14rpx 0; border: 1rpx solid #dfe5ed; border-radius: 8rpx; background: #fafbfd; color: #344253; font-size: 27rpx; line-height: 38rpx; }
	.note-save { flex-shrink: 0; margin: 0; padding: 0 20rpx; color: #fff; background: #1677ed; font-size: 24rpx; line-height: 52rpx; }
	.note-save[disabled] { color: #8a96a3; background: #edf0f4; }
	.staff-note-error { display: block; margin-bottom: 12rpx; color: #d94b49; font-size: 24rpx; }
	.note-refresh { display: block; margin-top: 12rpx; color: #1677ed; font-size: 24rpx; }
</style>
