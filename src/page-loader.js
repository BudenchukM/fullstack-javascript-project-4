import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';
import * as cheerio from 'cheerio';
import debug from 'debug';

const log = debug('page-loader');
const logDownload = debug('page-loader:download');
const logResources = debug('page-loader:resources');
const logFS = debug('page-loader:fs');

process.env.DEBUG = 'page-loader*,axios,nock';

class PageLoaderError extends Error {
  constructor(message, code = 'UNKNOWN') {
    super(message);
    this.code = code;
  }
}

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
  log(`Downloading resource: ${resourceUrl}`);
  
  return new Promise((resolve) => {
    const absoluteUrl = new URL(resourceUrl, baseUrl).toString();
    
    axios.get(absoluteUrl, {
      responseType: 'arraybuffer',
      validateStatus: (status) => status === 200
    })
      .then(response => {
        const filename = generateFileName(absoluteUrl, true);
        const filepath = path.join(outputDir, filename);
        
        fs.writeFile(filepath, response.data)
          .then(() => {
            log(`Resource saved: ${filepath}`);
            resolve(filename);
          })
          .catch(error => {
            log(`Failed to save resource: ${filepath}`);
            resolve(null);
          });
      })
      .catch(error => {
        log(`Download failed for ${resourceUrl}: ${error.message}`);
        resolve(null);
      });
  });
};

const processHtml = (html, baseUrl, resourcesDir) => {
  return new Promise((resolve) => {
    try {
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
    } catch (error) {
      resolve(html);
    }
  });
};

export const downloadPage = (url, outputDir = process.cwd()) => {
  log(`Starting download: ${url} to ${outputDir}`);
  
  return new Promise((resolve, reject) => {
    // Проверка доступности директории
    fs.access(outputDir, fs.constants.W_OK)
      .then(() => {
        return axios.get(url, {
          validateStatus: (status) => status === 200
        });
      })
      .then(response => {
        const pageName = generateFileName(url, false).replace('.html', '');
        const resourcesDir = path.join(outputDir, `${pageName}_files`);
        
        return fs.mkdir(resourcesDir, { recursive: true })
          .then(() => ({ response, pageName, resourcesDir }));
      })
      .then(({ response, pageName, resourcesDir }) => {
        return processHtml(response.data, url, resourcesDir)
          .then(processedHtml => {
            const htmlPath = path.join(outputDir, `${pageName}.html`);
            return fs.writeFile(htmlPath, processedHtml)
              .then(() => htmlPath);
          });
      })
      .then(htmlPath => {
        log(`Page successfully saved: ${htmlPath}`);
        resolve(htmlPath);
      })
      .catch(error => {
        let message;
        
        if (error.code === 'ENOTFOUND') {
          message = `Network error: could not resolve host for ${url}`;
        } else if (error.code === 'EACCES') {
          message = `Output directory is not writable: ${outputDir}`;
        } else if (error.response) {
          message = `Request failed with status ${error.response.status}`;
        } else {
          message = error.message;
        }
        
        const loaderError = new PageLoaderError(
          error.code === 'ENOTFOUND' 
            ? message
            : `Failed to download ${url}: ${message}`,
          error.code || 'PAGE_DOWNLOAD_FAILED'
        );
        
        log(`Error: ${loaderError.message}`);
        reject(loaderError);
      });
  });
};
