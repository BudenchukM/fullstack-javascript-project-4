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
  singleAttributePerLine: false
};

class PageLoaderError extends Error {
  constructor(message, code = 'UNKNOWN') {
    super(message);
    this.name = 'PageLoaderError';
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
  const absoluteUrl = new URL(resourceUrl, baseUrl).toString();
  log(`Starting download: ${absoluteUrl}`);

  return axios.get(absoluteUrl, {
    responseType: 'arraybuffer',
    validateStatus: (status) => status === 200
  })
    .then(response => {
      const filename = generateFileName(absoluteUrl, true);
      const filepath = path.join(outputDir, filename);
      
      return fs.writeFile(filepath, response.data)
        .then(() => {
          log(`Resource saved: ${filepath}`);
          return { success: true, filename };
        });
    })
    .catch(error => {
      log(`Download failed: ${resourceUrl}`, error.message);
      return { success: false, error: error.message };
    });
};

const processHtmlWithProgress = (html, baseUrl, resourcesDir) => {
  return new Promise((resolve) => {
    const $ = cheerio.load(html, {
      decodeEntities: false,
      xmlMode: false,
      recognizeSelfClosing: true
    });

    const resources = [];
    const tagsToProcess = [
      { selector: 'img[src]', attr: 'src' },
      { selector: 'link[href][rel="stylesheet"]', attr: 'href' },
      { selector: 'script[src]', attr: 'src' },
    ];

    tagsToProcess.forEach(({ selector, attr }) => {
      $(selector).each((i, element) => {
        const resourceUrl = $(element).attr(attr);
        if (resourceUrl && isLocalResource(baseUrl, resourceUrl)) {
          resources.push({
            url: resourceUrl,
            element: $(element),
            attr
          });
        }
      });
    });

    if (resources.length === 0) {
      return resolve(html);
    }

    const tasks = resources.map(resource => ({
      title: `Downloading ${resource.url}`,
      task: () => downloadResource(baseUrl, resource.url, resourcesDir)
        .then(({ success, filename }) => {
          if (success) {
            resource.element.attr(resource.attr, 
              `${path.basename(resourcesDir)}/${filename}`);
          }
        })
    }));

    new Listr(tasks, { 
      concurrent: true,
      exitOnError: false 
    })
      .run()
      .then(() => {
        const formattedHtml = prettier.format($.html(), prettierOptions);
        resolve(formattedHtml);
      })
      .catch(() => {
        resolve($.html());
      });
  });
};

export default function downloadPage(url, outputDir = process.cwd()) {
  return new Promise((resolve, reject) => {
    log(`Starting download: ${url}`);

    fs.access(outputDir, fs.constants.W_OK)
      .then(() => axios.get(url, {
        validateStatus: (status) => status === 200
      }))
      .then(response => {
        const pageName = generateFileName(url, false).replace('.html', '');
        const resourcesDir = path.join(outputDir, `${pageName}_files`);

        return fs.mkdir(resourcesDir, { recursive: true })
          .then(() => ({ response, pageName, resourcesDir }));
      })
      .then(({ response, pageName, resourcesDir }) => {
        return processHtmlWithProgress(response.data, url, resourcesDir)
          .then(processedHtml => {
            const mainHtmlPath = path.join(outputDir, `${pageName}.html`);
            const formattedHtml = prettier.format(processedHtml, prettierOptions);
            
            return fs.writeFile(mainHtmlPath, formattedHtml)
              .then(() => mainHtmlPath);
          });
      })
      .then(htmlPath => {
        log(`Download completed: ${htmlPath}`);
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

        reject(new PageLoaderError(message, error.code));
      });
  });
}
