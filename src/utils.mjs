import fs from 'fs/promises';
import { Glob } from 'glob';
import path from 'path';
import { getJsFromVue } from './selection.mjs';

export function noop() {}
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
    const jsSource = getJsFromVue(file.content);
    if (jsSource) {
      yield { file, source: jsSource };
    }
  }
}

export const attrKey = (attr) => {
  return typeof attr.key.name === 'string'
    ? attr.key.name
    : attr.key.argument.name;
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
