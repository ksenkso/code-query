import { files } from '../utils.mjs';
import vueParser from 'vue-eslint-parser';
import { toCamelCase } from '../transform.mjs';

export const findStyleAndClassBindings = async () => {
  const componentName = 'TMPostForm'.toLowerCase();

  const attrKey = (attr) => {
    return typeof attr.key.name === 'string'
      ? attr.key.name
      : attr.key.argument.name;
  };
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
    });
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
};
