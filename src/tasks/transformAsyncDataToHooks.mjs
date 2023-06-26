import { files } from '../utils.mjs';
import vueParser from 'vue-eslint-parser';
import { traverse } from '../selection.mjs';
import t from '@babel/types';
import g from '@babel/generator';
import { replaceContent } from '../transform.mjs';

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
          const { code: asyncDataHookCode } = g.default(setup, {});
          tasks.push(replaceContent(name, start + asyncDataProp.loc.start.index, start + asyncDataProp.loc.end.index, asyncDataHookCode));
        }
      }
    });
  }

  await Promise.all(tasks);

  if (!noJsSource.size) {
    console.log('Nothing found');
  } else {
    console.log(Array.from(noJsSource).join('\n'));
  }
};
