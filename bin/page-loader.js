#!/usr/bin/env node

import { program } from 'commander';
import { downloadPage } from '../src/page-loader.js';
import { createRequire } from 'module';
import chalk from 'chalk';
import path from 'path';

const require = createRequire(import.meta.url);
const { version, description } = require('../package.json');

program
  .name('page-loader')
  .version(version)
  .description(description)
  .argument('<url>', 'URL of the page to download')
  .option('-o, --output [dir]', 'output directory (default: current directory)', process.cwd())
  .action((url, options) => {
    console.log(chalk.blue(`Downloading ${url}...`));
    
    downloadPage(url, options.output)
      .then((filepath) => {
        const dirName = path.dirname(filepath);
        const fileName = path.basename(filepath);
        const resourcesDir = path.join(dirName, fileName.replace('.html', '_files'));
        
        console.log(chalk.green(`\nPage successfully saved to: ${chalk.bold(filepath)}`));
        console.log(chalk.green(`Resources saved in: ${chalk.bold(resourcesDir)}`));
        
        process.exit(0);
      })
      .catch((error) => {
        console.error(chalk.red(`\nError: ${error.message}`));
        process.exit(1);
      });
  });

program.parse(process.argv);

// Обработка ошибок командной строки
process.on('unhandledRejection', (error) => {
  console.error(chalk.red(`Fatal error: ${error.message}`));
  process.exit(1);
});
