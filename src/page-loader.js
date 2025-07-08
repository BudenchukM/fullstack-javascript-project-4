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

  if (!isResource) {
    return name.endsWith('.html') ? name : `${name}.html`
  }

  const pathParts = url.pathname.split('/').pop().split('.')
  const hasExtension = pathParts.length > 1
  const extension = hasExtension ? pathParts.pop() : 'html'

  name = name.replace(new RegExp(`\\.${extension}$`), '')

  return `${name}.${extension}`
}

const prepareDownloadTasks = (html, baseUrl, resourcesDir) => {
  const $ = cheerio.load(html)
  const resources = []
  const tagsToProcess = [
    { selector: 'img[src]', attr: 'src' },
    { selector: 'link[href][rel="stylesheet"]', attr: 'href' },
    { selector: 'script[src]', attr: 'src' },
    { selector: 'a[href$=".html"], a[href*=".html?"]', attr: 'href' },
  ]

  const resourcesBaseName = path.basename(resourcesDir)

  tagsToProcess.forEach(({ selector, attr }) => {
    $(selector).each((i, element) => {
      const resourceUrl = $(element).attr(attr)
      if (resourceUrl && isLocalResource(baseUrl, resourceUrl)) {
        const filename = generateFileName(resourceUrl, true)
        const newPath = `${resourcesBaseName}/${filename}`

        $(element).attr(attr, newPath)

        resources.push({
          url: resourceUrl,
          filename,
          absoluteUrl: new URL(resourceUrl, baseUrl).toString(),
        })
      }
    })
  })

  if (resources.length === 0) {
    return Promise.resolve({
      html: prettier.format(html, prettierOptions),
      tasks: [],
    })
  }

  const tasks = resources.map(({ url, absoluteUrl, filename }) => ({
    title: `Downloading ${url}`,
    task: () => downloadResource(absoluteUrl, filename, resourcesDir),
  }))

  return Promise.resolve({
    html: prettier.format($.html(), prettierOptions),
    tasks,
  })
}

const downloadResource = (absoluteUrl, filename, outputDir) => {
  log(`Starting download: ${absoluteUrl}`)
  const filepath = path.join(outputDir, filename)

  return axios.get(absoluteUrl, {
    responseType: 'arraybuffer',
    validateStatus: status => status === 200,
  })
    .then((response) => {
      const data = Buffer.isBuffer(response.data) || Buffer.from(response.data)
      return fs.writeFile(filepath, data)
        .then(() => log(`Resource saved: ${filepath}`))
    })
    .catch((error) => {
      log(`Download failed: ${absoluteUrl}`, error.message)
    })
}

export default function downloadPage(url, outputDir = process.cwd()) {
  log(`Starting download: ${url}`)

  return fs.access(outputDir, fs.constants.W_OK)
    .then(() => axios.get(url))
    .then((response) => {
      const pageName = generateFileName(url)
      const resourcesDir = path.join(outputDir, `${pageName.replace('.html', '')}_files`)
      const htmlFilePath = path.join(outputDir, pageName)

      return fs.mkdir(resourcesDir, { recursive: true })
        .then(() => prepareDownloadTasks(response.data, url, resourcesDir))
        .then(({ html, tasks }) => {
          if (tasks.length > 0) {
            return new Listr(tasks, {
              concurrent: true,
              exitOnError: false,
            }).run().then(() => html)
          }
          return html
        })
        .then((finalHtml) => fs.writeFile(htmlFilePath, finalHtml))
        .then(() => ({
          htmlPath: htmlFilePath,
          resourcesDir: resourcesDir,
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
      log(`Error occurred: ${message}`)
      throw new PageLoaderError(message, error.code)
    })
}
