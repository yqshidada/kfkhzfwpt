const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const PAGE_MARGIN = 36
const CONTENT_TOP = 760
const CONTENT_BOTTOM = 62
const BODY_LINE_HEIGHT = 17
const BODY_CHARS_PER_LINE = 39
const FIELD_VALUE_CHARS_PER_LINE = 32

function toUtf16beHex(value) {
	// UniGB-UCS2-H maps character codes directly; a BOM would render as a missing glyph on Linux.
	let hex = ''
	for (let index = 0; index < value.length; index += 1) {
		hex += value.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase()
	}
	return hex
}

function wrapText(value, charsPerLine = BODY_CHARS_PER_LINE) {
	const lines = []
	String(value || '').split('\n').forEach(paragraph => {
		if (!paragraph) {
			lines.push('')
			return
		}
		for (let start = 0; start < paragraph.length; start += charsPerLine) {
			lines.push(paragraph.slice(start, start + charsPerLine).replace(/^(\d+)\.\s*/, '$1.').replace(/[ⅠⅡⅢⅣ]/g, value => ({ 'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV' }[value])))
		}
	})
	return lines
}

function createReportLines(sections) {
	const lines = []
	sections.forEach(section => {
		if (section.title) lines.push({ kind: 'section', text: section.title, spacing: 28, keepWithNext: true })
		section.items.forEach(item => {
			if (item && item.image) {
				if (item.marginTop) lines.push({ kind: 'blank', text: '', spacing: item.marginTop })
				const width = item.width || item.image.width
				const height = width * item.image.height / item.image.width
				const marginBottom = item.marginBottom === undefined ? 10 : item.marginBottom
				lines.push({ kind: 'image', image: item.image, imageKey: item.imageKey, width, height, spacing: height + marginBottom, keepWithNext: item.keepWithNext })
				return
			}

			if (item.body) {
				if (item.marginTop) lines.push({ kind: 'blank', text: '', spacing: item.marginTop })
				wrapText(item.content).forEach(text => lines.push({ kind: 'body', text, spacing: BODY_LINE_HEIGHT, indent: item.indent || 0, bold: item.bold, flush: item.flush, fontSize: item.fontSize || 10.5, color: item.color || '0.18 0.21 0.25' }))
				return
			}

			if (typeof item === 'string') {
				const separatorIndex = item.indexOf('：')
				if (separatorIndex > -1) {
					const label = item.slice(0, separatorIndex + 1)
					const valueLines = wrapText(item.slice(separatorIndex + 1), FIELD_VALUE_CHARS_PER_LINE)
					const valueOffset = label.length * 10.5 + 2
					valueLines.forEach((text, index) => lines.push({ kind: 'field', label: index === 0 ? label : '', text, valueOffset, spacing: BODY_LINE_HEIGHT }))
				} else {
				wrapText(item).forEach(text => lines.push({ kind: 'body', text, spacing: BODY_LINE_HEIGHT, fontSize: 10.5, color: '0.18 0.21 0.25' }))
				}
				return
			}

			lines.push({ kind: item.group ? 'group' : 'subhead', text: item.title, spacing: 22, keepWithNext: true, color: item.color })
			if (item.content) {
				wrapText(item.content).forEach(text => lines.push({ kind: 'body', text, spacing: BODY_LINE_HEIGHT, context: item.title, indent: item.indent || 0 }))
			}
		})
		if (section.spacingAfter !== false) lines.push({ kind: 'blank', text: '', spacing: section.spacingAfter || 8 })
	})
	return lines
}

function buildPages(lines) {
	const pages = []
	let pageLines = []
	let usedHeight = 0
	let maxHeight = CONTENT_TOP - CONTENT_BOTTOM

	lines.forEach((line, index) => {
		const nextLine = lines[index + 1]
		const requiredHeight = line.keepWithNext && nextLine ? line.spacing + nextLine.spacing : line.spacing
		if (pageLines.length && usedHeight + requiredHeight > maxHeight) {
			pages.push(pageLines)
			pageLines = [line]
			usedHeight = pageLines.reduce((total, current) => total + current.spacing, 0)
			// Continued pages do not render the document title, leaving additional space for content.
			maxHeight = 805 - CONTENT_BOTTOM
			return
		}
		pageLines.push(line)
		usedHeight += line.spacing
	})

	if (pageLines.length) pages.push(pageLines)
	return pages
}

function textCommand(text, x, y, size, color = '0.16 0.20 0.24', bold = false) {
	const boldStyle = bold ? `${color} RG\n0.35 w\n2 Tr\n` : '0 Tr\n'
	return `${color} rg\nBT\n/F1 ${size} Tf\n${boldStyle}1 0 0 1 ${x} ${y} Tm\n<${toUtf16beHex(text)}> Tj\nET\n`
}

function imageCommand(x, y, width, height, imageKey) {
	return `q\n${width} 0 0 ${height} ${x} ${y} cm\n/Im${imageKey} Do\nQ\n`
}

function createPageStream(lines, pageIndex, pageCount, title) {
	let cursorY = pageIndex === 0 ? CONTENT_TOP : 805
	let stream = ''
	if (pageIndex === 0) {
		const titleX = (PAGE_WIDTH - title.length * 19) / 2
		stream += textCommand(title, titleX, 810, 19, '0.07 0.17 0.27')
	}

	lines.forEach(line => {
		if (line.kind === 'section') {
			stream += textCommand(line.text, PAGE_MARGIN, cursorY - 2, 13, '0.05 0.30 0.55')
			cursorY -= line.spacing
			return
		}

		if (line.kind === 'group') {
			stream += textCommand(line.text, PAGE_MARGIN + 11, cursorY, 11.5, line.color === 'red' ? '0.82 0.12 0.12' : '0.08 0.28 0.43')
		} else if (line.kind === 'subhead') {
			stream += textCommand(line.text, PAGE_MARGIN + 32, cursorY, 11.5, line.color === 'red' ? '0.82 0.12 0.12' : '0.08 0.28 0.43')
		} else if (line.kind === 'field') {
			if (line.label) stream += textCommand(line.label, PAGE_MARGIN + 12, cursorY, 10.5, '0.38 0.43 0.48')
					stream += textCommand(line.text, PAGE_MARGIN + 12 + (line.valueOffset || 0), cursorY, 10.5, '0.15 0.18 0.22')
		} else if (line.kind === 'image') {
			stream += imageCommand((PAGE_WIDTH - line.width) / 2, cursorY - line.height, line.width, line.height, line.imageKey)
		} else if (line.kind === 'body' && line.text) {
			const bodyX = line.flush ? PAGE_MARGIN : PAGE_MARGIN + 18 + (line.indent || 0) * 10.5
				stream += textCommand(line.text, bodyX, cursorY, line.fontSize || 10.5, line.color || '0.18 0.21 0.25', line.bold)
		}
		cursorY -= line.spacing
	})

	stream += textCommand(`第 ${pageIndex + 1} / ${pageCount} 页`, 490, 28, 9, '0.45 0.49 0.53')
	return stream
}

function toBase64(binary) {
	if (typeof uni !== 'undefined' && uni.arrayBufferToBase64) {
		const bytes = new Uint8Array(binary.length)
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
		return uni.arrayBufferToBase64(bytes.buffer)
	}
	return btoa(binary)
}

function fromBase64(value) {
	if (typeof uni !== 'undefined' && uni.base64ToArrayBuffer) {
		const bytes = new Uint8Array(uni.base64ToArrayBuffer(value))
		let binary = ''
		for (let index = 0; index < bytes.length; index += 8192) {
			binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 8192))
		}
		return binary
	}
	return atob(value)
}

export function generateDischargeReportPdf(sections, { title = '出院报告' } = {}) {
	const pages = buildPages(createReportLines(sections))
	const objects = []
	const pageObjectNumbers = pages.map((_, index) => 4 + index * 2)
	const imageObjectStart = 4 + pages.length * 2
	const imageAssets = []
	pages.forEach(page => page.forEach(line => {
		if (line.kind === 'image' && !imageAssets.some(asset => asset.imageKey === line.imageKey)) imageAssets.push(line)
	}))

	objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
	objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map(number => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`
	objects[3] = '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /DW 1000 >>] >>'

	pages.forEach((pageLines, index) => {
		const pageObjectNumber = pageObjectNumbers[index]
		const contentObjectNumber = pageObjectNumber + 1
		const stream = createPageStream(pageLines, index, pages.length, title)
		const imageResources = imageAssets.length
			? ` /XObject << ${imageAssets.map((asset, assetIndex) => `/Im${asset.imageKey} ${imageObjectStart + assetIndex} 0 R`).join(' ')} >>`
			: ''
		objects[pageObjectNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >>${imageResources} >> /Contents ${contentObjectNumber} 0 R >>`
		objects[contentObjectNumber] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`
	})

	imageAssets.forEach((asset, assetIndex) => {
		const imageBinary = fromBase64(asset.image.data)
		objects[imageObjectStart + assetIndex] = `<< /Type /XObject /Subtype /Image /Width ${asset.image.width} /Height ${asset.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBinary.length} >>\nstream\n${imageBinary}\nendstream`
	})

	let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
	const offsets = [0]
	for (let number = 1; number < objects.length; number += 1) {
		offsets[number] = pdf.length
		pdf += `${number} 0 obj\n${objects[number]}\nendobj\n`
	}

	const xrefOffset = pdf.length
	pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
	for (let number = 1; number < objects.length; number += 1) {
		pdf += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`
	}
	pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
	return toBase64(pdf)
}
