import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';
import * as cheerio from 'cheerio';

const generateNameParts = (urlString) => {
  const url = new URL(urlString);
  const pathParts = url.pathname.split('/').filter(Boolean);
  
  let name = `${url.hostname}-${pathParts.join('-')}`;
  name = name.replace(/[^a-zA-Z0-9]/g, '-');
  name = name.replace(/-+/g, '-');
  name = name.replace(/^-|-$/g, '');
  
  return name;
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
  
  return axios.get(absoluteUrl, { responseType: 'arraybuffer' })
    .then(response => {
      const filename = generateFileName(absoluteUrl, true);
      const filepath = path.join(outputDir, filename);
      
      return fs.writeFile(filepath, response.data)
        .then(() => filename);
    })
    .catch(error => {
      console.error(`Failed to download resource ${resourceUrl}: ${error.message}`);
      return null;
    });
};

const processHtml = (html, baseUrl, resourcesDir) => {
  const $ = cheerio.load(html);
  const resourcePromises = [];
  const resourcesDirName = path.basename(resourcesDir);
  
  $('img[src]').each((i, element) => {
    const resourceUrl = $(element).attr('src');
    if (!resourceUrl.startsWith('data:') && !resourceUrl.startsWith('http')) {
      const promise = downloadResource(baseUrl, resourceUrl, resourcesDir)
        .then(filename => {
          if (filename) {
            $(element).attr('src', path.join(resourcesDirName, filename));
          }
        });
      resourcePromises.push(promise);
    }
  });
  
  return Promise.all(resourcePromises)
    .then(() => $.html());
};

export const downloadPage = (url, outputDir = process.cwd()) => {
  return axios.get(url)
    .then(response => {
      const pageName = generateNameParts(url);
      const htmlFilename = `${pageName}.html`;
      const htmlPath = path.join(outputDir, htmlFilename);
      const resourcesDir = `${pageName}_files`;
      const resourcesDirPath = path.join(outputDir, resourcesDir);
      
      return fs.mkdir(resourcesDirPath, { recursive: true })
        .then(() => processHtml(response.data, url, resourcesDirPath))
        .then(processedHtml => fs.writeFile(htmlPath, processedHtml))
        .then(() => htmlPath);
    })
    .catch(error => {
      throw new Error(`Failed to download ${url}: ${error.message}`);
    });
};
