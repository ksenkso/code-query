import { allVueFiles } from '../utils.mjs';
import { matchAny, matchComponentWithProp, parseVueFile } from '../selection.mjs';

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
};
