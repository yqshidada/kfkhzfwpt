;(function () {
  'use strict'
  var base = document.querySelector('main').getAttribute('data-base')
  var status = document.getElementById('status')
  var retry = document.getElementById('retry')
  var pages = document.getElementById('pages')
  var zoom = document.getElementById('zoom')
  var zoomImage = document.getElementById('zoom-image')
  var sizeButton = document.getElementById('zoom-size')
  var running = false
  var previousFocus
  function closeZoom() {
    zoom.hidden = true
    zoomImage.removeAttribute('src')
    document.body.style.overflow = ''
    if (previousFocus) previousFocus.focus()
  }
  function toggleSize() {
    var expanded = zoomImage.classList.toggle('expanded')
    sizeButton.textContent = expanded ? '适应屏幕' : '放大原图'
  }
  document.getElementById('zoom-close').onclick = closeZoom
  zoomImage.onerror = function () {
    closeZoom()
    status.textContent = '图片加载失败，请重新加载；链接可能已失效。'
    retry.hidden = false
  }
  sizeButton.onclick = toggleSize
  zoomImage.onclick = toggleSize
  document.addEventListener('keydown', function (event) {
    if (zoom.hidden) return
    if (event.key === 'Escape') closeZoom()
    if (event.key === 'Tab') {
      event.preventDefault()
      ;(document.activeElement === sizeButton ? document.getElementById('zoom-close') : sizeButton).focus()
    }
  })
  function showPages(manifest) {
    pages.textContent = ''
    status.textContent = '共 ' + manifest.pages + ' 页'
    for (var i = 1; i <= manifest.pages; i++) {
      var card = document.createElement('section')
      card.className = 'page-card'
      var label = document.createElement('p')
      label.className = 'page-label'
      label.textContent = '第 ' + i + ' / ' + manifest.pages + ' 页'
      var link = document.createElement('a')
      link.className = 'page-link'
      link.href = base + '/images/' + i + '?v=' + encodeURIComponent(manifest.version)
      link.setAttribute('aria-label', '放大第 ' + i + ' 页')
      var img = document.createElement('img')
      img.className = 'page-image'
      img.alt = '第 ' + i + ' 页'
      img.loading = i === 1 ? 'eager' : 'lazy'
      img.decoding = 'async'
      img.src = link.href
      img.onerror = function () {
        this.hidden = true
        var message = document.createElement('p')
        message.className = 'error-note'
        message.textContent = '此页图片加载失败，请重新加载；链接可能已失效。'
        this.parentNode.appendChild(message)
        retry.hidden = false
      }
      link.onclick = function (event) {
        event.preventDefault()
        previousFocus = this
        zoomImage.classList.add('expanded')
        var original = this.querySelector('img')
        zoomImage.style.setProperty('--image-width', (original.naturalWidth || 1800) + 'px')
        sizeButton.textContent = '适应屏幕'
        zoomImage.src = this.href
        zoomImage.alt = this.getAttribute('aria-label')
        zoom.hidden = false
        document.body.style.overflow = 'hidden'
        zoom.scrollTop = 0
        zoom.scrollLeft = 0
        document.getElementById('zoom-close').focus()
      }
      link.appendChild(img)
      card.appendChild(label)
      card.appendChild(link)
      pages.appendChild(card)
    }
  }
  async function load() {
    if (running) return
    running = true
    retry.hidden = true
    pages.textContent = ''
    status.textContent = '正在准备图片，请稍候...'
    try {
      for (var attempt = 0; attempt < 150; attempt++) {
        var controller = new AbortController()
        var timer = setTimeout(function () { controller.abort() }, 15000)
        var response
        try { response = await fetch(base + '/images', { cache: 'no-store', signal: controller.signal }) }
        finally { clearTimeout(timer) }
        if (response.status === 404) throw new Error('链接已失效或文档不存在，请联系工作人员。')
        if (response.status === 202) {
          await new Promise(function (resolve) { setTimeout(resolve, 2000) })
          continue
        }
        if (!response.ok) throw new Error('图片暂时无法准备，请稍后重试，也可以先下载 PDF。')
        var manifest = await response.json()
        if (manifest.state !== 'ready' || !Number.isInteger(manifest.pages) || manifest.pages < 1 || manifest.pages > 80) throw new Error('图片信息加载失败，请重试。')
        showPages(manifest)
        return
      }
      throw new Error('图片仍在准备中，请稍后重新加载。')
    } catch (error) {
      status.textContent = error.name === 'AbortError' || error instanceof TypeError ? '网络连接失败，请重新加载图片。' : error.message
      retry.hidden = false
    } finally { running = false }
  }
  retry.onclick = load
  load()
})()
