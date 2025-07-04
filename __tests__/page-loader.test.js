import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import nock from 'nock'
import * as cheerio from 'cheerio'
import downloadPage from '../src/page-loader.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('page-loader (promise version)', () => {
  let tempDir
  const baseUrl = 'https://ru.hexlet.io'
  const pageUrl = `${baseUrl}/courses`

  let originalHtml

  beforeAll(async () => {
  const fixturesPath = path.join(__dirname, '../__fixtures__/hexlet-page')
  originalHtml = await fs.readFile(path.join(fixturesPath, 'original.html'), 'utf-8')
  })

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-loader-'))

    nock(baseUrl)
      .persist()
      .get('/courses')
      .reply(200, originalHtml)

    nock(baseUrl)
      .get('/assets/application.css')
      .reply(200, 'body { color: red; }', { 'Content-Type': 'text/css' })

    nock(baseUrl)
      .get('/assets/professions/nodejs.png')
      .reply(200, 'image-data', { 'Content-Type': 'image/png' })

    nock(baseUrl)
      .get('/packs/js/runtime.js')
      .reply(200, 'console.log("runtime")', { 'Content-Type': 'application/javascript' })
  })

  afterEach(async () => {
    nock.cleanAll()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  test('should download page with resources using promises', async () => {
    const htmlPath = await downloadPage(pageUrl, tempDir)

    // Проверяем основной HTML файл
    await expect(fs.access(htmlPath)).resolves.toBeUndefined()

    // Проверяем содержимое HTML
    const html = await fs.readFile(htmlPath, 'utf-8')
    const $ = cheerio.load(html)

    // Проверяем замену ссылок
    expect($('link[rel="stylesheet"][href*="application.css"]').attr('href'))
      .toMatch(/ru-hexlet-io-courses_files\/ru-hexlet-io-assets-application\.css/)

    // Проверяем директорию ресурсов
    const pageName = 'ru-hexlet-io-courses'
    const resourcesDir = path.join(tempDir, `${pageName}_files`)
    await expect(fs.access(resourcesDir)).resolves.toBeUndefined()

    // Проверяем скачанные ресурсы
    const files = await fs.readdir(resourcesDir)
    expect(files).toEqual(expect.arrayContaining([
      'ru-hexlet-io-assets-application.css',
      'ru-hexlet-io-assets-professions-nodejs.png',
      'ru-hexlet-io-packs-js-runtime.js',
    ]))
  })
})
