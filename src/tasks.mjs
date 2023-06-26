import vueParser from 'vue-eslint-parser';
import t from '@babel/types';
import g from '@babel/generator';
import {
  allJsFromVueFiles,
  allVueFiles,
  attrKey,
  attrValue,
  files,
  isEventAttr,
  isEventName,
  isNativeEvent,
  iterateFiles,
  logSet,
  normalizeComponentName,
  uniqueLogger
} from './utils.mjs';
import {
  enterComponentDefinition,
  getComponentOption,
  getLastExpression,
  isPropertyName,
  matchAny,
  matchComponentWithProp,
  parseVueFile,
  resolveComponentStruct,
  subtraverse,
  traverse
} from './selection.mjs';
import { replaceContent, toCamelCase } from './transform.mjs';

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

  for await (const { name, jsSource } of allJsFromVueFiles()) {
    traverse(jsSource, {
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

  for await (const { name, jsSource } of allJsFromVueFiles()) {
    traverse(jsSource, {
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

export const findTeleportsWithTargetInsideApp = async () => {
  const log = uniqueLogger()
  for await (const { content } of allVueFiles()) {
    const program = parseVueFile(content);
    matchComponentWithProp({
      program,
      source: content,
      matchComponent: 'teleport',
      matchProp: 'to',
      matchValue: matchAny,
      visit(node, attr) {
        log(attrValue(attr, content));
      }
    });
  }
}

const zipMap = (arr, mapper) => arr.reduce((map, prop) => {
  map[prop] = mapper(prop);
  return map;
}, {})

export const findRouterLinksWithRemovedAttrs = async () => {
  const removedProps = ['append', 'event', 'tag', 'exact'];
  const sets = zipMap(removedProps, () => new Set());

  for await (const { content, loc, name } of allVueFiles()) {
    const program = parseVueFile(content);
    try {
      matchComponentWithProp({
        program,
        source: content,
        matchComponent: 'routerlink',
        matchProp: (name) => removedProps.includes(name),
        matchValue: matchAny,
        visit(node, attr) {
          sets[attrKey(attr)].add(loc(attr.loc))
        }
      });
    } catch (err) {
      console.log(`Error in file: ${name}`);
      throw err;
    }

  }

  Object.entries(sets).forEach(([key, set]) => {
    console.log(`Prop: ${key}`);
    logSet(set);
  });
}

export const findTemplatesWithVFor = async () => {
  for await (const { content, loc, name } of allVueFiles()) {
    const program = parseVueFile(content);
    try {
      matchComponentWithProp({
        program,
        source: content,
        matchComponent: 'template',
        matchProp: (name, attr) => {
          return attr.key.type === 'VDirectiveKey' && name === 'for';
        },
        matchValue: matchAny,
        visit(node, attr) {
          console.log(loc(attr.loc));
        }
      });
    } catch (err) {
      console.log(`Error in file: ${name}`);
      throw err;
    }
  }
}

export const findAllEventsWithoutEmits = () => {
  const sources = allVueFiles();

  return iterateFiles(sources, (file) => {
    const { name } = file;
    const component = resolveComponentStruct(file);
    const eventsSet = new Set();
    [
      component.template?.content,
      component.script?.content,
    ]
      .filter(Boolean)
      .forEach(componentPart => {
      const matches = componentPart.matchAll(/\$emit\((.*)\)/gm);
      if (matches) {
        for (const match of matches) {
          console.log(match[0]);
          traverse(match[0], {
            CallExpression(path) {
              const { node } = path;
              node.arguments.forEach(arg => {
                if (arg.type === 'StringLiteral') {
                  eventsSet.add(arg.value);
                }
              });
            }
          });
        }
      }
    })

    if (!component.script) {
      if (eventsSet.size) {
        const serializedEventsList = [...eventsSet].map(e => `'${e}'`).join(', ');
        console.log(`No script for: ${component.template.file}, events: ${serializedEventsList}`);
      }
      return;
    }

    enterComponentDefinition(component.script.program, (node) => {
      const emits = getComponentOption(node, 'emits');
      if (emits) {
        eventsSet.forEach(event => {
          if (emits.value.elements.some(eventName => eventName.value === event)) {
            eventsSet.delete(event);
          }
        });
      }

      if (eventsSet.size) {
        const serializedEventsList = [...eventsSet].map(e => `'${e}'`).join(', ');
        console.log(name, serializedEventsList);

        if (emits) {
          const lastElementPosition = emits.value.elements.at(-1).end + component.script.offset;
          replaceContent(component.script.file, lastElementPosition, lastElementPosition, serializedEventsList);
        } else {
          const insertPosition = [
            getComponentOption(node, 'name'),
            getComponentOption(node, 'components'),
            getComponentOption(node, 'props'),
          ].filter(Boolean).at(-1).end + component.script.offset + 1;
          const emitsOption = `\n  emits: [${serializedEventsList}],`;
          replaceContent(component.script.file, insertPosition, insertPosition, emitsOption);
        }
      }
    })
  });
}

export const findComponentsWithClickNative = () => {
  const logUniq = uniqueLogger();
  return iterateFiles(allVueFiles(), (file) => {
    const program = parseVueFile(file.content);
    matchComponentWithProp({
      program,
      source: file.content,
      matchComponent: matchAny,
      matchProp: (name, attr) => {
        return attr.key.type === 'VDirectiveKey' && attr.key.modifiers && attr.key.modifiers.some(mod => mod.name && mod.name === 'native');
      },
      matchValue: matchAny,
      visit(node) {
        logUniq(normalizeComponentName(node.parent.name));
      }
    });
  })
}
