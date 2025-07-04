import downloadPage from '../src/page-loader.js'
import fs from 'fs/promises'
import nock from 'nock'

describe('Progress indication', () => {
  let tempDir
  const testUrl = 'https://example.com'

  beforeEach(async () => {
    tempDir = await fs.mkdtemp('/tmp/page-loader-')

    nock('https://example.com')
      .get('/')
      .reply(200, `
        <html>
          <link href="/style.css" rel="stylesheet">
          <img src="/image.png">
          <script src="/script.js"></script>
        </html>
      `)

    nock('https://example.com')
      .get('/style.css')
      .reply(200, 'body { color: red; }')

    nock('https://example.com')
      .get('/image.png')
      .reply(200, 'image-data')

    nock('https://example.com')
      .get('/script.js')
      .reply(200, 'console.log("hello")')
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true })
    nock.cleanAll()
  })

  test('should show progress for resources download', async () => {
    await expect(downloadPage(testUrl, tempDir)).resolves.toBeTruthy()
  })
})
