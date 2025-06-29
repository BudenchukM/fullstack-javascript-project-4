import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

const generateFilename = (url) => {
  const urlWithoutProtocol = url.replace(/^https?:\/\//, '');
  const cleanUrl = urlWithoutProtocol.replace(/[^a-zA-Z0-9]/g, '-');
  return `${cleanUrl}.html`;
};

const downloadPage = async (url, outputDir = process.cwd()) => {
  try {
    const response = await axios.get(url);
    const filename = generateFilename(url);
    const filepath = path.join(outputDir, filename);
    
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(filepath, response.data);
    
    return filepath;
  } catch (error) {
    throw new Error(`Failed to download ${url}: ${error.message}`);
  }
};

export default downloadPage;
