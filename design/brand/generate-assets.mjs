// Run from any directory: node design/brand/generate-assets.mjs
// Uses the existing E2E Chromium installation; adds no application dependency.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../e2e/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const source = new URL('./source/', import.meta.url)
const output = new URL('../../frontend/public/brand/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const wordmark = await readFile(new URL('dondok_wordmark.svg', source), 'utf8')
  const icon = await readFile(new URL('dondok_app_icon.svg', source), 'utf8')
  const assets = await page.evaluate(({ wordmark, icon }) => {
    const ns = 'http://www.w3.org/2000/svg'
    function svgFromPaths(text, { dark = false, maskable = false } = {}) {
      const document = new DOMParser().parseFromString(text, 'image/svg+xml')
      if (document.querySelector('parsererror')) throw new Error('Invalid source SVG')
      const source = document.documentElement
      const svg = document.createElementNS(ns, 'svg')
      for (const name of ['viewBox', 'width', 'height']) svg.setAttribute(name, source.getAttribute(name))
      const title = document.createElementNS(ns, 'title')
      title.textContent = '돈독'
      svg.append(title)
      let container = svg
      if (maskable) {
        const background = document.createElementNS(ns, 'rect')
        background.setAttribute('width', '1024')
        background.setAttribute('height', '1024')
        background.setAttribute('fill', '#DBEE8B')
        svg.append(background)
        container = document.createElementNS(ns, 'g')
        // Keep the supplied dd paths inside the central maskable safe circle.
        container.setAttribute('transform', 'translate(102.4 102.4) scale(.8)')
        svg.append(container)
      }
      for (const path of source.querySelectorAll('path')) {
        if (maskable && path.id === 'app-icon-background') continue
        const copy = document.createElementNS(ns, 'path')
        for (const name of ['d', 'fill', 'fill-rule']) {
          const value = path.getAttribute(name)
          if (value) copy.setAttribute(name, dark && value === '#19463C' ? '#DBEE8B' : value)
        }
        container.append(copy)
      }
      return new XMLSerializer().serializeToString(svg) + '\n'
    }
    return {
      'dondok-wordmark.svg': svgFromPaths(wordmark),
      'dondok-wordmark-dark.svg': svgFromPaths(wordmark, { dark: true }),
      'dondok-app-icon.svg': svgFromPaths(icon),
      'dondok-app-icon-maskable.svg': svgFromPaths(icon, { maskable: true }),
    }
  }, { wordmark, icon })
  for (const [name, svg] of Object.entries(assets)) await writeFile(new URL(name, output), svg)
  for (const [name, size, sourceName] of [
    ['favicon-32.png', 32, 'dondok-app-icon.svg'],
    ['app-icon-192.png', 192, 'dondok-app-icon.svg'],
    ['app-icon-512.png', 512, 'dondok-app-icon.svg'],
    ['app-icon-maskable-512.png', 512, 'dondok-app-icon-maskable.svg'],
    ['apple-touch-icon.png', 180, 'dondok-app-icon-maskable.svg'],
  ]) {
    const svgData = Buffer.from(assets[sourceName]).toString('base64')
    const png = await page.evaluate(async ({ svgData, size }) => {
      const image = new Image()
      image.src = 'data:image/svg+xml;base64,' + svgData
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(image, 0, 0, size, size)
      return canvas.toDataURL('image/png').split(',')[1]
    }, { svgData, size })
    await writeFile(new URL(name, output), Buffer.from(png, 'base64'))
  }
  console.log('Brand SVG and PNG assets generated in ' + fileURLToPath(output))
} finally {
  await browser.close()
}
