import vueParser from 'vue-eslint-parser';
import t from '@babel/types';
import g from '@babel/generator';
import {
  allJsFromVueFiles,
  files,
  isEventAttr,
  isEventName,
  isNativeEvent,
  logSet
} from './utils.mjs';
import {
  getComponentOption,
  getLastExpression,
  isPropertyName,
  subtraverse,
  traverse
} from './selection.mjs';
import { toCamelCase } from './transform.mjs';

export const findStyleAndClassBindings = async () => {
  const componentName = 'TMPostForm'.toLowerCase();

  const attrKey = (attr) => {
    return typeof attr.key.name === 'string'
      ? attr.key.name
      : attr.key.argument.name;
  }
  const keys = new Set();

  for await (const { content, loc } of files('src/components/**/*.vue')) {
    const program = vueParser.parse(content, {
      sourceType: 'module',
      ecmaVersion: 'latest',
    });
    vueParser.AST.traverseNodes(program.templateBody, {
      enterNode(node, parent) {
        if (node.type === 'VStartTag' && parent.name === componentName) {
          node.attributes.forEach(attr => {
            if (attr.key.type === 'VDirectiveKey') return;

            const attrName = toCamelCase(attrKey(attr));
            if (attrName === 'class' || attrName === 'style') {
              console.log(attrName, loc(attr.loc));
              keys.add(attrName);
            }
          });
        }
      },
      leaveNode: noop,
    })
  }

  if (!keys.size) {
    console.log('No keys');
  } else {
    console.log(Array.from(keys).map(key => {
      return `${toCamelCase(key)}: {
  type: String,
  default: '',
}`;
    }).join(',\n'));
  }
}

export const findComponentsWithClickNative = async () => {
  const needEvents = new Set();

  for await (const { content } of files('src/components/**/*.vue')) {
    const program = vueParser.parse(content, {
      sourceType: 'module',
      ecmaVersion: 'latest',
    });
    vueParser.AST.traverseNodes(program.templateBody, {
      enterNode(node, parent) {
        if (node.type === 'VStartTag') {
          node.attributes.forEach(attr => {
            if (isEventAttr(attr) && isEventName(attr, 'click') && isNativeEvent(attr)) {
              needEvents.add(parent.name)
            }
          });
        }
      },
      leaveNode: noop,
    })
  }

  if (!needEvents.size) {
    console.log('Nothing found');
  } else {
    console.log(Array.from(needEvents).join('\n'));
  }
}

export const transformAsyncDataToHooks = async () => {
  const noJsSource = new Set();
  const tasks = [];

  for await (const { name, content } of files('src/pages/**/*.vue')) {
    const program = vueParser.parse(content, {
      sourceType: 'module',
      ecmaVersion: 'latest',
    });
    const start = program.body.at(0)?.start;
    const end = program.body.at(-1)?.end;
    if (start === undefined || end === undefined) {
      noJsSource.add(name);
      continue;
    }
    const jsSource = content.substring(start, end);
    traverse(jsSource, {
      ExportDefaultDeclaration(path) {
        const { node } = path;
        const asyncDataProp = node.declaration.properties.find(prop => prop.key.name === 'asyncData');
        if (asyncDataProp) {
          const asyncDataComposable = t.expressionStatement(
            t.callExpression(t.identifier('useAsyncData'), [
              t.arrowFunctionExpression(asyncDataProp.params, asyncDataProp.body),
            ])
          );
          const setup = t.objectMethod('method', t.identifier('setup'), [], t.blockStatement([
            asyncDataComposable
          ]));
          const { code: asyncDataHookCode } = g.default(setup, {

          });
          tasks.push(replaceContent(name, start + asyncDataProp.loc.start.index, start + asyncDataProp.loc.end.index, asyncDataHookCode));
        }
      }
    })
  }

  await Promise.all(tasks);

  if (!noJsSource.size) {
    console.log('Nothing found');
  } else {
    console.log(Array.from(noJsSource).join('\n'));
  }
}

export const findAsyncDataWithThisExpression = async () => {
  const noJsSource = new Set();
  const containsThis = new Set();
  const tasks = [];

  for await (const { file: { name }, source } of allJsFromVueFiles()) {
    traverse(source, {
      ExportDefaultDeclaration(path) {
        const { node } = path;
        const setupNode = node.declaration.properties.find(prop => prop.key.name === 'setup');
        if (setupNode) {
          subtraverse(setupNode, {
            ThisExpression() {
              containsThis.add(name);
            }
          })
        }
      }
    })
  }

  await Promise.all(tasks);

  if (!noJsSource.size) {
    console.log('Nothing found');
  } else {
    console.log('No js source:');
    logSet(noJsSource)
  }
  console.log('Contains this:');
  logSet(containsThis);
}

export const findAsyncDataAndIsLoading = async () => {
  const duplicateDeclarations = new Set();

  for await (const { file: { name }, source } of allJsFromVueFiles()) {
    traverse(source, {
      ExportDefaultDeclaration(path) {
        const { node } = path;
        const setupNode = node.declaration.properties.find(prop => prop.key.name === 'setup');
        if (setupNode) {
          const lastSetupStatement = setupNode.body.body.at(-1);

          const returnsUseAsyncData = t.isReturnStatement(lastSetupStatement)
            && t.isCallExpression(lastSetupStatement.argument)
            && lastSetupStatement.argument.callee.name === 'useAsyncData';
          if (returnsUseAsyncData) {
            let hasDuplicateDeclaration = false;
            const dataOption = getComponentOption(node, 'data');
            if (dataOption) {
              hasDuplicateDeclaration = !!getLastExpression(dataOption).argument.properties.find(isPropertyName('isLoading'));
            }

            if (!hasDuplicateDeclaration) {
              const computedOption = getComponentOption(node, 'computed');
              if (computedOption) {
                hasDuplicateDeclaration = !!computedOption.value.properties.find(isPropertyName('isLoading'));
              }
            }

            if (hasDuplicateDeclaration) {
              duplicateDeclarations.add(name);
            }
          }
        }
      }
    })
  }

  console.log('Double declarations of `isLoading`:');
  logSet(duplicateDeclarations);
}
