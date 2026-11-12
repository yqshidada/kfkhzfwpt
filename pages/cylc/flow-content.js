// 维护出院流程的选项与 PDF 文案。
export const settlementOptions = ['柜台身份证医保卡', '自助机结算', '短信通知']
export const medicineOptions = ['有', '无']
export const invoiceReminder = '必须有结算的清单发票'
export const settlementReminder = '（柜台和自助机结算在护士站往右走20米窗口）'
export function needsSettlementReminder(method) {
  return method === '柜台身份证医保卡' || method === '自助机结算'
}
export const westernInstructions = {
  有: '护士站往左走20米的玻璃窗口领取西药',
  无: ''
}
export const chineseInstructions = { 有: '请前往护士站领取中药', 无: '' }

export function buildFlowSections(hospitalizationNumber, form) {
  const sections = [
    { title: '', items: [`住院号：${hospitalizationNumber}`], spacingAfter: 18 },
    { title: '步骤一：结算方式', items: [
      form.settlementMethod,
      ...(needsSettlementReminder(form.settlementMethod)
        ? [{ body: true, content: settlementReminder, fontSize: 8.5, color: '0.82 0.12 0.12' }]
        : [])
    ], spacingAfter: 22 }
  ]
  const stepNumbers = ['一', '二', '三', '四']
  function appendStep(name, items) {
    sections.push({ title: `步骤${stepNumbers[sections.length - 1]}：${name}`, items, spacingAfter: 22 })
  }
  if (form.westernMedicine === '有') {
    appendStep('领取西药', [
      { body: true, bold: false, content: westernInstructions.有 },
      { body: true, content: `注意：${invoiceReminder}`, fontSize: 8.5, color: '0.82 0.12 0.12' }
    ])
  }
  if (form.chineseMedicine === '有') {
    appendStep('领取中药', [
      { body: true, bold: false, content: chineseInstructions.有 },
      { body: true, content: `注意：${invoiceReminder}`, fontSize: 8.5, color: '0.82 0.12 0.12' }
    ])
  }
  appendStep('领取资料', [{ body: true, content: '请前往护士站领取出院小结及诊断证明书', bold: false }])
  return sections
}
