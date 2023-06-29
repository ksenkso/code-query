import fs from 'fs/promises'
import {Glob} from 'glob'
import path from 'path'
import {getComponentScript} from './selection'
import {SourceLocation} from '@babel/types'
import {AST} from 'vue-eslint-parser'

export function noop() {}

export type FileStruct = {
  path: string;
  content: string;
  loc(location: SourceLocation): string;
  jsSource: string;
}

export const readFilesList = async function * (list: Glob<{}>) {
  for await (const path of list) {
    const content = await fs.readFile(path, 'utf8');

    yield {
      path,
      content,
      loc: (loc: SourceLocation) => `${path}:${loc.start.line}:${loc.start.column}`,
      jsSource: '',
    };
  }
}

export const files = async function * (relativePath: string) {
  const projectRoot = process.env.PROJECT_ROOT as string;
  const list = new Glob(path.resolve(projectRoot, relativePath), {});

  yield * readFilesList(list);
}

export const allVueFiles = async function * () {
  const vueFilesPattern = 'src{/**/,/**/**/,/**/**/**/}*.vue';
  const projectRoot = process.env.PROJECT_ROOT as string;
  const list = new Glob(path.resolve(projectRoot, vueFilesPattern), {});

  yield * readFilesList(list);
}

export const allJsFromVueFiles = async function * () {
  for await (const file of allVueFiles()) {
    const jsSource = getComponentScript(file.content, file.path);

    if (jsSource) {
      file.jsSource = jsSource.content;
      yield file;
    }
  }
}

export const iterateFiles = async (files: AsyncGenerator<FileStruct>, visitor: (file: FileStruct) => Awaited<void>) => {
  for await (const file of files) {
    await withErrorHandling(file, async () => {
      await visitor(file);
    })
  }
}

export type VueAttr = AST.VAttribute | AST.VDirective;

export const isDirective = (attr: VueAttr): attr is AST.VDirective => attr.key.type === 'VDirectiveKey';
export const isExpressionContainer = (attr: { type: string }): attr is AST.VExpressionContainer => attr.type === 'VExpressionContainer';
export const idOrExpression = (node: AST.VIdentifier | AST.VExpressionContainer, source: string) => {
  if (isExpressionContainer(node)) {
    return source.substring(...node.range);
  }

  return node.name;
}

export const attrKey = (attr: VueAttr, source: string) => {
  if (isDirective(attr)) {
    if (attr.key.argument) {
      return idOrExpression(attr.key.argument, source);
    }

    return attr.key.name.name;
  }

  return attr.key.name;
}

export const attrValue = (attr: VueAttr, source: string) => {
  if (!attr.value) return null;

  return attr.value.type === 'VExpressionContainer'
    ? source.substring(...attr.range)
    : attr.value.value
}

export const isEventAttr = (attr: VueAttr) => {
  if (typeof attr.key.name === 'string') {
    return false;
  }

  return attr.key.name.rawName === '@';
}

export const isEventName = (attr: VueAttr, name: string, source: string) => {
  if (!isDirective(attr)) return false;
  if (!attr.key.argument) return false;

  return idOrExpression(attr.key.argument, source);
}

export const isNativeEvent = (attr: VueAttr) => {
  if (!isDirective(attr)) return false;

  return attr.key.modifiers && attr.key.modifiers.some(mod => mod.name === 'native');
}

export const logSet = (set: Set<any>) => {
  console.log(Array.from(set).join('\n'));
}

export const normalizeComponentName = (name: string) => name.toLowerCase().replaceAll('-', '');

export const uniqueLogger = <T>() => {
  const set = new Set<T>();

  return (value: T) => {
    if (!set.has(value)) {
      console.log(value);
      set.add(value);
    }
  }
}

export const withErrorHandling = async (file: FileStruct, fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (err) {
    console.log(`Error in file: ${file.path}`);
    throw err;
  }
}

export const zipMap = <From extends string | number | symbol, To>(arr: From[], mapper: (from: From) => To) => arr.reduce((map, prop) => {
  map[prop] = mapper(prop);
  return map;
}, {} as Record<From, To>)
