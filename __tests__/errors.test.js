import downloadPage from '../src/page-loader.js'
import fs from 'fs/promises'
import nock from 'nock'
import path from 'path'

describe('Error handling with promises', () => {
  let tempDir

  beforeAll(async () => {
    tempDir = await fs.mkdtemp('/tmp/page-loader-');
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  })

  test('should reject on network errors', async () => {
    await expect(downloadPage('https://nonexistent-site.test'))
      .rejects
      .toThrow(/could not resolve host/);
  })

  test('should reject on 404 responses', async () => {
    nock('https://example.com')
      .get('/missing')
      .reply(404)

    await expect(downloadPage('https://example.com/missing'))
      .rejects
      .toThrow(/Request failed with status 404/)
  })

  test('should reject on read-only directory', async () => {
    const readOnlyDir = path.join(tempDir, 'readonly')
    await fs.mkdir(readOnlyDir, { mode: 0o555 }) // read-only

    await expect(downloadPage('https://example.com', readOnlyDir))
      .rejects
      .toThrow(/not writable/)
  })

  test('should resolve even if some resources fail', async () => {
    nock('https://example.com')
      .get('/')
      .reply(200, '<img src="/missing.png">')

    nock('https://example.com')
      .get('/missing.png')
      .reply(404)

    await expect(downloadPage('https://example.com', tempDir))
      .resolves
      .toBeTruthy()
  })
})
