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
  let name = url.hostname.replace(/\./g, '-') + 
    url.pathname.replace(/\//g, '-').replace(/-+$/, '')

  if (!isResource) {
    return name.endsWith('.html') ? name : `${name}.html`
  }

  const pathParts = url.pathname.split('/').pop().split('.')
  const hasExtension = pathParts.length > 1
  const extension = hasExtension ? pathParts.pop() : 'html'

  name = name.replace(new RegExp(`\\.${extension}$`), '')

  return `${name}.${extension}`
}

const getResourceLocalPath = (resourceUrl, resourcesDirName) => {
  const filename = generateFileName(resourceUrl, true)
  return `${resourcesDirName}/${filename}`
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
    })
    .then(() => {
      log(`Resource saved: ${filepath}`)
      return { success: true }
    })
    .catch((error) => {
      log(`Download failed: ${resourceUrl}`, error.message)
      return { success: false, error: error.message }
    })
}

const findResourcesInHtml = ($, baseUrl) => {
  const resources = []
  const tagsToProcess = [
    { selector: 'img[src]', attr: 'src' },
    { selector: 'link[href][rel="stylesheet"]', attr: 'href' },
    { selector: 'script[src]', attr: 'src' },
    { selector: 'a[href$=".html"], a[href*=".html?"]', attr: 'href' },
  ]

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

  return resources
}

const prepareDownloadTasks = (html, baseUrl, resourcesDir) => {
  const $ = cheerio.load(html)
  const resourcesDirName = path.basename(resourcesDir)
  const resources = findResourcesInHtml($, baseUrl)

  if (resources.length === 0) {
    return Promise.resolve({
      html: prettier.format(html, prettierOptions),
      tasks: [],
    })
  }

  resources.forEach((resource) => {
    const localPath = getResourceLocalPath(resource.url, resourcesDirName)
    resource.element.attr(resource.attr, localPath)
  })

  const tasks = resources.map((resource) => ({
    title: `Downloading ${resource.url}`,
    task: () => downloadResource(baseUrl, resource.url, resourcesDir),
  }))

  return Promise.resolve({
    html: $.html(),
    tasks,
  })
}

export default function downloadPage(url, outputDir = process.cwd()) {
  log(`Starting download: ${url}`)
  console.log(`Starting page download: ${url}`)

  return fs.access(outputDir, fs.constants.W_OK)
    .then(() => axios.get(url))
    .then((response) => {
      const pageName = generateFileName(url)
      console.log(`Generated page name: ${pageName}`)

      const resourcesDir = path.join(outputDir, `${pageName.replace('.html', '')}_files`)
      console.log(`Resources directory: ${resourcesDir}`)

      const htmlFilePath = path.join(outputDir, pageName)
      console.log(`HTML file path: ${htmlFilePath}`)

      return fs.mkdir(resourcesDir, { recursive: true })
        .then(() => prepareDownloadTasks(response.data, url, resourcesDir))
        .then(({ html, tasks }) => {
          if (tasks.length === 0) {
            return fs.writeFile(htmlFilePath, html)
          }

          return new Listr(tasks, {
            concurrent: true,
            exitOnError: false,
          }).run()
            .then(() => fs.writeFile(htmlFilePath, prettier.format(html, prettierOptions)))
        })
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
