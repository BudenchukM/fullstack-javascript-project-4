import axios from 'axios'
import { promises as fs } from 'fs'
import path from 'path'
import { URL } from 'url'
import * as cheerio from 'cheerio'
import debug from 'debug'
import Listr from 'listr'
import prettier from 'prettier'

const log = debug('page-loader')

const prettierOptions = {
  parser: 'html',
  htmlWhitespaceSensitivity: 'ignore',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  bracketSameLine: false,
  singleAttributePerLine: false,
}

class PageLoaderError extends Error {
  constructor(message, code = 'UNKNOWN') {
    super(message)
    this.name = 'PageLoaderError'
    this.code = code
  }
}

const isLocalResource = (baseUrl, resourceUrl) => {
  try {
    const base = new URL(baseUrl)
    const resource = new URL(resourceUrl, base)
    return resource.hostname === base.hostname
  }
  catch {
    return false
  }
}

const generateFileName = (urlString, isResource = false) => {
  const url = new URL(urlString)
  let name = url.hostname.replace(/\./g, '-')
    + url.pathname.replace(/\//g, '-')
      .replace(/-+$/, '')

  // Для основной страницы всегда .html
  if (!isResource) {
    return name.endsWith('.html') ? name : `${name}.html`
  }

  // Для ресурсов - извлекаем расширение из пути
  const pathParts = url.pathname.split('/').pop().split('.')
  const hasExtension = pathParts.length > 1
  const extension = hasExtension ? pathParts.pop() : 'html'

  // Удаляем существующее расширение из имени, если есть
  name = name.replace(new RegExp(`\\.${extension}$`), '')

  return `${name}.${extension}`
}

const downloadResource = (baseUrl, resourceUrl, outputDir) => {
  const absoluteUrl = new URL(resourceUrl, baseUrl).toString()
  log(`Starting download: ${absoluteUrl}`)

  const filename = generateFileName(absoluteUrl, true)
  const filepath = path.join(outputDir, filename)

  return axios.get(absoluteUrl, {
    responseType: 'arraybuffer',
    validateStatus: status => status === 200,
  })
    .then((response) => {
      const data = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data)

      return fs.writeFile(filepath, data)
        .then(() => {
          log(`Resource saved: ${filepath}`)
          return { success: true, filename }
        })
    })
    .catch((error) => {
      log(`Download failed: ${resourceUrl}`, error.message)
      return { success: false, error: error.message }
    })
}

const processHtmlWithProgress = (html, baseUrl, resourcesDir) => {
  return new Promise((resolve) => {
    const $ = cheerio.load(html)

    const resources = []
    const tagsToProcess = [
      { selector: 'img[src]', attr: 'src' },
      { selector: 'link[href][rel="stylesheet"]', attr: 'href' },
      { selector: 'script[src]', attr: 'src' },
      { selector: 'a[href$=".html"], a[href*=".html?"]', attr: 'href' },
    ]

    // Добавляем главную страницу как ресурс
    resources.push({
      url: baseUrl,
      element: null,
      attr: null,
      isMainPage: true,
    })

    tagsToProcess.forEach(({ selector, attr }) => {
      $(selector).each((i, element) => {
        const resourceUrl = $(element).attr(attr)
        if (resourceUrl && isLocalResource(baseUrl, resourceUrl)) {
          resources.push({
            url: resourceUrl,
            element: $(element),
            attr,
          })
        }
      })
    })

    if (resources.length === 0) {
      return resolve(prettier.format(html, prettierOptions))
    }

    const tasks = resources.map((resource) => {
      if (resource.isMainPage) {
        return {
          title: `Downloading main page as resource`,
          task: () => downloadResource(baseUrl, baseUrl, resourcesDir),
        }
      }
      return {
        title: `Downloading ${resource.url}`,
        task: () => downloadResource(baseUrl, resource.url, resourcesDir)
          .then(({ success, filename }) => {
            if (success) {
              const newPath = `${path.basename(resourcesDir)}/${filename}`
              resource.element.attr(resource.attr, newPath)
            }
          }),
      }
    })

    new Listr(tasks, {
      concurrent: true,
      exitOnError: false,
    })
      .run()
      .then(() => {
        const formattedHtml = prettier.format($.html(), prettierOptions)
        resolve(formattedHtml)
      })
      .catch(() => {
        const formattedHtml = prettier.format($.html(), prettierOptions)
        resolve(formattedHtml)
      })
  })
}

export default function downloadPage(url, outputDir = process.cwd()) {
  log(`Starting download: ${url}`)
  console.log(`Starting page download: ${url}`)

  return fs.access(outputDir, fs.constants.W_OK)
    .then(() => axios.get(url))
    .then(response => {
      const pageName = generateFileName(url)
      console.log(`Generated page name: ${pageName}`)
      
      const resourcesDir = path.join(outputDir, `${pageName.replace('.html', '')}_files`)
      console.log(`Resources directory: ${resourcesDir}`)
      
      const htmlFilePath = path.join(outputDir, pageName)
      console.log(`HTML file path: ${htmlFilePath}`)

      return fs.mkdir(resourcesDir, { recursive: true })
        .then(() => processHtmlWithProgress(response.data, url, resourcesDir))
        .then(processedHtml => fs.writeFile(htmlFilePath, processedHtml))
        .then(() => ({
          htmlPath: htmlFilePath,
          resourcesDir: resourcesDir
        }))
    })
      .catch((error) => {
        let message
        if (error.code === 'ENOTFOUND') {
          message = `DNS error: host not found (${url})`
        }
        else if (error.code === 'ECONNREFUSED') {
          message = `Connection refused (${url})`
        }
        else if (error.response) {
          message = `HTTP error ${error.response.status}`
        }
        else if (error.code === 'ETIMEDOUT') {
          message = `Request timeout (${url})`
        }
        else {
          message = error.message || 'Unknown error'
        }
        reject(new PageLoaderError(message, error.code))
      })
  })
}
