export function savePdfToDevice(base64Pdf, fileName) {
  // #ifdef MP-WEIXIN
  return new Promise((resolve, reject) => {
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`
    uni.getFileSystemManager().writeFile({
      filePath, data: base64Pdf, encoding: 'base64',
      success: () => uni.openDocument({ filePath, fileType: 'pdf', showMenu: true, success: resolve, fail: reject }),
      fail: reject
    })
  })
  // #endif
  // #ifdef H5
  const bytes = atob(base64Pdf)
  const array = new Uint8Array(bytes.length)
  for (let index = 0; index < bytes.length; index += 1) array[index] = bytes.charCodeAt(index)
  const url = URL.createObjectURL(new Blob([array], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return Promise.resolve()
  // #endif
  return Promise.reject(new Error('当前平台暂不支持导出 PDF'))
}
