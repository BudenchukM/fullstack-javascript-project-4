import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import { URL } from 'url';
import * as cheerio from 'cheerio';
import debug from 'debug';
import Listr from 'listr';
import prettier from 'prettier';

const log = debug('page-loader');

const prettierOptions = {
  parser: 'html',
  htmlWhitespaceSensitivity: 'ignore',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  bracketSameLine: false,
  singleAttributePerLine: false,
};

class PageLoaderError extends Error {
  constructor(message, code = 'UNKNOWN') {
    super(message);
    this.name = 'PageLoaderError';
    this.code = code;
  }
}

const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const isLocalResource = (baseUrl, resourceUrl) => {
  if (!isValidUrl(baseUrl) || !resourceUrl) return false;
  
  try {
    const base = new URL(baseUrl);
    const resource = new URL(resourceUrl, base);
    return resource.hostname === base.hostname;
  } catch {
    return false;
  }
};

const generateFileName = (urlString, isResource = false) => {
  if (!isValidUrl(urlString)) {
    throw new PageLoaderError(`Invalid URL: ${urlString}`, 'EINVALIDURL');
  }

  const url = new URL(urlString);
  let name = url.hostname.replace(/\./g, '-') + 
    url.pathname.replace(/\//g, '-').replace(/-+$/, '');

  if (!isResource) {
    return name.endsWith('.html') ? name : `${name}.html`;
  }

  const pathParts = url.pathname.split('/').pop().split('.');
  const hasExtension = pathParts.length > 1;
  const extension = hasExtension ? pathParts.pop() : 'html';

  name = name.replace(new RegExp(`\\.${extension}$`), '');
  return `${name}.${extension}`;
};

const downloadResource = (absoluteUrl, outputDir) => {
  if (!isValidUrl(absoluteUrl)) {
    return Promise.reject(new PageLoaderError(`Invalid URL: ${absoluteUrl}`, 'EINVALIDURL'));
  }

  const filename = generateFileName(absoluteUrl, true);
  const filepath = path.join(outputDir, filename);

  return axios.get(absoluteUrl, {
    responseType: 'arraybuffer',
    validateStatus: status => status === 200,
  })
    .then((response) => {
      const data = Buffer.isBuffer(response.data) 
        ? response.data 
        : Buffer.from(response.data);
      return fs.writeFile(filepath, data)
        .then(() => filename);
    })
    .catch((error) => {
      log(`Download failed: ${absoluteUrl}`, error.message);
      throw error;
    });
};

const prepareDownloadTasks = (html, baseUrl, resourcesDir) => {
  if (!isValidUrl(baseUrl)) {
    throw new PageLoaderError(`Invalid base URL: ${baseUrl}`, 'EINVALIDURL');
  }

  const $ = cheerio.load(html);
  const resources = [];
  const tagsToProcess = [
    { selector: 'img[src]', attr: 'src' },
    { selector: 'link[href][rel="stylesheet"]', attr: 'href' },
    { selector: 'script[src]', attr: 'src' },
    { selector: 'a[href$=".html"], a[href*=".html?"]', attr: 'href' },
  ];

  const resourcesBaseName = path.basename(resourcesDir);

  tagsToProcess.forEach(({ selector, attr }) => {
    $(selector).each((i, element) => {
      const resourceUrl = $(element).attr(attr);
      if (resourceUrl && isLocalResource(baseUrl, resourceUrl)) {
        try {
          const filename = generateFileName(resourceUrl, true);
          const newPath = `${resourcesBaseName}/${filename}`;
          
          $(element).attr(attr, newPath);
          
          resources.push({
            absoluteUrl: new URL(resourceUrl, baseUrl).toString(),
            filename,
            outputDir: resourcesDir
          });
        } catch (error) {
          log(`Skipping resource due to error: ${resourceUrl}`, error.message);
        }
      }
    });
  });

  return {
    html: prettier.format($.html(), prettierOptions),
    tasks: resources.map(({ absoluteUrl, outputDir }) => ({
      title: `Downloading ${absoluteUrl}`,
      task: () => downloadResource(absoluteUrl, outputDir)
        .catch(() => {}) // Игнорируем ошибки загрузки ресурсов
    }))
  };
};

export default function downloadPage(url, outputDir = process.cwd()) {
  if (!isValidUrl(url)) {
    return Promise.reject(new PageLoaderError(`Invalid URL: ${url}`, 'EINVALIDURL'));
  }

  log(`Starting download: ${url}`);

  return fs.access(outputDir, fs.constants.W_OK)
    .then(() => axios.get(url))
    .then((response) => {
      const pageName = generateFileName(url);
      const resourcesDir = path.join(outputDir, `${pageName.replace('.html', '')}_files`);
      const htmlFilePath = path.join(outputDir, pageName);

      return fs.mkdir(resourcesDir, { recursive: true })
        .then(() => {
          const { html, tasks } = prepareDownloadTasks(response.data, url, resourcesDir);
          
          if (tasks.length === 0) {
            return fs.writeFile(htmlFilePath, html);
          }

          return new Listr(tasks, {
            concurrent: true,
            exitOnError: false,
          }).run()
            .then(() => fs.writeFile(htmlFilePath, html));
        })
        .then(() => ({
          htmlPath: htmlFilePath,
          resourcesDir: resourcesDir
        }));
    })
    .catch((error) => {
      let message;
      let code = error.code || 'UNKNOWN';

      if (error instanceof PageLoaderError) {
        message = error.message;
        code = error.code;
      } else if (error.code === 'ENOTFOUND') {
        message = `Network error: could not resolve host for ${url}`;
      } else if (error.code === 'ECONNREFUSED') {
        message = `Connection refused (${url})`;
      } else if (error.response) {
        message = `Request failed with status ${error.response.status}`;
      } else if (error.code === 'ETIMEDOUT') {
        message = `Request timeout (${url})`;
      } else if (error.code === 'EACCES') {
        message = `Permission denied for ${outputDir}`;
      } else if (error.code === 'ENOENT') {
        message = `Directory not found: ${outputDir}`;
      } else if (error.code === 'ENOTDIR') {
        message = `Not a directory: ${outputDir}`;
      } else {
        message = error.message || 'Unknown error';
      }
      
      log(`Error occurred: ${message}`);
      throw new PageLoaderError(message, code);
    });
}
