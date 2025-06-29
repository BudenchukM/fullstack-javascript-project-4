import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import nock from 'nock';
import downloadPage from '../src/page-loader.js';

describe('page-loader', () => {
  let tempDir;
  const url = 'https://ru.hexlet.io/courses';
  const expectedFilename = 'ru-hexlet-io-courses.html';
  const htmlContent = '<html><body>Test content</body></html>';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-loader-'));
    nock('https://ru.hexlet.io').get('/courses').reply(200, htmlContent);
  });

  afterEach(async () => {
    nock.cleanAll();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('should download page and save to file', async () => {
    const filepath = await downloadPage(url, tempDir);
    expect(filepath).toBe(path.join(tempDir, expectedFilename));
    
    const content = await fs.readFile(filepath, 'utf-8');
    expect(content).toBe(htmlContent);
  });

  test('should use current directory if output not specified', async () => {
    const filepath = await downloadPage(url);
    expect(filepath).toBe(path.join(process.cwd(), expectedFilename));
    await fs.unlink(filepath);
  });

  test('should throw error for invalid URL', async () => {
    await expect(downloadPage('invalid-url')).rejects.toThrow();
  });

  test('should throw error when server not responding', async () => {
    nock('https://ru.hexlet.io').get('/courses').reply(404);
    await expect(downloadPage(url)).rejects.toThrow();
  });
});
