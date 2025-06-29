#!/usr/bin/env node

import { program } from 'commander';
import downloadPage from '../src/page-loader.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

program
  .version(version)
  .description('Page loader utility')
  .argument('<url>', 'url to download')
  .option('-o, --output [dir]', 'output dir', process.cwd())
  .action(async (url, options) => {
    try {
      const filepath = await downloadPage(url, options.output);
      console.log(filepath);
      process.exit(0);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
