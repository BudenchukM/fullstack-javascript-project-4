import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';
import * as cheerio from 'cheerio';

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
  return new Promise((resolve) => {
    const absoluteUrl = new URL(resourceUrl, baseUrl).toString();
    
    axios.get(absoluteUrl, { responseType: 'arraybuffer' })
      .then(response => {
        const filename = generateFileName(absoluteUrl, true);
        const filepath = path.join(outputDir, filename);
        
        fs.writeFile(filepath, response.data)
          .then(() => resolve(filename))
          .catch(error => {
            console.error(`Failed to save resource ${resourceUrl}: ${error.message}`);
            resolve(null);
          });
      })
      .catch(error => {
        console.error(`Failed to download resource ${resourceUrl}: ${error.message}`);
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
  return new Promise((resolve, reject) => {
    axios.get(url)
      .then(response => {
        const pageName = generateFileName(url, false).replace('.html', '');
        const htmlFilename = `${pageName}.html`;
        const htmlPath = path.join(outputDir, htmlFilename);
        const resourcesDir = path.join(outputDir, `${pageName}_files`);
        
        // Создаем директорию для ресурсов
        fs.mkdir(resourcesDir, { recursive: true })
          .then(() => processHtml(response.data, url, resourcesDir))
          .then(processedHtml => fs.writeFile(htmlPath, processedHtml))
          .then(() => resolve(htmlPath))
          .catch(error => reject(new Error(`Failed to process page: ${error.message}`)));
      })
      .catch(error => reject(new Error(`Failed to download ${url}: ${error.message}`)));
  });
};
