import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';
import * as cheerio from 'cheerio';
import debug from 'debug';

// Создаем логгеры для разных компонентов
const log = debug('page-loader');
const logDownload = debug('page-loader:download');
const logResources = debug('page-loader:resources');
const logFS = debug('page-loader:fs');

// Включение логирования для axios и nock
process.env.DEBUG = 'page-loader*,axios,nock';

const isLocalResource = (baseUrl, resourceUrl) => {
  try {
    const base = new URL(baseUrl);
    const resource = new URL(resourceUrl, base);
    return resource.hostname === base.hostname;
  } catch {
    return false;
  }
};

const generateFileName = (urlString, isResource = false) => {
  const url = new URL(urlString);
  let nameParts = [url.hostname];
  const pathParts = url.pathname.split('/').filter(Boolean);

  if (isResource && pathParts.length > 0) {
    if (pathParts.length > 1) {
      nameParts = nameParts.concat(pathParts.slice(0, -1));
    }
    const fileName = pathParts[pathParts.length - 1];
    nameParts.push(fileName.replace(path.extname(fileName), ''));
  } else {
    nameParts = nameParts.concat(pathParts);
  }

  let name = nameParts.join('-')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (isResource) {
    const ext = path.extname(url.pathname);
    return ext ? `${name}${ext}` : name;
  }
  
  return `${name}.html`;
};

const downloadResource = (baseUrl, resourceUrl, outputDir) => {
  logDownload('Starting resource download: %s', resourceUrl);
  return new Promise((resolve) => {
    const absoluteUrl = new URL(resourceUrl, baseUrl).toString();
    
    axios.get(absoluteUrl, { responseType: 'arraybuffer' })
      .then(response => {
        logDownload('Successfully downloaded: %s, size: %d', resourceUrl, response.data.length);
        const filename = generateFileName(absoluteUrl, true);
        const filepath = path.join(outputDir, filename);
        
        fs.writeFile(filepath, response.data)
          .then(() => {
            logFS('File saved: %s', filepath);
            resolve(filename);
          })
          .catch(error => {
            logFS('Error saving file %s: %o', filepath, error);
            resolve(null);
          });
      })
      .catch(error => {
        logDownload('Download failed for %s: %o', resourceUrl, error);
        resolve(null);
      });
  });
};

const processHtml = (html, baseUrl, resourcesDir) => {
  return new Promise((resolve) => {
    const $ = cheerio.load(html);
    const resourcePromises = [];
    const resourcesDirName = path.basename(resourcesDir);

    const tagsToProcess = [
      { selector: 'img[src]', attr: 'src' },
      { selector: 'link[href][rel="stylesheet"]', attr: 'href' },
      { selector: 'script[src]', attr: 'src' },
    ];

    tagsToProcess.forEach(({ selector, attr }) => {
      $(selector).each((i, element) => {
        const resourceUrl = $(element).attr(attr);
        if (resourceUrl && isLocalResource(baseUrl, resourceUrl)) {
          const promise = downloadResource(baseUrl, resourceUrl, resourcesDir)
            .then(filename => {
              if (filename) {
                $(element).attr(attr, `${resourcesDirName}/${filename}`);
              }
            });
          resourcePromises.push(promise);
        }
      });
    });

    Promise.all(resourcePromises)
      .then(() => resolve($.html()))
      .catch(() => resolve($.html()));
  });
};

export const downloadPage = (url, outputDir = process.cwd()) => {
  log('Starting page download: %s to %s', url, outputDir);
  return new Promise((resolve, reject) => {
    axios.get(url)
      .then(response => {
        log('Page downloaded successfully: %s, size: %d', url, response.data.length);
        const pageName = generateFileName(url, false).replace('.html', '');
        const resourcesDir = path.join(outputDir, `${pageName}_files`);
        
        fs.mkdir(resourcesDir, { recursive: true })
          .then(() => {
            logFS('Directory created: %s', resourcesDir);
            return processHtml(response.data, url, resourcesDir);
          })
          .then(processedHtml => {
            const htmlPath = path.join(outputDir, `${pageName}.html`);
            return fs.writeFile(htmlPath, processedHtml)
              .then(() => {
                logFS('HTML saved: %s', htmlPath);
                resolve(htmlPath);
              });
          })
          .catch(error => {
            log('Error processing page: %o', error);
            reject(new Error(`Failed to process page: ${error.message}`));
          });
      })
      .catch(error => {
        log('Page download failed: %o', error);
        reject(new Error(`Failed to download ${url}: ${error.message}`));
      });
  });
};
