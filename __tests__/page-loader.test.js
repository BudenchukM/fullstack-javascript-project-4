import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import nock from 'nock';
import cheerio from 'cheerio';
import { downloadPage } from '../src/page-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('page-loader with fixtures', () => {
  let tempDir;
  const baseUrl = 'https://ru.hexlet.io';
  const pageUrl = `${baseUrl}/courses`;
  
  let originalHtml;
  let expectedHtml;
  let imageBuffer;

  beforeAll(async () => {
    const fixturesPath = path.join(__dirname, '../__fixtures__/hexlet-page');
    originalHtml = await fs.readFile(path.join(fixturesPath, 'original.html'), 'utf-8');
    expectedHtml = await fs.readFile(path.join(fixturesPath, 'expected.html'), 'utf-8');
    imageBuffer = await fs.readFile(path.join(fixturesPath, 'image.png'));
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-loader-'));
    
    nock(baseUrl)
      .get('/courses')
      .reply(200, originalHtml);
    
    nock(baseUrl)
      .get('/assets/professions/nodejs.png')
      .reply(200, imageBuffer, { 'Content-Type': 'image/png' });
  });

  afterEach(async () => {
    nock.cleanAll();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test('should download page and modify HTML exactly as in fixture', async () => {
    const htmlPath = await downloadPage(pageUrl, tempDir);
    
    const resultHtml = await fs.readFile(htmlPath, 'utf-8');
    
    const normalizeHtml = (html) => {
      const $ = cheerio.load(html);
      return $.html();
    };
    
    expect(normalizeHtml(resultHtml)).toBe(normalizeHtml(expectedHtml));
    
    const resourcesDir = path.join(tempDir, 'ru-hexlet-io-courses_files');
    const files = await fs.readdir(resourcesDir);
    expect(files).toEqual(['ru-hexlet-io-assets-professions-nodejs.png']);
  });
});
