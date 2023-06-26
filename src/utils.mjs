import fs from 'fs/promises';
import { Glob } from 'glob';
import path from 'path';
import { getComponentScript } from './selection.mjs';

export function noop() {}

/**
 * @typedef {{
 *   loc(*): string,
 *   name: string,
 *   content: string
 * }} FileStruct
 */

/**
 * @param list
 * @return {AsyncGenerator<FileStruct, string, *>}
 */
export const readFilesList = async function * (list) {
  for await (const file of list) {
    const content = await fs.readFile(file, 'utf8');

    yield { name: file, content, loc(loc) { return `${file}:${loc.start.line}:${loc.start.column}` } };
  }
}

export const processArgs = () => {
  return process.argv.slice(2).reduce((arg, map) => {
    const equalsIndex = arg.indexOf('=');
    let name, value;
    if (equalsIndex !== -1) {
      const equalsIndex = arg.indexOf('=');
      name = arg.substring('--'.length, equalsIndex);
      value = arg.substring(equalsIndex + 1);
    } else {
      name = arg.substring('--'.length);
      value = true;
    }

    map[name] = value;

    return map;
  })
}

export const files = async function * (relativePath) {
  const projectRoot = process.env.PROJECT_ROOT || processArgs()['project-root'];
  const list = new Glob(path.resolve(projectRoot, relativePath), {});

  yield * readFilesList(list);
}

export const allVueFiles = async function * () {
  const vueFilesPattern = 'src{/**/,/**/**/,/**/**/**/}*.vue';
  const projectRoot = process.env.PROJECT_ROOT || processArgs()['project-root'];
  const list = new Glob(path.resolve(projectRoot, vueFilesPattern), {});

  yield * readFilesList(list);
}

export const allJsFromVueFiles = async function * () {
  for await (const file of allVueFiles()) {
    const jsSource = getComponentScript(file.content, file.name);

    if (jsSource) {
      file.jsSource = jsSource;
      yield file;
    }
  }
}

/**
 * @param files
 * @param {((file: FileStruct) => Promise<void>)} visitor
 * @return {Promise<void>}
 */
export const iterateFiles = async (files, visitor) => {
  for await (const file of files) {
    await withErrorHandling(file, async () => {
      await visitor(file);
    })
  }
}

export const attrKey = (attr, source) => {
  if (attr.key.type === 'VDirectiveKey') {
    return attr.key.argument
      ? attr.key.argument.name || source.substring(...attr.key.argument.range)
      : attr.key.name.name;
  }

  return attr.key.name;
}

export const attrValue = (attr, source) => {
  return attr.value.type === 'VExpressionContainer'
    ? source.substring(...attr.range)
    : attr.value.value
}

export const isEventAttr = (attr) => {
  return attr.key.name.rawName === '@';
}

export const isEventName = (attr, name) => {
  return attr.key.argument.name === name;
}

export const isNativeEvent = (attr) => {
  return attr.key.modifiers && attr.key.modifiers.some(mod => mod.name === 'native');
}

export const logSet = set => {
  console.log(Array.from(set).join('\n'));
}

export const normalizeComponentName = name => name.toLowerCase().replaceAll('-', '');

export const uniqueLogger = () => {
  const set = new Set();

  return (value) => {
    if (!set.has(value)) {
      console.log(value);
      set.add(value);
    }
  }
}

export const withErrorHandling = async (file, fn) => {
  try {
    await fn();
  } catch (err) {
    console.log(`Error in file: ${file.name}`);
    throw err;
  }
}

export const zipMap = (arr, mapper) => arr.reduce((map, prop) => {
  map[prop] = mapper(prop);
  return map;
}, {})
