// Use the same Vue 2 compiler as this HBuilderX installation; no new dependency.
const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')
const root = path.resolve(__dirname, '..')
const hbuilder = process.argv[2] || process.env.HBUILDERX_HOME
if (!hbuilder) throw Error('Pass the HBuilderX installation directory as the first argument')
const compiler = require(path.join(hbuilder, 'plugins/uniapp-cli/node_modules/vue-template-compiler'))
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? files(file) : file.endsWith('.vue') ? [file] : []
  })
}
// Reproduce the reported error to ensure this regression test catches an extra root.
assert.ok(compiler.compile('<text>error</text><view>page</view>').errors.some(error => String(error).includes('exactly one root element')))
const pages = files(path.join(root, 'pages')).concat(files(path.join(root, 'components')))
for (const file of pages) {
  const descriptor = compiler.parseComponent(fs.readFileSync(file, 'utf8'))
  assert.ok(descriptor.template, 'Missing template: ' + file)
  const result = compiler.compile(descriptor.template.content)
  assert.deepEqual(result.errors, [], path.relative(root, file) + ': template must compile without errors')
  if (file.endsWith(path.join('bed-reservation', 'index.vue'))) {
    assert.equal(result.ast.tag, 'view')
    const errors = []
    function visit(node) {
      if (node.type !== 1) return
      if (node.attrsMap.class === 'field-error') errors.push(node)
      for (const child of node.children || []) visit(child)
    }
    visit(result.ast)
    assert.equal(errors.length, 12, 'All twelve field errors must be inside the single page root')
    const optionalDate = errors.find(node => node.attrsMap['v-if'] === 'fieldErrors.reservationDate')
    assert.ok(optionalDate.parent.children.some(node => node.tag === 'view' && node.children.some(child => child.text === '预约日期（选填）')))
    assert.ok(!optionalDate.parent.children.some(node => node.tag === 'view' && node.children.some(child => child.tag === 'text' && child.attrsMap.class === 'required')), 'Optional date has no required star')
    for (const error of errors) assert.equal(error.parent.attrsMap.class.includes('form-field'), true, 'Error belongs under its input field')
  }
}
const arrowStyles = fs.readFileSync(path.join(root, 'static/styles/picker-arrow.css'), 'utf8')
assert.ok(arrowStyles.includes('.picker-arrow, .status-select-arrow'))
assert.ok(arrowStyles.includes('.picker-arrow::after, .status-select-arrow::after'))
for (const relative of ['pages/bed-reservation/index.vue', 'pages/hzjbxx/index.vue', 'pages/nurse/list.vue']) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  assert.ok(source.includes('@import "../../static/styles/picker-arrow.css"'), relative + ': must reuse shared arrow styles')
  assert.ok(!source.includes('<text class="picker-arrow">'), relative + ': no font-baseline arrow')
}
console.log('PASS: ' + pages.length + ' Vue page templates compile; reservation page has one root and twelve correctly nested error hints; all picker arrows use shared centered styles')
