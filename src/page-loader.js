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

// Define resource tags to process as a constant object
const RESOURCE_TAGS = {
  images: { selector: 'img[src]', attr: 'src' },
  stylesheets: { selector: 'link[href][rel="stylesheet"]', attr: 'href' },
  scripts: { selector: 'script[src]', attr: 'src' },
  htmlLinks: { selector: 'a[href$=".html"], a[href*=".html?"]', attr: 'href' },
}

// Convert to array format for processing
const tagsToProcess = Object.values(RESOURCE_TAGS)

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

const generateFileName = (urlString) => {
  const url = new URL(urlString)
  const parsedPath = path.parse(url.pathname)

  let name = url.hostname.replace(/\./g, '-')
    + parsedPath.dir.replace(/\//g, '-').replace(/-+$/, '')
    + (parsedPath.name ? '-' + parsedPath.name : '')

  name = name.replace(/-+/g, '-').replace(/^-|-$/g, '')

  const extension = parsedPath.ext || '.html'

  return name.endsWith(extension) ? name : `${name}${extension}`
}

const downloadResource = (absoluteUrl, outputPath) => {
  log(`Starting download: ${absoluteUrl}`)

  return axios.get(absoluteUrl, {
    responseType: 'arraybuffer',
    validateStatus: status => status === 200,
  })
    .then((response) => {
      const data = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data)

      return fs.writeFile(outputPath, data)
        .then(() => {
          log(`Resource saved: ${outputPath}`)
          return { success: true, filename: path.basename(outputPath) }
        })
    })
    .catch((error) => {
      log(`Download failed: ${absoluteUrl}`, error.message)
      return { success: false, error: error.message }
    })
}

const downloadResourceWithGeneration = (baseUrl, resourceUrl, outputDir) => {
  const absoluteUrl = new URL(resourceUrl, baseUrl).toString()
  const filename = generateFileName(absoluteUrl)
  const outputPath = path.join(outputDir, filename)

  return downloadResource(absoluteUrl, outputPath)
}

const prepareDownloadTasks = (html, baseUrl, resourcesDir) => {
  const $ = cheerio.load(html)
  const resources = []
  const resourcesDirName = path.basename(resourcesDir)

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
        const absoluteUrl = new URL(resourceUrl, baseUrl).toString()
        const filename = generateFileName(absoluteUrl)
        const newPath = `${resourcesDirName}/${filename}`

        resources.push({
          url: resourceUrl,
          element: $(element),
          attr,
          newPath,
          filename,
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

  const tasks = resources.map((resource) => {
    if (resource.isMainPage) {
      return {
        title: `Downloading main page as resource`,
        task: () => downloadResourceWithGeneration(baseUrl, baseUrl, resourcesDir),
      }
    }

    return {
      title: `Downloading ${resource.url}`,
      task: () => downloadResourceWithGeneration(baseUrl, resource.url, resourcesDir)
        .then(({ success }) => {
          if (success) {
            resource.element.attr(resource.attr, resource.newPath)
          }
        }),
    }
  })

  return Promise.resolve({
    html: $.html(),
    tasks,
    $,
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
        .then(({ html, tasks, $ }) => {
          if (tasks.length === 0) {
            return html
          }

          return new Listr(tasks, {
            concurrent: true,
            exitOnError: false,
          })
            .run()
            .then(() => {
              return prettier.format($.html(), prettierOptions)
            })
        })
        .then(processedHtml => fs.writeFile(htmlFilePath, processedHtml))
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
