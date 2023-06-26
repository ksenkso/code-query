import { allJsFromVueFiles, logSet } from '../utils.mjs';
import { subtraverse, traverse } from '../selection.mjs';

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
          });
        }
      }
    });
  }

  await Promise.all(tasks);

  if (!noJsSource.size) {
    console.log('Nothing found');
  } else {
    console.log('No js source:');
    logSet(noJsSource);
  }
  console.log('Contains this:');
  logSet(containsThis);
};
