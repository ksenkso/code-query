import fs from 'fs/promises';

export const toCamelCase = (str: string) => {
  let name = '';
  let index = 0, length = str.length;
  for (; index < length; index++) {
    if (str[index] === '-') {
      index++;
      name += str[index].toUpperCase();
    } else {
      name += str[index]
    }
  }
  return name;
}

export const replaceContent = async (fileName: string, start: number, end: number, replacement: string) => {
  const content = await fs.readFile(fileName, 'utf8');
  const newContent = content.substring(0, start) + replacement + content.substring(end);

  return fs.writeFile(fileName, newContent);
}
